import { historicalServiceType } from './historical-service'

type RepairRow = {
  entry_id: string
  queue_id: string
  venue_id: string
  organization_id: string
  service_type: string
  timezone: string
  created_at: number
  historical: number
  service_window_id: string | null
  dimension: string
  revision: number
  version: number
  status: string
  live_status: string
}

/** Operator-only repair, NOT an HTTP endpoint or part of the scheduled worker.
 * Only complete, settled unknown dimensions can move. Atomic fences reject
 * concurrent capture/cuts, partial cohorts, live occupancy and missing detail. */
export async function repairHistoricalService(
  env: { APP_ENV: string; DB: D1Database },
  input: {
    venueId: string
    entryIds: string[]
    capturedSince: string
    apply?: boolean
  }
) {
  if (env.APP_ENV !== 'staging') throw new Error('staging_only')
  if (
    !input.entryIds.length ||
    input.entryIds.length > 100 ||
    new Set(input.entryIds).size !== input.entryIds.length
  )
    throw new Error('invalid_cohort')
  const db = env.DB
  const rows = await db
    .prepare(
      `SELECT i.*,e.service_window_id,e.version,e.status live_status,
    m.dimension,m.revision,m.status FROM metrics_identity i
    JOIN queue_entry e ON e.id=i.entry_id AND e.queue_id=i.queue_id
    JOIN queue q ON q.id=i.queue_id AND q.venue_id=i.venue_id
    JOIN metrics_entry m ON m.entry_id=i.entry_id AND m.queue_id=i.queue_id
    WHERE i.venue_id=? AND i.entry_id IN (SELECT value FROM json_each(?)) ORDER BY i.entry_id`
    )
    .bind(input.venueId, JSON.stringify(input.entryIds))
    .all<RepairRow>()
  const wanted = new Set(input.entryIds)
  const cohort = rows.results.filter((r) => wanted.has(r.entry_id))
  if (cohort.length !== wanted.size)
    throw new Error('cohort_missing_or_wrong_venue')
  const groups = new Map<
    string,
    { target: string; type: string; rows: RepairRow[] }
  >()
  const totals: Record<string, number> = {}
  for (const r of cohort) {
    const type = historicalServiceType(
      r.service_window_id,
      r.created_at,
      input.capturedSince
    )
    if (
      type === 'unknown' ||
      r.historical !== 1 ||
      r.revision !== r.version ||
      r.status !== r.live_status ||
      !['completed', 'served', 'cancelled', 'no_show', 'expired'].includes(
        r.status
      )
    )
      throw new Error('ambiguous_or_unsettled_cohort')
    totals[type] = (totals[type] ?? 0) + 1
    const target = JSON.stringify([r.queue_id, type, r.timezone])
    if (r.service_type === type && r.dimension === target) continue // Idempotent retry.
    if (
      r.service_type !== 'unknown' ||
      r.dimension !== JSON.stringify([r.queue_id, 'unknown', r.timezone])
    )
      throw new Error('conflicting_classification')
    const g = groups.get(r.dimension) ?? { target, type, rows: [] }
    if (g.target !== target)
      throw new Error('mixed_snapshot_types_in_dimension')
    g.rows.push(r)
    groups.set(r.dimension, g)
  }
  const statements: D1PreparedStatement[] = []
  const guard = (condition: string, args: (string | number | null)[] = []) =>
    db
      .prepare(
        `INSERT INTO metrics_fence(ok) SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END`
      )
      .bind(...args)
  statements.push(
    guard(
      `EXISTS(SELECT 1 FROM metrics_control WHERE id=1 AND lease_until<?
    AND target_at IS NULL AND cursor>=COALESCE((SELECT MAX(seq) FROM metrics_event),0))`,
      [Date.now()]
    )
  )
  for (const [source, g] of groups) {
    const r = g.rows[0]!
    // Full source dimension ownership: no silent movement of unlisted/other-venue turns.
    statements.push(
      guard(
        `(SELECT COUNT(*) FROM metrics_entry WHERE dimension=?)=?
      AND (SELECT COUNT(*) FROM metrics_identity WHERE queue_id=? AND timezone=? AND service_type='unknown')=?
      AND (SELECT SUM(generated) FROM metrics_daily WHERE dimension=?)=?
      AND (SELECT SUM(generated) FROM metrics_hourly WHERE dimension=?)=?
      AND EXISTS(SELECT 1 FROM metrics_queue WHERE dimension=? AND venue_id=? AND people=0)
      AND NOT EXISTS(SELECT 1 FROM metrics_daily WHERE dimension=? AND (people_ms!=0 OR pending!=0))
      AND NOT EXISTS(SELECT 1 FROM metrics_hourly WHERE dimension=? AND people_ms!=0)`,
        [
          source,
          g.rows.length,
          r.queue_id,
          r.timezone,
          g.rows.length,
          source,
          g.rows.length,
          source,
          g.rows.length,
          source,
          input.venueId,
          source,
          source,
        ]
      )
    )
    for (const e of g.rows)
      statements.push(
        guard(
          `EXISTS(SELECT 1 FROM metrics_identity i
      JOIN queue_entry e ON e.id=i.entry_id JOIN metrics_entry m ON m.entry_id=i.entry_id
      WHERE i.entry_id=? AND i.venue_id=? AND i.organization_id=? AND i.queue_id=? AND e.queue_id=i.queue_id
      AND i.service_type='unknown' AND i.historical=1 AND i.timezone=? AND i.created_at=?
      AND e.service_window_id=? AND e.version=? AND m.revision=e.version AND m.dimension=?
      AND m.status=? AND e.status=m.status)`,
          [
            e.entry_id,
            input.venueId,
            e.organization_id,
            e.queue_id,
            e.timezone,
            e.created_at,
            e.service_window_id,
            e.version,
            source,
            e.status,
          ]
        )
      )
    // Preserve the destination's observed coverage. The empty unknown baseline
    // overlaps it and must NOT be added (that would double observation time).
    statements.push(
      db
        .prepare(
          `INSERT INTO metrics_queue
      SELECT ?,queue_id,venue_id,organization_id,?,timezone,0,integrated_at,coverage_since
      FROM metrics_queue WHERE dimension=? ON CONFLICT(dimension) DO NOTHING`
        )
        .bind(g.target, g.type, source)
    )
    const daily = [
      'generated',
      'completed',
      'cancelled',
      'no_show',
      'pending',
      'unknown',
      'wait_sum_ms',
      'wait_samples',
    ]
    const hourly = ['generated', 'wait_sum_ms', 'wait_samples']
    for (const [table, keys, counts, historical] of [
      ['metrics_daily', ['date'], daily, true],
      [
        'metrics_hourly',
        ['date', 'hour', 'bucket_at', 'bucket_end'],
        hourly,
        false,
      ],
    ] as const) {
      const fields = [...keys, ...counts, ...(historical ? ['historical'] : [])]
      statements.push(
        db
          .prepare(
            `INSERT INTO ${table}(dimension,queue_id,venue_id,organization_id,service_type,timezone,${fields.join(
              ','
            )})
        SELECT ?,queue_id,venue_id,organization_id,?,timezone,${fields.join(
          ','
        )} FROM ${table} WHERE dimension=?
        ON CONFLICT(dimension,${
          historical ? 'date' : 'bucket_at'
        }) DO UPDATE SET
        ${counts.map((c) => `${c}=${c}+excluded.${c}`).join(',')}${
              historical
                ? ',historical=MAX(historical,excluded.historical)'
                : ''
            }`
          )
          .bind(g.target, g.type, source)
      )
    }
    statements.push(
      db
        .prepare('UPDATE metrics_entry SET dimension=? WHERE dimension=?')
        .bind(g.target, source),
      db
        .prepare(
          `UPDATE metrics_event SET service_type=? WHERE queue_id=? AND venue_id=? AND timezone=? AND service_type='unknown' AND historical=1 AND entry_id IN (SELECT value FROM json_each(?))`
        )
        .bind(
          g.type,
          r.queue_id,
          input.venueId,
          r.timezone,
          JSON.stringify(g.rows.map((e) => e.entry_id))
        ),
      db
        .prepare(
          `UPDATE metrics_identity SET service_type=? WHERE queue_id=? AND venue_id=? AND timezone=? AND service_type='unknown' AND historical=1`
        )
        .bind(g.type, r.queue_id, input.venueId, r.timezone),
      db
        .prepare(
          'INSERT OR IGNORE INTO metrics_dirty SELECT ?,date FROM metrics_dirty WHERE dimension=?'
        )
        .bind(g.target, source),
      ...[
        'metrics_daily',
        'metrics_hourly',
        'metrics_dirty',
        'metrics_queue',
      ].map((table) =>
        db.prepare(`DELETE FROM ${table} WHERE dimension=?`).bind(source)
      )
    )
  }
  // Invalidate even an expired processor's token. Its later commit must fail.
  statements.push(
    db
      .prepare(
        'UPDATE metrics_control SET lease_token=?,lease_until=0 WHERE id=1'
      )
      .bind(crypto.randomUUID()),
    db.prepare('DELETE FROM metrics_fence')
  )
  const changed = [...groups.values()].reduce((n, g) => n + g.rows.length, 0)
  if (input.apply && changed) await db.batch(statements)
  return { changed, totals, applied: !!input.apply && changed > 0 }
}
