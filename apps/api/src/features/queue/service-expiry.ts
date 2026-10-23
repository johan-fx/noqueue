import { loadQueueState, commitQueueTransition } from './projection'
import { storedServiceSchema } from '@noqueue/contracts/staff'
import { serviceDeadline, serviceWindow } from '../staff/availability'

/** All callers hold the queue coordinator. No projections or recursive RPCs here. */
export async function maintainServiceEntries(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  const legacy = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM queue_entry WHERE queue_id=? AND status='waiting' AND manual_only=0 AND service_window_id IS NULL",
  )
    .bind(queueId)
    .first<{ count: number }>()
  if (legacy?.count) {
    const row = await env.DB.prepare(
      'SELECT q.config,v.timezone FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=?',
    )
      .bind(queueId)
      .first<{ config: string | null; timezone: string }>()
    let parsed
    try {
      parsed = storedServiceSchema.safeParse(
        row?.config ? JSON.parse(row.config) : null,
      )
    } catch {
      // Invalid legacy configuration is not authority to cancel turns.
    }
    if (parsed?.success && row) {
      const config = parsed.data,
        at = new Date(now)
      let window: ReturnType<typeof serviceWindow> | undefined
      let snapshot: ReturnType<typeof serviceDeadline> = null
      try {
        window = serviceWindow(config, row.timezone, at)
        snapshot = serviceDeadline(config, row.timezone, at)
      } catch {
        console.error({
          event: 'service_expiry_schedule_invalid',
          count: legacy.count,
        })
      }
      if (window && (snapshot || !window.serviceOpen)) {
        await env.DB.prepare(
          "UPDATE queue_entry SET service_window_id=?,service_ends_at=? WHERE queue_id=? AND status='waiting' AND manual_only=0 AND service_window_id IS NULL",
        )
          .bind(
            snapshot?.windowId ?? 'legacy:closed',
            snapshot?.endsAt ?? (snapshot ? null : now),
            queueId,
          )
          .run()
        console.info({
          event: 'service_expiry_initialized',
          count: legacy.count,
        })
      } else
        console.warn({
          event: 'service_expiry_unresolved',
          count: legacy.count,
        })
    } else
      console.info({
        event: 'service_expiry_unclassified',
        count: legacy.count,
      })
  }
  const due = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM queue_entry WHERE queue_id=? AND status='waiting' AND manual_only=0 AND service_ends_at<=?",
  )
    .bind(queueId, now)
    .first<{ count: number }>()
  const configured = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
    .bind(queueId)
    .first<{ config: string | null }>()
  let serviceAssignmentEnabled = false
  let cycleStopReason: 'disabled' | 'context_changed' = 'disabled'
  if (configured?.config && env.QUEUE_AUTO_REPLACEMENT_ENABLED === 'true') {
    try {
      const raw = JSON.parse(configured.config) as unknown
      const rawEnabled =
        typeof raw === 'object' && raw !== null &&
        'automaticAssignmentEnabled' in raw &&
        (raw as { automaticAssignmentEnabled?: unknown }).automaticAssignmentEnabled === true
      const parsed = storedServiceSchema.safeParse(raw)
      serviceAssignmentEnabled = parsed.success && rawEnabled
      if (rawEnabled && !parsed.success) cycleStopReason = 'context_changed'
    } catch {
      // Invalid configuration fails closed for automatic cycles.
    }
  }
  // A cycle is bounded by the physical service window, independently of whether
  // any waiting entry remains to be retained at this sweep. A disabled global
  // kill flag or per-service opt-in also stops the cycle permanently; turning
  // either flag back on must not resurrect an old cycle.
  const stopCycles = env.DB.prepare(
    `UPDATE queue_automation_cycle SET state='stopped',
       reason=CASE WHEN service_ends_at IS NOT NULL AND service_ends_at<=? THEN 'service_ended' ELSE ? END,
       version=version+1,updated_at=?
     WHERE queue_id=? AND state='active'
       AND ((service_ends_at IS NOT NULL AND service_ends_at<=?) OR ?=0)`,
  ).bind(now, cycleStopReason, now, queueId, now, Number(serviceAssignmentEnabled))
  if (!due?.count) {
    await stopCycles.run()
    return
  }
  const dueEntries = await env.DB.prepare(
    "SELECT id FROM queue_entry WHERE queue_id=? AND status='waiting' AND manual_only=0 AND service_ends_at<=?",
  )
    .bind(queueId, now)
    .all<{ id: string }>()
  const before = await loadQueueState(env, queueId, now)
  const expired = new Set(dueEntries.results.map((entry) => entry.id))
  // Retain expired pending turns for staff operations only. Do not emit a
  // cancellation event/notice: the turn is still waiting, but is no longer in
  // the public/forecastable queue. Pending forecasts must not dispatch later.
  await commitQueueTransition(
    env,
    queueId,
    before,
    {
      config: before.config,
      holds: before.holds,
      parties: before.parties.filter((p) => !expired.has(p.id)),
      allocations: before.allocations.map((a) =>
        expired.has(a.entry_id) && a.released_at === null
          ? { ...a, released_at: now, outcome: 'cancelled' }
          : a,
      ),
    },
    [
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE status='pending' AND entry_id IN (SELECT id FROM queue_entry WHERE queue_id=? AND status='waiting' AND manual_only=0 AND service_ends_at<=?)",
      ).bind(now, queueId, now),
      env.DB.prepare(
        "UPDATE queue_entry SET manual_only=1,priority_rank=NULL,version=version+1 WHERE queue_id=? AND status='waiting' AND manual_only=0 AND service_ends_at<=?",
      ).bind(queueId, now),
      stopCycles,
    ],
    now,
    'service.ended',
  )
  console.info({ event: 'service_expiry_retained', count: due.count })
}
