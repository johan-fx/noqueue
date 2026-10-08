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
  serviceName: string
  ahead: number | null
  etaMinutes: number | null
  predictedAt: number | null
  estimateQuality: 'estimated' | 'provisional' | 'unknown'
  resourceName: string | null
  arrivalDeadlineAt: number | null
  reason?: 'customer_cancel' | 'staff_cancel' | 'service_ended'
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
) {
  const idempotencyKey = snapshot
    ? `${entryId}:${kind}:v2:r${revision}:c${callCycle}`
    : `${entryId}:${kind}`
  if (snapshot)
    return env.DB.prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at,payload_version,payload_snapshot,revision,call_cycle) SELECT ?,?,?,?,?,2,?,?,? WHERE EXISTS(SELECT 1 FROM consent WHERE entry_id=? AND purpose='queue_updates' AND revoked_at IS NULL)",
    ).bind(
      crypto.randomUUID(),
      entryId,
      idempotencyKey,
      kind,
      now,
      JSON.stringify(snapshot),
      revision,
      callCycle,
      entryId,
    )
  if (kind === 'approaching')
    return env.DB.prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM consent WHERE entry_id=? AND purpose='queue_updates' AND revoked_at IS NULL)",
    ).bind(
      crypto.randomUUID(),
      entryId,
      idempotencyKey,
      kind,
      now,
      entryId,
    )
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
