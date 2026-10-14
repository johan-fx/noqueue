import { advanceMetricsBackfill } from './backfill'
import { metricsQueryLimit } from './budget'
import { purgeMetrics, runMetricsCut } from './processor'
import { recordCaptureState } from './reconcile'

export async function runScheduledMetrics(env: CloudflareBindings) {
  await recordCaptureState(env)
  if (env.METRICS_CAPTURE_ENABLED !== 'true') return
  await advanceMetricsBackfill(env)
  await runMetricsCut(env)
  await purgeMetrics(env)
}

export function stagingMetricsRecoveryEnabled(env: CloudflareBindings) {
  return env.APP_ENV === 'staging' && env.METRICS_CRON_RECOVERY_ENABLED === 'true'
}

/** Opt-in staging recovery for an undelivered dedicated trigger. Called AFTER
 * operational maintenance; never moves queue state or dispatches notifications.
 * The processor's existing lease/fence and coordinator serialization also make
 * a late delivery of the dedicated trigger safe during config propagation. */
export async function recoverScheduledMetrics(env: CloudflareBindings) {
  if (!stagingMetricsRecoveryEnabled(env)) return
  try {
    if (env.METRICS_CAPTURE_ENABLED !== 'true') {
      await recordCaptureState(env)
      return
    }
    const due = await env.DB.prepare(`
      SELECT 1 AS due FROM metrics_control c WHERE c.id=1 AND (
        c.last_complete_at IS NULL OR c.target_at IS NOT NULL OR c.last_complete_at<=?
        OR EXISTS(SELECT 1 FROM queue q LEFT JOIN metrics_backfill b ON b.queue_id=q.id
          WHERE q.id!='confirmation-experiment' AND b.completed_at IS NULL)
        OR EXISTS(SELECT 1 FROM metrics_backfill b WHERE b.completed_at>c.last_complete_at)
      )`).bind(Date.now() - 30000 - 15 * 60000).first()
    if (!due) return
    console.info({ event: 'metrics_cron_recovery_started' })
    // Share the invocation with operational work: reserve substantially more
    // headroom than the standalone analytics job. Respect a lower custom limit.
    await runScheduledMetrics({
      ...env,
      METRICS_D1_QUERY_BUDGET: String(Math.min(256, metricsQueryLimit(env))),
    })
  } catch {
    // A metrics failure must not turn successful queue maintenance into a failed
    // invocation. No cursor is fabricated; unfinished work is retried next tick.
    console.error({ event: 'metrics_cron_recovery_failed' })
  }
}
