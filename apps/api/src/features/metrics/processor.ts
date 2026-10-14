import { reconciliationStatements } from './reconcile'
import {
  contribution,
  emptyCounts,
  hourBucket,
  localParts,
  retentionDate,
  DAY,
} from './calculation'

export type EventRow = {
  seq: number
  entry_id: string
  revision: number
  queue_id: string
  venue_id: string
  organization_id: string
  service_type: string
  timezone: string
  created_at: number
  at: number
  status: string
  party_size: number
  first_called_at: number | null
  historical: number
}
type EntryRow = Pick<
  EventRow,
  | 'entry_id'
  | 'revision'
  | 'created_at'
  | 'status'
  | 'party_size'
  | 'first_called_at'
  | 'historical'
> & { dimension: string }
export type QueueRow = {
  dimension: string
  queue_id: string
  venue_id: string
  organization_id: string
  service_type: string
  timezone: string
  people: number
  integrated_at: number
  coverage_since: number
}
type Control = {
  cursor: number
  target_seq: number | null
  target_at: number | null
  integrate_after: string
  last_complete_at: number | null
}
const dimension = (e: EventRow) =>
  JSON.stringify([e.queue_id, e.service_type, e.timezone])
const columns = [
  'generated',
  'completed',
  'cancelled',
  'no_show',
  'pending',
  'unknown',
  'wait_sum_ms',
  'wait_samples',
]
const countValues = (c: ReturnType<typeof contribution>) => [
  c.generated,
  c.completed,
  c.cancelled,
  c.noShow,
  c.pending,
  c.unknown,
  c.waitSumMs,
  c.waitSamples,
]
const dims = (q: QueueRow) => [
  q.dimension,
  q.queue_id,
  q.venue_id,
  q.organization_id,
  q.service_type,
  q.timezone,
]
function dailyCounts(
  db: D1Database,
  q: QueueRow,
  e: EventRow,
  before: EntryRow | null,
) {
  const next = countValues(contribution(e)),
    old = countValues(before ? contribution(before) : emptyCounts())
  const delta = next.map((n, i) => n - old[i]!)
  const date = localParts(e.created_at, e.timezone).date
  const hour = hourBucket(e.created_at, e.timezone)
  return [
    db
      .prepare(
        `INSERT INTO metrics_daily(dimension,queue_id,venue_id,organization_id,service_type,timezone,date,${columns.join(
          ',',
        )},historical) VALUES(${Array(16).fill(
          '?',
        )}) ON CONFLICT(dimension,date) DO UPDATE SET ${columns
          .map((c) => `${c}=${c}+excluded.${c}`)
          .join(',')},historical=MAX(historical,excluded.historical)`,
      )
      .bind(...dims(q), date, ...delta, e.historical),
    db
      .prepare(
        `INSERT INTO metrics_hourly(dimension,queue_id,venue_id,organization_id,service_type,timezone,date,hour,bucket_at,bucket_end,generated,wait_sum_ms,wait_samples) VALUES(${Array(
          13,
        ).fill(
          '?',
        )}) ON CONFLICT(dimension,bucket_at) DO UPDATE SET generated=generated+excluded.generated,wait_sum_ms=wait_sum_ms+excluded.wait_sum_ms,wait_samples=wait_samples+excluded.wait_samples`,
      )
      .bind(
        ...dims(q),
        date,
        hour.hour,
        hour.start,
        hour.end,
        delta[0]!,
        delta[6]!,
        delta[7]!,
      ),
    db
      .prepare(
        'INSERT OR IGNORE INTO metrics_dirty(dimension,date) VALUES(?,?)',
      )
      .bind(q.dimension, date),
  ]
}
/** At most eight hourly partitions per commit; a multi-day outage resumes safely. */
function integrate(db: D1Database, q: QueueRow, until: number) {
  const statements: D1PreparedStatement[] = []
  let at = q.integrated_at
  for (let i = 0; at < until && i < 8; i++) {
    const b = hourBucket(at, q.timezone)
    const end = Math.min(b.end, until)
    if (end <= at) throw new Error('metrics_invalid_time_bucket')
    const duration = end - at,
      integral = duration * q.people
    statements.push(
      db
        .prepare(
          `INSERT INTO metrics_hourly(dimension,queue_id,venue_id,organization_id,service_type,timezone,date,hour,bucket_at,bucket_end,people_ms,observed_ms) VALUES(${Array(
            12,
          ).fill(
            '?',
          )}) ON CONFLICT(dimension,bucket_at) DO UPDATE SET people_ms=people_ms+excluded.people_ms,observed_ms=observed_ms+excluded.observed_ms`,
        )
        .bind(...dims(q), b.date, b.hour, b.start, b.end, integral, duration),
    )
    statements.push(
      db
        .prepare(
          `INSERT INTO metrics_daily(dimension,queue_id,venue_id,organization_id,service_type,timezone,date,people_ms,observed_ms,first_wait_at,last_wait_at) VALUES(${Array(
            11,
          ).fill(
            '?',
          )}) ON CONFLICT(dimension,date) DO UPDATE SET people_ms=people_ms+excluded.people_ms,observed_ms=observed_ms+excluded.observed_ms,first_wait_at=CASE WHEN first_wait_at IS NULL THEN excluded.first_wait_at WHEN excluded.first_wait_at IS NULL THEN first_wait_at ELSE MIN(first_wait_at,excluded.first_wait_at) END,last_wait_at=CASE WHEN last_wait_at IS NULL THEN excluded.last_wait_at WHEN excluded.last_wait_at IS NULL THEN last_wait_at ELSE MAX(last_wait_at,excluded.last_wait_at) END`,
        )
        .bind(
          ...dims(q),
          b.date,
          integral,
          duration,
          q.people > 0 ? at : null,
          q.people > 0 ? end : null,
        ),
    )
    at = end
  }
  q.integrated_at = at
  return statements
}
function saveQueue(db: D1Database, q: QueueRow) {
  return db
    .prepare(
      `INSERT INTO metrics_queue(dimension,queue_id,venue_id,organization_id,service_type,timezone,people,integrated_at,coverage_since) VALUES(${Array(
        9,
      ).fill(
        '?',
      )}) ON CONFLICT(dimension) DO UPDATE SET people=excluded.people,integrated_at=excluded.integrated_at,coverage_since=excluded.coverage_since`,
    )
    .bind(...dims(q), q.people, q.integrated_at, q.coverage_since)
}
async function commit(
  db: D1Database,
  token: string,
  statements: D1PreparedStatement[],
) {
  // A CHECK failure rolls back the complete batch if a newer invocation owns the lease.
  await db.batch([
    db
      .prepare(
        'INSERT INTO metrics_fence(ok) SELECT CASE WHEN lease_token=? AND lease_until>? THEN 1 ELSE 0 END FROM metrics_control WHERE id=1',
      )
      .bind(token, Date.now()),
    ...statements,
    db.prepare('DELETE FROM metrics_fence'),
    db
      .prepare(
        'UPDATE metrics_control SET lease_until=? WHERE id=1 AND lease_token=?',
      )
      .bind(Date.now() + 60000, token),
  ])
}
export async function processMetrics(
  env: CloudflareBindings,
  now = Date.now(),
  maxWork = 60,
) {
  const db = env.DB,
    token = crypto.randomUUID()
  const acquired = await db
    .prepare(
      'UPDATE metrics_control SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<? RETURNING id',
    )
    .bind(token, Date.now() + 60000, Date.now())
    .first()
  if (!acquired) return { busy: true, processed: 0 }
  let processed = 0
  try {
    const c = await db
      .prepare('SELECT * FROM metrics_control WHERE id=1')
      .first<Control>()
    if (!c) throw new Error('metrics_missing_control')
    if (c.target_at === null) {
      const max = await db
        .prepare(
          'SELECT COALESCE((SELECT MIN(seq)-1 FROM metrics_event WHERE seq>? AND at>?), (SELECT MAX(seq) FROM metrics_event), ?) AS seq',
        )
        .bind(c.cursor, now, c.cursor)
        .first<{ seq: number }>()
      c.target_seq = max!.seq
      c.target_at = now
      c.integrate_after = ''
      await commit(db, token, [
        db
          .prepare(
            "UPDATE metrics_control SET target_seq=?,target_at=?,integrate_after='' WHERE id=1",
          )
          .bind(c.target_seq, c.target_at),
      ])
    }
    const events = await db
      .prepare(
        'SELECT * FROM metrics_event WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?',
      )
      .bind(c.cursor, c.target_seq, maxWork)
      .all<EventRow>()
    for (const e of events.results) {
      const old = await db
        .prepare('SELECT * FROM metrics_entry WHERE entry_id=?')
        .bind(e.entry_id)
        .first<EntryRow>()
      if (old && old.revision >= e.revision) {
        await commit(db, token, [
          db
            .prepare('UPDATE metrics_control SET cursor=? WHERE id=1')
            .bind(e.seq),
        ])
        processed++
        continue
      }
      const key = dimension(e)
      const q = (await db
        .prepare('SELECT * FROM metrics_queue WHERE dimension=?')
        .bind(key)
        .first<QueueRow>()) ?? {
        dimension: key,
        queue_id: e.queue_id,
        venue_id: e.venue_id,
        organization_id: e.organization_id,
        service_type: e.service_type,
        timezone: e.timezone,
        people: 0,
        integrated_at: e.at,
        coverage_since: e.at,
      }
      // A late commit invalidates temporal coverage (never silently fabricates occupancy).
      if (e.at < q.integrated_at)
        q.coverage_since = Math.max(q.coverage_since, q.integrated_at)
      const statements = integrate(db, q, Math.max(e.at, q.integrated_at))
      if (q.integrated_at < e.at) {
        await commit(db, token, [...statements, saveQueue(db, q)])
        return { busy: false, processed }
      }
      const previousPeople = old?.status === 'waiting' ? old.party_size : 0
      q.people += (e.status === 'waiting' ? e.party_size : 0) - previousPeople
      if (q.people < 0) throw new Error('metrics_negative_balance')
      // Never resurrect expired rollup partitions for corrections outside retention.
      if (localParts(e.created_at, e.timezone).date >= retentionDate(now))
        statements.push(...dailyCounts(db, q, e, old))
      statements.push(
        saveQueue(db, q),
        db
          .prepare(
            `INSERT INTO metrics_entry(entry_id,queue_id,revision,dimension,created_at,status,party_size,first_called_at,updated_at,historical) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,party_size=excluded.party_size,first_called_at=excluded.first_called_at,updated_at=excluded.updated_at`,
          )
          .bind(
            e.entry_id,
            e.queue_id,
            e.revision,
            key,
            e.created_at,
            e.status,
            e.party_size,
            e.first_called_at,
            e.at,
            e.historical,
          ),
        db
          .prepare('UPDATE metrics_control SET cursor=? WHERE id=1')
          .bind(e.seq),
      )
      await commit(db, token, statements)
      processed++
    }
    if (events.results.length === maxWork) return { busy: false, processed }
    const queues = await db
      .prepare(
        'SELECT * FROM metrics_queue WHERE dimension>? ORDER BY dimension LIMIT 10',
      )
      .bind(c.integrate_after)
      .all<QueueRow>()
    for (const q of queues.results) {
      const statements = integrate(db, q, c.target_at)
      statements.push(saveQueue(db, q))
      if (q.integrated_at >= c.target_at)
        statements.push(
          db
            .prepare('UPDATE metrics_control SET integrate_after=? WHERE id=1')
            .bind(q.dimension),
        )
      await commit(db, token, statements)
      if (q.integrated_at < c.target_at) return { busy: false, processed }
    }
    if (queues.results.length < 10) {
      const repair = await reconciliationStatements(db, now)
      await commit(db, token, [
        ...repair,
        db.prepare(
          "UPDATE metrics_control SET last_complete_at=target_at,target_at=NULL,target_seq=NULL,integrate_after='' WHERE id=1",
        ),
      ])
    }
    return { busy: false, processed }
  } finally {
    await db
      .prepare(
        'UPDATE metrics_control SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?',
      )
      .bind(token)
      .run()
  }
}

/** Bounded deletes. Keep pending and expired (restorable) states and all unprocessed facts. */
export async function purgeMetrics(env: CloudflareBindings, now = Date.now()) {
  const db = env.DB,
    cutoff = now - 90 * DAY,
    date = retentionDate(now)
  await db.batch([
    db
      .prepare(
        'DELETE FROM metrics_event WHERE seq IN (SELECT seq FROM metrics_event WHERE at<? AND seq<=(SELECT cursor FROM metrics_control WHERE id=1) ORDER BY at LIMIT 200)',
      )
      .bind(cutoff),
    db
      .prepare(
        "DELETE FROM metrics_identity WHERE entry_id IN (SELECT entry_id FROM metrics_entry WHERE updated_at<? AND status IN ('completed','served','cancelled','no_show') AND NOT EXISTS(SELECT 1 FROM metrics_event e WHERE e.entry_id=metrics_entry.entry_id AND e.seq>(SELECT cursor FROM metrics_control WHERE id=1)) LIMIT 100)",
      )
      .bind(cutoff),
    db
      .prepare(
        "DELETE FROM metrics_entry WHERE entry_id IN (SELECT entry_id FROM metrics_entry WHERE updated_at<? AND status IN ('completed','served','cancelled','no_show') AND NOT EXISTS(SELECT 1 FROM metrics_identity i WHERE i.entry_id=metrics_entry.entry_id) LIMIT 100)",
      )
      .bind(cutoff),
    db
      .prepare(
        'DELETE FROM metrics_hourly WHERE rowid IN (SELECT rowid FROM metrics_hourly WHERE date<? LIMIT 500)',
      )
      .bind(date),
    db
      .prepare(
        'DELETE FROM metrics_dirty WHERE rowid IN (SELECT rowid FROM metrics_dirty WHERE date<? LIMIT 100)',
      )
      .bind(new Date(cutoff).toISOString().slice(0, 10)),
    db
      .prepare(
        'DELETE FROM metrics_daily WHERE rowid IN (SELECT rowid FROM metrics_daily WHERE date<? LIMIT 100)',
      )
      .bind(date),
  ])
}

/** Drain bounded pages inside one scheduled invocation, not one page per quarter hour.
 * The wall-clock deadline leaves headroom for retention and runtime cleanup. */
export async function runMetricsCut(
  env: CloudflareBindings,
  cut = Date.now() - 30000,
) {
  const deadline = Date.now() + 20000
  for (let page = 0; page < 12 && Date.now() < deadline; page++) {
    const result = await processMetrics(env, cut)
    if (result.busy) return
    const control = await env.DB.prepare(
      'SELECT target_at FROM metrics_control WHERE id=1',
    ).first<{ target_at: number | null }>()
    if (control?.target_at === null) return
  }
}
