import { deliveryTraceStatement, purgeDeliveryTrace } from './delivery-trace'
import { confirmEntry, confirmationExperimentEnabled } from './confirmation'
import { queueCoordinator, openExperimentRecipientAllowed } from './experiment'
import { z } from 'zod'
import { createWhatsAppSender } from '../../integrations/360dialog'
import { decryptPhone, recoveryToken } from './crypto'
import { evaluateEstimateNotice } from './estimate-notices'
import type { QueueNoticeSnapshot } from './notices'
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

function acceptedNoticeStateStatement(
  env: CloudflareBindings,
  input: {
    entryId: string
    predictedAt: number
    acceptedAt: number
    revision: number
    callCycle: number
    notificationId: string
    kind: string
  },
) {
  return env.DB.prepare(
    `INSERT INTO queue_notification_state(
       entry_id,last_accepted_predicted_at,last_correction_accepted_at,updated_at,
       last_accepted_at,last_accepted_call_cycle,last_accepted_revision,last_accepted_notification_id
     ) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(entry_id) DO UPDATE SET
       last_accepted_predicted_at=excluded.last_accepted_predicted_at,
       last_correction_accepted_at=CASE WHEN ? IN ('delayed','improved') THEN excluded.last_correction_accepted_at ELSE queue_notification_state.last_correction_accepted_at END,
       updated_at=excluded.updated_at,
       last_accepted_at=excluded.last_accepted_at,
       last_accepted_call_cycle=excluded.last_accepted_call_cycle,
       last_accepted_revision=excluded.last_accepted_revision,
       last_accepted_notification_id=excluded.last_accepted_notification_id
     WHERE excluded.last_accepted_at>COALESCE(queue_notification_state.last_accepted_at,-1)
       OR (excluded.last_accepted_at=queue_notification_state.last_accepted_at AND (
         excluded.last_accepted_call_cycle>queue_notification_state.last_accepted_call_cycle
         OR (excluded.last_accepted_call_cycle=queue_notification_state.last_accepted_call_cycle AND (
           excluded.last_accepted_revision>queue_notification_state.last_accepted_revision
           OR (excluded.last_accepted_revision=queue_notification_state.last_accepted_revision AND
               excluded.last_accepted_notification_id>queue_notification_state.last_accepted_notification_id)
         ))
       ))`,
  ).bind(
    input.entryId,
    input.predictedAt,
    input.kind === 'delayed' || input.kind === 'improved'
      ? input.acceptedAt
      : null,
    input.acceptedAt,
    input.acceptedAt,
    input.callCycle,
    input.revision,
    input.notificationId,
    input.kind,
  )
}

export async function dispatchNotification(
  env: CloudflareBindings,
  id: string,
) {
  const entry = await env.DB.prepare(
    'SELECT e.queue_id FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE n.id=?',
  )
    .bind(id)
    .first<{ queue_id: string }>()
  if (entry?.queue_id) return queueCoordinator(env, entry.queue_id).dispatch(id)
  return dispatchNotificationSerialized(env, id)
}

export async function dispatchNotificationSerialized(
  env: CloudflareBindings,
  id: string,
) {
  if (env.WHATSAPP_ENABLED !== 'true') return
  const row = await env.DB.prepare(
    `SELECT n.status,n.attempts,n.kind,n.position,n.payload_version,n.payload_snapshot,n.revision,n.call_cycle,n.accepted_at,
    e.status AS entry_status,e.call_cycle AS entry_call_cycle,e.arrival_deadline_at,e.queue_id,e.sequence,f.payload,f.expires_at,e.id,e.locale,e.code,
    c.phone_cipher,c.phone_hash,v.name AS venue,q.config AS queue_config,p.revision AS projection_revision,p.predicted_at AS current_predicted_at,p.quality AS current_quality,p.eta_minutes AS current_eta
    FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id JOIN queue_entry_contact c ON c.entry_id=e.id
    LEFT JOIN queue_confirmation f ON f.entry_id=e.id
    JOIN queue q ON q.id=e.queue_id JOIN venue v ON v.id=q.venue_id
    LEFT JOIN queue_projection p ON p.entry_id=e.id WHERE n.id=?`,
  )
    .bind(id)
    .first<{
      status: string
      position: number | null
      arrival_deadline_at: number | null
      entry_status: string
      queue_id: string
      sequence: number
      kind: string
      payload_version: number
      payload_snapshot: string | null
      revision: number
      call_cycle: number
      accepted_at: number | null
      payload: string | null
      expires_at: number | null
      attempts: number
      id: string
      locale: 'es' | 'en'
      code: string
      phone_cipher: string
      phone_hash: string
      venue: string
      queue_config: string | null
      projection_revision: number | null
      current_predicted_at: number | null
      current_quality: 'estimated' | 'provisional' | 'unknown' | null
      current_eta: number | null
      entry_call_cycle: number
    }>()
  if (!row || row.status !== 'pending') return
  const notice =
    [
      'ready',
      'approaching',
      'delayed',
      'improved',
      'expired',
      'cancelled',
      'service_ended',
    ].includes(row.kind) ||
    (row.kind === 'queue_joined' && row.payload_version === 2)
  let snapshot: QueueNoticeSnapshot | null = null
  if (row.payload_version === 2 && row.payload_snapshot) {
    try {
      const parsed = JSON.parse(row.payload_snapshot) as QueueNoticeSnapshot
      if (parsed.schemaVersion === 2 && typeof parsed.serviceName === 'string')
        snapshot = parsed
    } catch {
      // Invalid immutable payloads fail closed below; never reconstruct PII.
    }
  }
  let approaching = true
  if (row.kind === 'approaching') {
    const current = await env.DB.prepare(
      `SELECT q.config,p.quality,p.predicted_at,
      (SELECT COUNT(*) FROM queue_entry w WHERE w.queue_id=e.queue_id AND w.status='waiting' AND w.sequence<e.sequence) AS ahead
      FROM queue_entry e JOIN queue q ON q.id=e.queue_id LEFT JOIN queue_projection p ON p.entry_id=e.id WHERE e.id=?`,
    )
      .bind(row.id)
      .first<{
        config: string | null
        quality: string | null
        predicted_at: number | null
        ahead: number
      }>()
    const config = current?.config
      ? (JSON.parse(current.config) as {
          approachTurns?: number
          approachMinutes?: number
        })
      : null
    approaching =
      !!current &&
      !!config &&
      (current.ahead <= (config.approachTurns ?? 2) ||
        (current.quality !== 'unknown' &&
          current.predicted_at !== null &&
          current.predicted_at - Date.now() <=
            (config.approachMinutes ?? 10) * 60000))
  }
  let correctionIsCurrent = true
  if (row.kind === 'delayed' || row.kind === 'improved') {
    const baseline = await env.DB.prepare(
      'SELECT last_accepted_predicted_at,last_correction_accepted_at FROM queue_notification_state WHERE entry_id=?',
    )
      .bind(row.id)
      .first<{
        last_accepted_predicted_at: number | null
        last_correction_accepted_at: number | null
      }>()
    correctionIsCurrent =
      evaluateEstimateNotice({
        previousAcceptedAt: baseline?.last_accepted_predicted_at ?? null,
        currentPredictedAt: row.current_predicted_at,
        quality: row.current_quality ?? 'unknown',
        lastCorrectionAcceptedAt:
          baseline?.last_correction_accepted_at ?? null,
        thresholdMinutes: (() => {
          try {
            return (
              JSON.parse(row.queue_config ?? '{}') as {
                etaChangeThresholdMinutes?: number
              }
            ).etaChangeThresholdMinutes ?? 5
          } catch {
            return 5
          }
        })(),
        cooldownMinutes: (() => {
          try {
            return (
              JSON.parse(row.queue_config ?? '{}') as {
                notificationCooldownMinutes?: number
              }
            ).notificationCooldownMinutes ?? 10
          } catch {
            return 10
          }
        })(),
        now: Date.now(),
      }) === row.kind
  }
  if (
    notice &&
    (row.payload_version === 2 && !snapshot ||
      (row.kind === 'ready' &&
      (row.entry_status !== 'called' ||
        (row.arrival_deadline_at ?? 0) <= Date.now() ||
        row.call_cycle !== row.entry_call_cycle)) ||
      (row.kind === 'queue_joined' &&
        (row.entry_status !== 'waiting' ||
          (row.payload_version === 2 &&
            row.revision !== row.projection_revision))) ||
      (row.kind === 'approaching' &&
        (row.entry_status !== 'waiting' || !approaching ||
          (row.payload_version === 2 && row.revision !== row.projection_revision))) ||
      ((row.kind === 'delayed' || row.kind === 'improved') &&
        (row.entry_status !== 'waiting' ||
          row.current_quality === 'unknown' ||
          row.current_predicted_at === null ||
          row.revision !== row.projection_revision ||
          !correctionIsCurrent)) ||
      (row.kind === 'expired' && row.entry_status !== 'expired') ||
      (row.kind === 'cancelled' && row.entry_status !== 'cancelled') ||
      (row.kind === 'service_ended' &&
        (row.entry_status !== 'cancelled' ||
          !(await env.DB.prepare("SELECT 1 FROM queue_event WHERE entry_id=? AND kind='service_ended' LIMIT 1")
            .bind(row.id)
            .first())))
    )
  ) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE id=? AND status='pending'",
      ).bind(Date.now(), id),
      deliveryTraceStatement(env, { notificationId: id, event: 'obsolete' }),
    ])
    return
  }
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
  await deliveryTraceStatement(env, {
    notificationId: id,
    event: 'attempt_started',
    attempt: row.attempts + 1,
  }).run()
  const result = await createWhatsAppSender(env).send({
    phone,
    locale: row.locale,
    venue: row.venue,
    ...(notice
      ? {
          notice: row.kind as
            | 'queue_joined'
            | 'ready'
            | 'approaching'
            | 'delayed'
            | 'improved'
            | 'expired'
            | 'cancelled'
            | 'service_ended',
        }
      : {}),
    ...(row.payload_version === 2
      ? {
          payloadVersion: 2 as const,
          notificationId: id,
          serviceName: snapshot?.serviceName ?? row.venue,
          ahead: snapshot?.ahead ?? null,
          etaMinutes: snapshot?.etaMinutes ?? null,
          estimateQuality: snapshot?.estimateQuality ?? 'unknown',
          resourceName: snapshot?.resourceName ?? null,
          arrivalDeadlineAt: snapshot?.arrivalDeadlineAt ?? null,
          ...(snapshot?.reason
            ? { cancellationReason: snapshot.reason }
            : {}),
        }
      : { payloadVersion: 1 as const }),
    code: row.code,
    token: await recoveryToken(env, row.id),
    ...(row.kind === 'position_update' && row.position !== null
      ? { position: row.position }
      : {}),
    ...(row.kind === 'confirmation' && row.payload
      ? { confirmationPayload: row.payload }
      : {}),
  })
  await deliveryTraceStatement(env, {
    notificationId: id,
    event: result.kind,
    attempt: row.attempts + 1,
    ...(result.kind === 'accepted' ? { providerId: result.providerId } : {}),
    ...(result.kind === 'failed'
      ? {
          httpStatus: result.diagnostic.httpStatus,
          providerCode: result.diagnostic.providerCode,
        }
      : {}),
  }).run()
  if (result.kind === 'failed') {
    console.warn({
      event: 'whatsapp_send_failed',
      reason: result.diagnostic.reason,
      httpStatus: result.diagnostic.httpStatus,
      providerCode: result.diagnostic.providerCode,
    })
  }
  if (result.kind === 'accepted') {
    const acceptedAt = Date.now()
    const accepted: D1PreparedStatement[] = [
      env.DB.prepare(
        "UPDATE notification_outbox SET status='accepted',provider_id=?,accepted_at=COALESCE(accepted_at,?),updated_at=? WHERE id=? AND status IN ('sending','unknown')",
      ).bind(result.providerId, acceptedAt, acceptedAt, id),
    ]
    if (snapshot?.predictedAt !== null && snapshot?.predictedAt !== undefined)
      accepted.push(
        acceptedNoticeStateStatement(env, {
          entryId: row.id,
          predictedAt: snapshot.predictedAt,
          acceptedAt,
          revision: row.revision,
          callCycle: row.call_cycle,
          notificationId: id,
          kind: row.kind,
        }),
      )
    await env.DB.batch(accepted)
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
      received_at: number
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
        `UPDATE consent SET revoked_at=? WHERE purpose IN ('queue_updates','confirmation_contact') AND revoked_at IS NULL AND (granted_at<=? OR entry_id IN (SELECT entry_id FROM queue_confirmation WHERE revoked_at IS NOT NULL))
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
    'SELECT id,entry_id,kind,payload_snapshot,accepted_at,revision,call_cycle FROM notification_outbox WHERE provider_id=?',
  )
    .bind(event.provider_id)
    .first<{
      id: string
      entry_id: string
      kind: string
      payload_snapshot: string | null
      accepted_at: number | null
      revision: number
      call_cycle: number
    }>()
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
  const webhookStatements: D1PreparedStatement[] = [
    deliveryTraceStatement(env, {
      id,
      notificationId: notification.id,
      event: event.status,
      providerId: event.provider_id,
      occurredAt: event.occurred_at,
      recordedAt: event.received_at,
    }),
    env.DB.prepare(
      `UPDATE notification_outbox SET status=?,updated_at=? WHERE id=? AND
      CASE status WHEN 'sending' THEN 0 WHEN 'unknown' THEN 0 WHEN 'accepted' THEN 1 WHEN 'failed' THEN 3 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5 ELSE 99 END < ?`,
    ).bind(event.status, now, notification.id, rank[event.status] ?? 0),
    env.DB.prepare('UPDATE webhook_event SET processed_at=? WHERE id=?').bind(
      now,
      id,
    ),
  ]
  if (
    ['sent', 'delivered', 'read'].includes(event.status) &&
    notification.accepted_at !== null &&
    notification.payload_snapshot
  ) {
    try {
      const snapshot = JSON.parse(
        notification.payload_snapshot,
      ) as QueueNoticeSnapshot
      if (snapshot.schemaVersion === 2 && snapshot.predictedAt !== null) {
        webhookStatements.push(
          acceptedNoticeStateStatement(env, {
            entryId: notification.entry_id,
            predictedAt: snapshot.predictedAt,
            acceptedAt: notification.accepted_at,
            revision: notification.revision,
            callCycle: notification.call_cycle,
            notificationId: notification.id,
            kind: notification.kind,
          }),
        )
      }
    } catch {
      // Malformed historical payloads are not allowed to change the ETA baseline.
    }
  }
  await env.DB.batch(webhookStatements)
}
export async function reconcile(env: CloudflareBindings) {
  const now = Date.now()
  await purgeDeliveryTrace(env, now)
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO notification_trace(id,notification_id,event,attempt,recorded_at) SELECT id || ':unknown:' || attempts,id,'unknown',attempts,? FROM notification_outbox WHERE status='sending' AND updated_at<?",
    ).bind(now, now - 120000),
    env.DB.prepare(
      "UPDATE notification_outbox SET status='unknown',updated_at=? WHERE status='sending' AND updated_at<?",
    ).bind(now, now - 120000),
  ])
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
