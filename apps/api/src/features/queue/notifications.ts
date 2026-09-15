import { confirmEntry, confirmationExperimentEnabled } from './confirmation'
import {
  queueCoordinator,
  experimentQueueId,
  openExperimentRecipientAllowed,
} from './experiment'
import { z } from 'zod'
import { createWhatsAppSender } from '../../integrations/360dialog'
import { decryptPhone, recoveryToken } from './crypto'
export const jobSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dispatch-notification'),
    notificationId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('process-webhook'),
    webhookEventId: z.string().uuid(),
  }),
])
export async function dispatchNotification(
  env: CloudflareBindings,
  id: string,
) {
  const entry = await env.DB.prepare(
    'SELECT e.queue_id FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE n.id=?',
  )
    .bind(id)
    .first<{ queue_id: string }>()
  if (entry?.queue_id === experimentQueueId)
    return queueCoordinator(env, entry.queue_id).dispatch(id)
  return dispatchNotificationSerialized(env, id)
}

export async function dispatchNotificationSerialized(
  env: CloudflareBindings,
  id: string,
) {
  if (env.WHATSAPP_ENABLED !== 'true') return
  const row = await env.DB.prepare(
    `SELECT n.status,n.attempts,n.kind,n.position,e.status AS entry_status,e.queue_id,e.sequence,f.payload,f.expires_at,e.id,e.locale,e.code,c.phone_cipher,c.phone_hash,v.name AS venue
    FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id JOIN queue_entry_contact c ON c.entry_id=e.id
    LEFT JOIN queue_confirmation f ON f.entry_id=e.id
    JOIN queue q ON q.id=e.queue_id JOIN venue v ON v.id=q.venue_id WHERE n.id=?`,
  )
    .bind(id)
    .first<{
      status: string
      position: number | null
      entry_status: string
      queue_id: string
      sequence: number
      kind: string
      payload: string | null
      expires_at: number | null
      attempts: number
      id: string
      locale: 'es' | 'en'
      code: string
      phone_cipher: string
      phone_hash: string
      venue: string
    }>()
  if (!row || row.status !== 'pending') return
  if (
    row.kind === 'confirmation' &&
    (!confirmationExperimentEnabled(env) || !row.payload)
  )
    return
  if (row.kind === 'confirmation' && (row.expires_at ?? 0) <= Date.now()) {
    await env.DB.prepare(
      "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE id=? AND status='pending'",
    )
      .bind(Date.now(), id)
      .run()
    return
  }
  if (row.kind === 'position_update') {
    const eligible = await env.DB.prepare(
      `SELECT 1 FROM whatsapp_contact_state w WHERE w.phone_hash=? AND w.stopped_at IS NULL AND w.last_inbound_at>?
      AND ?='waiting' AND ?=(SELECT COUNT(*) FROM queue_entry WHERE queue_id=? AND status='waiting' AND sequence<=?)
      AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE entry_id=? AND kind='position_update' AND status IN ('sending','unknown'))`,
    )
      .bind(
        row.phone_hash,
        Date.now() - 86400000,
        row.entry_status,
        row.position,
        row.queue_id,
        row.sequence,
        row.id,
      )
      .first()
    if (!confirmationExperimentEnabled(env) || !eligible) {
      await env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE id=? AND status='pending'",
      )
        .bind(Date.now(), id)
        .run()
      return
    }
  }
  const phone = await decryptPhone(env.PII_ENCRYPTION_KEY, row.phone_cipher)
  if (
    !openExperimentRecipientAllowed(env, row.queue_id, row.kind) &&
    !(env.WHATSAPP_RECIPIENT_ALLOWLIST ?? '')
      .split(',')
      .map((p) => p.trim())
      .includes(phone)
  ) {
    await env.DB.prepare(
      "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE id=? AND status='pending'",
    )
      .bind(Date.now(), id)
      .run()
    return
  }
  const now = Date.now()
  const claim = await env.DB.prepare(
    `UPDATE notification_outbox SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending' AND attempts<3 AND next_attempt_at<=?
    AND EXISTS(SELECT 1 FROM consent WHERE entry_id=notification_outbox.entry_id AND revoked_at IS NULL AND purpose=CASE notification_outbox.kind WHEN 'confirmation' THEN 'confirmation_contact' ELSE 'queue_updates' END)
    AND NOT EXISTS(SELECT 1 FROM queue_entry e JOIN queue_entry_contact p ON p.entry_id=e.id JOIN whatsapp_contact_state w ON w.phone_hash=p.phone_hash WHERE e.id=notification_outbox.entry_id AND e.queue_id='confirmation-experiment' AND w.stopped_at IS NOT NULL)
    AND (notification_outbox.kind!='position_update' OR EXISTS(SELECT 1 FROM queue_entry_contact p JOIN whatsapp_contact_state w ON w.phone_hash=p.phone_hash WHERE p.entry_id=notification_outbox.entry_id AND w.stopped_at IS NULL AND w.last_inbound_at>?))
    AND NOT EXISTS(SELECT 1 FROM webhook_event w JOIN consent c ON c.entry_id=notification_outbox.entry_id WHERE w.kind='opt_out' AND w.phone_hash=? AND w.occurred_at+999>=c.granted_at)`,
  )
    .bind(now, id, now, now - 86400000, row.phone_hash)
    .run()
  if (!claim.meta.changes) return
  const result = await createWhatsAppSender(env).send({
    phone,
    locale: row.locale,
    venue: row.venue,
    code: row.code,
    token: await recoveryToken(env, row.id),
    ...(row.kind === 'position_update' && row.position !== null
      ? { position: row.position }
      : {}),
    ...(row.kind === 'confirmation' && row.payload
      ? { confirmationPayload: row.payload }
      : {}),
  })
  if (result.kind === 'failed') {
    console.warn({
      event: 'whatsapp_send_failed',
      reason: result.diagnostic.reason,
      httpStatus: result.diagnostic.httpStatus,
      providerCode: result.diagnostic.providerCode,
    })
  }
  if (result.kind === 'accepted') {
    await env.DB.prepare(
      "UPDATE notification_outbox SET status='accepted',provider_id=?,updated_at=? WHERE id=? AND status IN ('sending','unknown')",
    )
      .bind(result.providerId, Date.now(), id)
      .run()
    const early = await env.DB.prepare(
      "SELECT id FROM webhook_event WHERE (provider_id=? OR context_id=? OR (kind='confirmation' AND phone_hash=?)) AND processed_at IS NULL ORDER BY occurred_at",
    )
      .bind(result.providerId, result.providerId, row.phone_hash)
      .all<{ id: string }>()
    for (const event of early.results) await processWebhook(env, event.id)
  } else if (result.kind === 'rate_limited') {
    if (row.attempts + 1 >= 3) {
      await env.DB.prepare(
        "UPDATE notification_outbox SET status='failed',updated_at=? WHERE id=? AND status='sending'",
      )
        .bind(Date.now(), id)
        .run()
      await deadLetter(env, id)
    } else {
      const delay =
        1000 * (30 * 2 ** row.attempts + Math.floor(Math.random() * 10))
      await env.DB.prepare(
        "UPDATE notification_outbox SET status='pending',next_attempt_at=?,updated_at=? WHERE id=? AND status='sending'",
      )
        .bind(Date.now() + delay, Date.now(), id)
        .run()
    }
  } else
    await env.DB.prepare(
      "UPDATE notification_outbox SET status=?,updated_at=? WHERE id=? AND status='sending'",
    )
      .bind(result.kind, Date.now(), id)
      .run()
}
async function deadLetter(env: CloudflareBindings, id: string) {
  await env.NOTIFICATIONS_DLQ.send({
    kind: 'dispatch-notification',
    notificationId: id,
  })
  await env.DB.prepare(
    'UPDATE notification_outbox SET dead_lettered=1 WHERE id=?',
  )
    .bind(id)
    .run()
}
export async function processWebhook(env: CloudflareBindings, id: string) {
  const event = await env.DB.prepare(
    'SELECT * FROM webhook_event WHERE id=? AND processed_at IS NULL',
  )
    .bind(id)
    .first<{
      kind: string
      provider_id: string
      status: string
      phone_hash: string
      occurred_at: number
    }>()
  if (!event) return
  const now = Date.now()
  if (event.kind === 'inbound') {
    await env.DB.prepare('UPDATE webhook_event SET processed_at=? WHERE id=?')
      .bind(now, id)
      .run()
    return
  }
  if (event.kind === 'confirmation') {
    await confirmEntry(env, id)
    return
  }
  if (event.kind === 'opt_out') {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE queue_confirmation SET revoked_at=? WHERE revoked_at IS NULL AND contact_authorized_at<=?
        AND entry_id IN (SELECT entry_id FROM queue_entry_contact WHERE phone_hash=?)`,
      ).bind(now, event.occurred_at + 999, event.phone_hash),
      env.DB.prepare(
        `UPDATE consent SET revoked_at=? WHERE organization_id='demo-org' AND purpose IN ('queue_updates','confirmation_contact') AND revoked_at IS NULL AND (granted_at<=? OR entry_id IN (SELECT entry_id FROM queue_confirmation WHERE revoked_at IS NOT NULL))
        AND entry_id IN (SELECT entry_id FROM queue_entry_contact WHERE phone_hash=?)`,
      ).bind(now, event.occurred_at + 999, event.phone_hash),
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE (status='pending' OR (kind='confirmation' AND status='sending')) AND entry_id IN (SELECT entry_id FROM consent WHERE revoked_at IS NOT NULL)",
      ).bind(now),
      env.DB.prepare('UPDATE webhook_event SET processed_at=? WHERE id=?').bind(
        now,
        id,
      ),
    ])
    return
  }
  const notification = await env.DB.prepare(
    'SELECT id FROM notification_outbox WHERE provider_id=?',
  )
    .bind(event.provider_id)
    .first<{ id: string }>()
  // An event may precede the POST response. Keep it pending until acceptance can correlate it.
  if (!notification) return
  const rank: Record<string, number> = {
    sending: 0,
    unknown: 0,
    accepted: 1,
    failed: 3,
    sent: 2,
    delivered: 4,
    read: 5,
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE notification_outbox SET status=?,updated_at=? WHERE id=? AND
      CASE status WHEN 'sending' THEN 0 WHEN 'unknown' THEN 0 WHEN 'accepted' THEN 1 WHEN 'failed' THEN 3 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5 ELSE 99 END < ?`,
    ).bind(event.status, now, notification.id, rank[event.status] ?? 0),
    env.DB.prepare('UPDATE webhook_event SET processed_at=? WHERE id=?').bind(
      now,
      id,
    ),
  ])
}
export async function reconcile(env: CloudflareBindings) {
  const now = Date.now()
  await env.DB.prepare(
    "UPDATE notification_outbox SET status='unknown',updated_at=? WHERE status='sending' AND updated_at<?",
  )
    .bind(now, now - 120000)
    .run()
  const notifications = await env.DB.prepare(
    "SELECT id FROM notification_outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY updated_at LIMIT 100",
  )
    .bind(now)
    .all<{ id: string }>()
  const events = await env.DB.prepare(
    `SELECT w.id FROM webhook_event w WHERE w.processed_at IS NULL AND (w.kind IN ('opt_out','confirmation','inbound') OR EXISTS(SELECT 1 FROM notification_outbox n WHERE n.provider_id=w.provider_id)) ORDER BY w.received_at LIMIT 100`,
  ).all<{ id: string }>()
  for (const row of notifications.results)
    await env.NOTIFICATIONS.send({
      kind: 'dispatch-notification',
      notificationId: row.id,
    })
  for (const row of events.results)
    await env.NOTIFICATIONS.send({
      kind: 'process-webhook',
      webhookEventId: row.id,
    })
  const dead = await env.DB.prepare(
    "SELECT id FROM notification_outbox WHERE status='failed' AND attempts>=3 AND dead_lettered=0 LIMIT 100",
  ).all<{ id: string }>()
  for (const row of dead.results) await deadLetter(env, row.id)
}
