import { copyVersion } from '../../integrations/whatsapp-copy-v3'
import type { LifecycleV4Variant } from '../../integrations/whatsapp-copy-v4'
import type { WhatsAppActionPhase } from './whatsapp-actions'
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
  copyVersion?: 2 | 3 | 4
  copyVariant?: LifecycleV4Variant
  actionContext?: {
    phase: WhatsAppActionPhase
    callCycle: number
    expiresAt: number
  }
  approachRecommended?: boolean
  /** V4 joined intents stay undispatchable until their canonical projection is frozen. */
  projectionPending?: boolean
  serviceName: string
  ahead: number | null
  etaMinutes: number | null
  predictedAt: number | null
  estimateQuality: 'estimated' | 'provisional' | 'unknown'
  resourceName: string | null
  arrivalDeadlineAt: number | null
  reason?: 'customer_cancel' | 'staff_cancel' | 'service_ended'
}

function v4Variant(kind: QueueNoticeKind, snapshot: QueueNoticeSnapshot) {
  if (snapshot.copyVariant) return snapshot.copyVariant
  if (kind === 'approaching') return 'approaching'
  if (kind === 'delayed') return 'delayed'
  if (kind === 'improved')
    return snapshot.approachRecommended
      ? 'improved_wait_recommended'
      : 'improved_wait_neutral'
  if (kind === 'ready') return 'ready'
  if (kind === 'expired') return 'expired'
  if (kind === 'service_ended') return 'service_ended'
  if (kind === 'cancelled') {
    if (snapshot.reason === 'customer_cancel') return 'cancelled_customer'
    if (snapshot.reason === 'staff_cancel') return 'cancelled_staff'
    return 'cancelled_unknown'
  }
  throw new Error('Unsupported v4 notice kind')
}

function freezeV4Snapshot(
  kind: QueueNoticeKind,
  snapshot: QueueNoticeSnapshot,
  now: number,
  callCycle: number,
): QueueNoticeSnapshot {
  const variant = v4Variant(kind, snapshot)
  const actionPhase =
    variant === 'approaching' ||
    variant === 'improved_wait_recommended' ||
    variant === 'improved_wait_neutral'
      ? 'waiting'
      : variant === 'ready' || variant === 'improved_ready'
        ? 'called'
        : null
  const snapshotWithoutAction = { ...snapshot }
  delete snapshotWithoutAction.actionContext
  return {
    ...snapshotWithoutAction,
    copyVersion: 4,
    copyVariant: variant,
    ...(actionPhase
      ? {
          actionContext: {
            phase: actionPhase,
            callCycle,
            expiresAt:
              actionPhase === 'called'
                ? snapshot.arrivalDeadlineAt ?? now + 86_400_000
                : now + 86_400_000,
          },
        }
      : {}),
  }
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
  if ((copyVersion(env) === 3 || copyVersion(env) === 4) && !configuredService)
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
        ...(copyVersion(env) === 4
          ? freezeV4Snapshot(kind, snapshot, now, callCycle)
          : snapshot),
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
  kind: QueueNoticeKind | 'action_result',
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
