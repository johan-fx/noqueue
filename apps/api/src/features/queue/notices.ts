import { copyVersion } from '../../integrations/whatsapp-copy-v3'
export type QueueNoticeKind =
  | 'ready'
  | 'approaching'
  | 'delayed'
  | 'improved'
  | 'expired'
  | 'cancelled'
  | 'service_ended'
export type QueueNoticeSnapshot = {
  schemaVersion: 2
  copyVersion?: 2 | 3
  approachRecommended?: boolean
  serviceName: string
  ahead: number | null
  etaMinutes: number | null
  predictedAt: number | null
  estimateQuality: 'estimated' | 'provisional' | 'unknown'
  resourceName: string | null
  arrivalDeadlineAt: number | null
  reason?: 'customer_cancel' | 'staff_cancel' | 'service_ended'
}
/** Preserve an observable terminal intent when a selected profile cannot render legacy data. */
export function unavailableCopyStatement(
  env: CloudflareBindings,
  entryId: string,
  kind: string,
  now: number,
  idempotencyKey: string,
  id = crypto.randomUUID(),
  revision = 0,
  callCycle = 0,
) {
  const selected = copyVersion(env)
  const reason =
    selected === null ? 'invalid_copy_profile' : 'configured_service_required'
  console.warn({ event: 'whatsapp_copy_profile_unavailable', reason })
  return env.DB.prepare(
    "INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,kind,status,updated_at,payload_version,payload_snapshot,revision,call_cycle) SELECT ?,?,?,?,'failed',?,2,?,?,? WHERE EXISTS(SELECT 1 FROM consent WHERE entry_id=? AND purpose='queue_updates' AND revoked_at IS NULL)",
  ).bind(
    id,
    entryId,
    idempotencyKey,
    kind,
    now,
    JSON.stringify({
      schemaVersion: 2,
      copyVersion: selected ?? 'invalid',
      blockedReason: reason,
    }),
    revision,
    callCycle,
    entryId,
  )
}

/** Durable intent: assignment/expiry and the notice commit in the same D1 batch. */
export function noticeStatement(
  env: CloudflareBindings,
  entryId: string,
  kind: QueueNoticeKind,
  now: number,
  snapshot?: QueueNoticeSnapshot,
  revision = 0,
  callCycle = 0,
  // Caller must derive this from actual queue configuration, never display fallbacks.
  configuredService = false,
) {
  const idempotencyKey = snapshot
    ? `${entryId}:${kind}:v2:r${revision}:c${callCycle}`
    : `${entryId}:${kind}`
  if (copyVersion(env) === 3 && !configuredService)
    return unavailableCopyStatement(
      env,
      entryId,
      kind,
      now,
      idempotencyKey,
      crypto.randomUUID(),
      revision,
      callCycle,
    )
  if (snapshot)
    return env.DB.prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at,payload_version,payload_snapshot,revision,call_cycle) SELECT ?,?,?,?,?,2,?,?,? WHERE EXISTS(SELECT 1 FROM consent WHERE entry_id=? AND purpose='queue_updates' AND revoked_at IS NULL)",
    ).bind(
      crypto.randomUUID(),
      entryId,
      idempotencyKey,
      kind,
      now,
      JSON.stringify({
        ...snapshot,
        copyVersion: copyVersion(env) ?? 'invalid',
      }),
      revision,
      callCycle,
      entryId,
    )
  if (copyVersion(env) !== 2)
    return unavailableCopyStatement(env, entryId, kind, now, idempotencyKey)
  if (kind === 'approaching')
    return env.DB.prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM consent WHERE entry_id=? AND purpose='queue_updates' AND revoked_at IS NULL)",
    ).bind(crypto.randomUUID(), entryId, idempotencyKey, kind, now, entryId)
  return env.DB.prepare(
    'INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at) VALUES (?,?,?,?,?)',
  ).bind(crypto.randomUUID(), entryId, idempotencyKey, kind, now)
}

/** Publish after commit. A failed queue publish cannot undo assignment; the scheduled reconciler retries publication. */
export async function publishNotice(
  env: CloudflareBindings,
  entryId: string,
  kind: QueueNoticeKind,
) {
  try {
    const rows = await env.DB.prepare(
      "SELECT id FROM notification_outbox WHERE entry_id=? AND kind=? AND status='pending' ORDER BY revision DESC,updated_at DESC",
    )
      .bind(entryId, kind)
      .all<{ id: string }>()
    for (const row of rows.results)
      await env.NOTIFICATIONS.send({
        kind: 'dispatch-notification',
        notificationId: row.id,
      })
  } catch {
    console.warn('notification_publish_deferred')
  }
}
