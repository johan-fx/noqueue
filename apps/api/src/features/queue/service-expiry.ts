import { storedServiceSchema } from '@noqueue/contracts/staff'
import { serviceDeadline, serviceWindow } from '../staff/availability'
import { noticeStatement, publishNotice, type QueueNoticeSnapshot } from './notices'

/** All callers hold the queue coordinator. No projections or recursive RPCs here. */
export async function maintainServiceEntries(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  const legacy = await env.DB.prepare("SELECT COUNT(*) AS count FROM queue_entry WHERE queue_id=? AND status='waiting' AND service_window_id IS NULL")
    .bind(queueId).first<{ count: number }>()
  if (legacy?.count) {
    const row = await env.DB.prepare('SELECT q.config,v.timezone FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=?')
      .bind(queueId).first<{ config: string | null; timezone: string }>()
    let parsed
    try {
      parsed = storedServiceSchema.safeParse(row?.config ? JSON.parse(row.config) : null)
    } catch {
      // Invalid legacy configuration is not authority to cancel turns.
    }
    if (parsed?.success && row) {
      const config = parsed.data, at = new Date(now)
      let window: ReturnType<typeof serviceWindow> | undefined
      let snapshot: ReturnType<typeof serviceDeadline> = null
      try {
        window = serviceWindow(config, row.timezone, at)
        snapshot = serviceDeadline(config, row.timezone, at)
      } catch {
        console.error({ event: 'service_expiry_schedule_invalid', count: legacy.count })
      }
      if (window && (snapshot || !window.serviceOpen)) {
        await env.DB.prepare("UPDATE queue_entry SET service_window_id=?,service_ends_at=? WHERE queue_id=? AND status='waiting' AND service_window_id IS NULL")
          .bind(snapshot?.windowId ?? 'legacy:closed', snapshot?.endsAt ?? (snapshot ? null : now), queueId).run()
        console.info({ event: 'service_expiry_initialized', count: legacy.count })
      } else console.warn({ event: 'service_expiry_unresolved', count: legacy.count })
    } else console.info({ event: 'service_expiry_unclassified', count: legacy.count })
  }
  const due = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM queue_entry WHERE queue_id=? AND status='waiting' AND service_ends_at<=?",
  ).bind(queueId, now).first<{ count: number }>()
  if (!due?.count) return
  const dueEntries = await env.DB.prepare(
    "SELECT id FROM queue_entry WHERE queue_id=? AND status='waiting' AND service_ends_at<=?",
  )
    .bind(queueId, now)
    .all<{ id: string }>()
  const configured = await env.DB.prepare(
    'SELECT config FROM queue WHERE id=?',
  )
    .bind(queueId)
    .first<{ config: string | null }>()
  let serviceName = 'Service'
  if (configured?.config) {
    try {
      const parsed = storedServiceSchema.safeParse(JSON.parse(configured.config))
      if (parsed.success) serviceName = parsed.data.name
    } catch {
      // A malformed legacy config is not authority to expose a partial payload.
    }
  }
  const snapshot: QueueNoticeSnapshot = {
    schemaVersion: 2,
    serviceName,
    ahead: null,
    etaMinutes: null,
    predictedAt: null,
    estimateQuality: 'unknown',
    resourceName: null,
    arrivalDeadlineAt: null,
    reason: 'service_ended',
  }
  // Four set-based statements keep the commit bounded even for a large queue.
  // Deterministic internal event identities prevent duplicate closure evidence.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO queue_event(id,entry_id,kind,created_at) SELECT 'service-ended:'||id,id,'service_ended',? FROM queue_entry WHERE queue_id=? AND status='waiting' AND service_ends_at<=?",
    ).bind(now, queueId, now),
    env.DB.prepare(
      "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE status='pending' AND entry_id IN (SELECT id FROM queue_entry WHERE queue_id=? AND status='waiting' AND service_ends_at<=?)",
    ).bind(now, queueId, now),
    ...dueEntries.results.map(({ id }) =>
      noticeStatement(env, id, 'service_ended', now, snapshot),
    ),
    env.DB.prepare(
      "UPDATE queue_allocation SET released_at=?,outcome='cancelled' WHERE released_at IS NULL AND entry_id IN (SELECT id FROM queue_entry WHERE queue_id=? AND status='waiting' AND service_ends_at<=?)",
    ).bind(now, queueId, now),
    env.DB.prepare(
      "UPDATE queue_entry SET status='cancelled',version=version+1 WHERE queue_id=? AND status='waiting' AND service_ends_at<=?",
    ).bind(queueId, now),
  ])
  for (const { id } of dueEntries.results)
    await publishNotice(env, id, 'service_ended')
  console.info({ event: 'service_expiry_cancelled', count: due.count })
}
