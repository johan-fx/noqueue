import { retentionDate } from './calculation'
import { historicalServiceType } from './historical-service'

/** Invoked ONLY through the existing queue coordinator serialization, not its maintenance path. */
export async function backfillMetricsQueue(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now()
) {
  if (
    env.METRICS_CAPTURE_ENABLED !== 'true' ||
    queueId === 'confirmation-experiment'
  )
    return
  const db = env.DB
  await db
    .prepare(
      'INSERT OR IGNORE INTO metrics_backfill(queue_id,started_at) VALUES(?,?)'
    )
    .bind(queueId, now)
    .run()
  const progress = await db
    .prepare('SELECT * FROM metrics_backfill WHERE queue_id=?')
    .bind(queueId)
    .first<{
      repair_since: number | null
      phase: number
      after_created: number
      after_id: string
      completed_at: number | null
    }>()
  if (!progress || progress.completed_at !== null) return
  const cutoff = Date.parse(retentionDate(now))
  // Seek each old active-status index separately: even a large expired history
  // cannot turn this exception path into an unbounded scan/sort.
  const oldCandidates = ['waiting', 'called', 'expired'].map(
    (status) =>
      `SELECT id FROM (SELECT id FROM queue_entry WHERE queue_id=? AND status='${status}' AND created_at<? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT 20)`
  )
  oldCandidates.push(
    `SELECT entry_id FROM (SELECT entry_id FROM metrics_entry WHERE queue_id=? AND created_at<? AND (created_at,entry_id)>(?,?) ORDER BY created_at,entry_id LIMIT 20)`
  )
  const oldParams = oldCandidates.flatMap(() => [
    queueId,
    cutoff,
    progress.after_created,
    progress.after_id,
  ])
  const seek = (lower: number) => [
    Math.max(lower, progress.after_created),
    progress.after_created >= lower ? progress.after_id : '',
  ]
  let candidates: string | null = null
  let selection: string
  let selectionParams: (number | string)[]
  if (progress.phase === 0) {
    candidates = oldCandidates.join(' UNION ')
    selection = '1=1'
    selectionParams = oldParams
  } else if (progress.repair_since !== null) {
    // Repair only newly admitted entries and retained contributions. Two indexed
    // seeks avoid scanning all purged history or counting it a second time.
    candidates = `
      SELECT id FROM (SELECT id FROM queue_entry WHERE queue_id=? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT 20)
      UNION SELECT entry_id FROM (SELECT m.entry_id FROM metrics_entry m CROSS JOIN queue_entry live ON live.id=m.entry_id
        WHERE m.queue_id=? AND (m.created_at,m.entry_id)>(?,?) ORDER BY m.created_at,m.entry_id LIMIT 20)`
    selection = '1=1'
    selectionParams = [
      queueId,
      ...seek(Math.max(cutoff, progress.repair_since)),
      queueId,
      ...seek(cutoff),
    ]
  } else {
    selection = '(e.created_at,e.id)>(?,?)'
    selectionParams = seek(cutoff)
  }
  // Drive candidate queries from the bounded union, not the full queue/date
  // index chosen for ORDER BY. CROSS JOIN prevents SQLite reversing that join.
  const rows = await db
    .prepare(
      `SELECT e.id,e.version,e.created_at,e.service_window_id,e.status,e.party_size,q.venue_id,v.organization_id,v.timezone,
    (SELECT actual_at FROM queue_wait_evidence WHERE entry_id=e.id) AS first_called_at
    FROM ${
      candidates
        ? `(${candidates}) candidates CROSS JOIN queue_entry e ON e.id=candidates.id`
        : 'queue_entry e'
    }
    JOIN queue q ON q.id=e.queue_id JOIN venue v ON v.id=q.venue_id
    WHERE e.queue_id=? AND ${selection}
    ORDER BY e.created_at,e.id LIMIT 20`
    )
    .bind(
      ...(candidates
        ? [...selectionParams, queueId]
        : [queueId, ...selectionParams])
    )
    .all<{
      id: string
      version: number
      created_at: number
      service_window_id: string | null
      status: string
      party_size: number
      venue_id: string
      organization_id: string
      timezone: string
      first_called_at: number | null
    }>()
  // Context-free INSERTs here never mutate operational data. OR IGNORE keeps live captures newer.
  const statements: D1PreparedStatement[] = []
  for (const r of rows.results) {
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO metrics_identity(entry_id,queue_id,venue_id,organization_id,service_type,timezone,created_at,first_called_at,historical) VALUES(?,?,?,?,?,?,?,?,1)'
        )
        .bind(
          r.id,
          queueId,
          r.venue_id,
          r.organization_id,
          historicalServiceType(
            r.service_window_id,
            r.created_at,
            env.METRICS_SERVICE_SNAPSHOT_CAPTURE_SINCE
          ),
          r.timezone,
          r.created_at,
          r.first_called_at
        )
    )
    if (r.first_called_at !== null)
      statements.push(
        db
          .prepare(
            'UPDATE metrics_identity SET first_called_at=COALESCE(first_called_at,?) WHERE entry_id=?'
          )
          .bind(r.first_called_at, r.id)
      )
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO metrics_event(entry_id,revision,queue_id,venue_id,organization_id,service_type,timezone,created_at,at,status,party_size,first_called_at,origin,historical)
      SELECT entry_id,?,queue_id,venue_id,organization_id,service_type,timezone,created_at,?,?,?,first_called_at,'historical.backfill',historical FROM metrics_identity WHERE entry_id=?
      AND NOT EXISTS(SELECT 1 FROM metrics_event WHERE entry_id=? AND revision>=?) AND NOT EXISTS(SELECT 1 FROM metrics_entry WHERE entry_id=? AND revision>=?)`
        )
        .bind(
          r.version,
          now,
          r.status,
          r.party_size,
          r.id,
          r.id,
          r.version,
          r.id,
          r.version
        )
    )
  }
  const last = rows.results.at(-1)
  if (last)
    statements.push(
      db
        .prepare(
          'UPDATE metrics_backfill SET after_created=?,after_id=? WHERE queue_id=?'
        )
        .bind(last.created_at, last.id, queueId)
    )
  if (rows.results.length < 20) {
    if (progress.phase === 0)
      statements.push(
        db
          .prepare(
            "UPDATE metrics_backfill SET phase=1,after_created=0,after_id='' WHERE queue_id=?"
          )
          .bind(queueId)
      )
    else {
      statements.push(
        db
          .prepare(
            'UPDATE metrics_backfill SET completed_at=? WHERE queue_id=?'
          )
          .bind(now, queueId),
        db
          .prepare(
            `INSERT OR IGNORE INTO metrics_queue(dimension,queue_id,venue_id,organization_id,service_type,timezone,people,integrated_at,coverage_since)
          SELECT json_array(q.id,COALESCE(json_extract(q.config,'$.type'),'unknown'),v.timezone),q.id,v.id,v.organization_id,COALESCE(json_extract(q.config,'$.type'),'unknown'),v.timezone,0,?,?
          FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=?`
          )
          .bind(now, now, queueId)
      )
    }
  }
  if (statements.length) await db.batch(statements)
}
export async function advanceMetricsBackfill(env: CloudflareBindings) {
  if (env.METRICS_CAPTURE_ENABLED !== 'true') return
  const rows = await env.DB.prepare(
    "SELECT q.id FROM queue q LEFT JOIN metrics_backfill b ON b.queue_id=q.id WHERE q.id!='confirmation-experiment' AND b.completed_at IS NULL ORDER BY COALESCE(b.started_at,0),q.id LIMIT 5"
  ).all<{ id: string }>()
  for (const q of rows.results)
    await (env.APP_ENV === 'local'
      ? env.QUEUE_COORDINATOR
      : env.QUEUE_COORDINATOR.jurisdiction('eu')
    )
      .getByName(q.id)
      .metricsBackfill(q.id)
}
