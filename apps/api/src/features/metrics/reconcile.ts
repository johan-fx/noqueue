import { DAY, localParts, midnight, shiftDate } from './calculation'

/** Only recent COMPLETE-detail partitions can be rebuilt. Old aggregates are never reconstructed. */
export async function reconciliationStatements(db: D1Database, now: number) {
  const partitions = await db
    .prepare(
      `SELECT x.dimension,x.date,q.timezone FROM metrics_dirty x JOIN metrics_queue q ON q.dimension=x.dimension WHERE x.date>? AND x.date<? ORDER BY x.date LIMIT 2`,
    )
    .bind(
      new Date(now - 89 * DAY).toISOString().slice(0, 10),
      new Date(now).toISOString().slice(0, 10),
    )
    .all<{ dimension: string; date: string; timezone: string }>()
  const statements: D1PreparedStatement[] = []
  const counts = `COUNT(*) generated,
    COALESCE(SUM(status IN ('completed','served')),0) completed,
    COALESCE(SUM(status='cancelled'),0) cancelled,
    COALESCE(SUM(status IN ('no_show','expired')),0) no_show,
    COALESCE(SUM(status IN ('waiting','called')),0) pending,
    COALESCE(SUM(status NOT IN ('completed','served','cancelled','no_show','expired','waiting','called')),0) unknown,
    COALESCE(SUM(CASE WHEN first_called_at>=created_at THEN first_called_at-created_at ELSE 0 END),0) wait_sum_ms,
    COALESCE(SUM(first_called_at>=created_at),0) wait_samples`
  for (const p of partitions.results) {
    if (p.date >= localParts(now, p.timezone).date) continue
    const start = midnight(p.date, p.timezone),
      end = midnight(shiftDate(p.date, 1), p.timezone)
    const row = await db
      .prepare(
        `SELECT ${counts} FROM metrics_entry WHERE dimension=? AND created_at>=? AND created_at<?`,
      )
      .bind(p.dimension, start, end)
      .first<Record<string, number>>()
    if (!row) continue
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
    statements.push(
      db
        .prepare(
          `UPDATE metrics_daily SET ${columns
            .map((c) => `${c}=?`)
            .join(',')} WHERE dimension=? AND date=?`,
        )
        .bind(...columns.map((c) => row[c]!), p.dimension, p.date),
    )
    // Correlated indexed range sums keep this bounded to one queue/day, never its whole history.
    statements.push(
      db
        .prepare(
          `UPDATE metrics_hourly SET
      generated=(SELECT COUNT(*) FROM metrics_entry e WHERE e.dimension=metrics_hourly.dimension AND e.created_at>=bucket_at AND e.created_at<bucket_end),
      wait_sum_ms=(SELECT COALESCE(SUM(CASE WHEN first_called_at>=created_at THEN first_called_at-created_at ELSE 0 END),0) FROM metrics_entry e WHERE e.dimension=metrics_hourly.dimension AND e.created_at>=bucket_at AND e.created_at<bucket_end),
      wait_samples=(SELECT COALESCE(SUM(first_called_at>=created_at),0) FROM metrics_entry e WHERE e.dimension=metrics_hourly.dimension AND e.created_at>=bucket_at AND e.created_at<bucket_end)
      WHERE dimension=? AND date=?`,
        )
        .bind(p.dimension, p.date),
    )
    statements.push(
      db
        .prepare('DELETE FROM metrics_dirty WHERE dimension=? AND date=?')
        .bind(p.dimension, p.date),
    )
  }
  return statements
}

/** Persist an uncaptured write in its operational transaction, not at the next tick.
 * Reopen the same conservative gap if capture toggles again before the cut advances.
 * No per-turn facts or personal data are stored while capture is disabled. */
export function captureGapStatement(db: D1Database, now: number) {
  return db
    .prepare(
      `INSERT INTO metrics_capture_gap(started_at)
    SELECT MIN(COALESCE(last_complete_at,?),?) FROM metrics_control
    WHERE id=1 AND NOT EXISTS(SELECT 1 FROM metrics_capture_gap WHERE ended_at IS NULL)
    ON CONFLICT(started_at) DO UPDATE SET ended_at=NULL`,
    )
    .bind(now, now)
}

export async function recordCaptureState(
  env: CloudflareBindings,
  now = Date.now(),
) {
  if (env.METRICS_CAPTURE_ENABLED !== 'true') {
    await captureGapStatement(env.DB, now).run()
    return
  }
  // All predicates execute in one transaction. Concurrent resumptions cannot reset
  // backfill a second time after another invocation has already closed the gap.
  await env.DB.batch([
    env.DB
      .prepare(`UPDATE metrics_backfill SET phase=0,after_created=0,after_id='',completed_at=NULL,
      repair_since=CASE WHEN completed_at IS NULL AND repair_since IS NULL THEN NULL
        WHEN completed_at IS NOT NULL THEN (SELECT MIN(started_at) FROM metrics_capture_gap WHERE ended_at IS NULL)
        ELSE MIN(COALESCE(repair_since,(SELECT MIN(started_at) FROM metrics_capture_gap WHERE ended_at IS NULL)),
          (SELECT MIN(started_at) FROM metrics_capture_gap WHERE ended_at IS NULL)) END
      WHERE EXISTS(SELECT 1 FROM metrics_capture_gap WHERE ended_at IS NULL)`),
    env.DB.prepare(
      `UPDATE metrics_queue SET coverage_since=MAX(coverage_since,?)
      WHERE EXISTS(SELECT 1 FROM metrics_capture_gap WHERE ended_at IS NULL)`,
    ).bind(now),
    env.DB.prepare(
      'UPDATE metrics_capture_gap SET ended_at=MAX(started_at,?) WHERE ended_at IS NULL',
    ).bind(now),
  ])
}
