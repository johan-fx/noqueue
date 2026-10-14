import { retentionDate } from './calculation'

/** Invoked ONLY through the existing queue coordinator serialization, not its maintenance path. */
export async function backfillMetricsQueue(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  if (
    env.METRICS_CAPTURE_ENABLED !== 'true' ||
    queueId === 'confirmation-experiment'
  )
    return
  const db = env.DB
  await db
    .prepare(
      'INSERT OR IGNORE INTO metrics_backfill(queue_id,started_at) VALUES(?,?)',
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
      `SELECT id FROM (SELECT id FROM queue_entry WHERE queue_id=? AND status='${status}' AND created_at<? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT 20)`,
  )
  oldCandidates.push(
    `SELECT entry_id FROM (SELECT entry_id FROM metrics_entry WHERE queue_id=? AND created_at<? AND (created_at,entry_id)>(?,?) ORDER BY created_at,entry_id LIMIT 20)`,
  )
  const oldParams = oldCandidates.flatMap(() => [
    queueId,
    cutoff,
    progress.after_created,
    progress.after_id,
  ])
  const rows = await db
    .prepare(
      `SELECT e.id,e.version,e.created_at,e.status,e.party_size,q.venue_id,v.organization_id,v.timezone,
    (SELECT actual_at FROM queue_wait_evidence WHERE entry_id=e.id) AS first_called_at
    FROM queue_entry e JOIN queue q ON q.id=e.queue_id JOIN venue v ON v.id=q.venue_id
    WHERE e.queue_id=? AND ${
      progress.phase === 0
        ? `e.id IN (${oldCandidates.join(' UNION ')})`
        : 'e.created_at>=?'
    }
    ${
      progress.repair_since !== null
        ? 'AND (e.created_at>=? OR EXISTS(SELECT 1 FROM metrics_entry m WHERE m.entry_id=e.id))'
        : ''
    }
    AND (e.created_at>? OR (e.created_at=? AND e.id>?)) ORDER BY e.created_at,e.id LIMIT 20`,
    )
    .bind(
      queueId,
      ...(progress.phase === 0 ? oldParams : [cutoff]),
      ...(progress.repair_since !== null ? [progress.repair_since] : []),
      progress.after_created,
      progress.after_created,
      progress.after_id,
    )
    .all<{
      id: string
      version: number
      created_at: number
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
          "INSERT OR IGNORE INTO metrics_identity(entry_id,queue_id,venue_id,organization_id,service_type,timezone,created_at,first_called_at,historical) VALUES(?,?,?,?,'unknown',?,?,?,1)",
        )
        .bind(
          r.id,
          queueId,
          r.venue_id,
          r.organization_id,
          r.timezone,
          r.created_at,
          r.first_called_at,
        ),
    )
    if (r.first_called_at !== null)
      statements.push(
        db
          .prepare(
            'UPDATE metrics_identity SET first_called_at=COALESCE(first_called_at,?) WHERE entry_id=?',
          )
          .bind(r.first_called_at, r.id),
      )
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO metrics_event(entry_id,revision,queue_id,venue_id,organization_id,service_type,timezone,created_at,at,status,party_size,first_called_at,origin,historical)
      SELECT entry_id,?,queue_id,venue_id,organization_id,service_type,timezone,created_at,?,?,?,first_called_at,'historical.backfill',historical FROM metrics_identity WHERE entry_id=?
      AND NOT EXISTS(SELECT 1 FROM metrics_event WHERE entry_id=? AND revision>=?) AND NOT EXISTS(SELECT 1 FROM metrics_entry WHERE entry_id=? AND revision>=?)`,
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
          r.version,
        ),
    )
  }
  const last = rows.results.at(-1)
  if (last)
    statements.push(
      db
        .prepare(
          'UPDATE metrics_backfill SET after_created=?,after_id=? WHERE queue_id=?',
        )
        .bind(last.created_at, last.id, queueId),
    )
  if (rows.results.length < 20) {
    if (progress.phase === 0)
      statements.push(
        db
          .prepare(
            "UPDATE metrics_backfill SET phase=1,after_created=0,after_id='' WHERE queue_id=?",
          )
          .bind(queueId),
      )
    else
      statements.push(
        db
          .prepare(
            'UPDATE metrics_backfill SET completed_at=? WHERE queue_id=?',
          )
          .bind(now, queueId),
      )
  }
  if (statements.length) await db.batch(statements)
}
export async function advanceMetricsBackfill(env: CloudflareBindings) {
  if (env.METRICS_CAPTURE_ENABLED !== 'true') return
  const rows = await env.DB.prepare(
    "SELECT q.id FROM queue q LEFT JOIN metrics_backfill b ON b.queue_id=q.id WHERE q.id!='confirmation-experiment' AND b.completed_at IS NULL ORDER BY COALESCE(b.started_at,0),q.id LIMIT 5",
  ).all<{ id: string }>()
  for (const q of rows.results)
    await (env.APP_ENV === 'local'
      ? env.QUEUE_COORDINATOR
      : env.QUEUE_COORDINATOR.jurisdiction('eu')
    )
      .getByName(q.id)
      .metricsBackfill(q.id)
}
