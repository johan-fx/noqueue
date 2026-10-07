export type QueueNoticeKind = 'ready' | 'approaching' | 'expired'
/** Durable intent: assignment/expiry and the notice commit in the same D1 batch. */
export function noticeStatement(
  env: CloudflareBindings,
  entryId: string,
  kind: QueueNoticeKind,
  now: number,
) {
  if (kind === 'approaching')
    return env.DB.prepare(
      "INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM consent WHERE entry_id=? AND purpose='queue_updates' AND revoked_at IS NULL)",
    ).bind(
      crypto.randomUUID(),
      entryId,
      `${entryId}:${kind}`,
      kind,
      now,
      entryId,
    )
  return env.DB.prepare(
    'INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at) VALUES (?,?,?,?,?)',
  ).bind(crypto.randomUUID(), entryId, `${entryId}:${kind}`, kind, now)
}

/** Publish after commit. A failed queue publish cannot undo assignment; the scheduled reconciler retries publication. */
export async function publishNotice(
  env: CloudflareBindings,
  entryId: string,
  kind: QueueNoticeKind,
) {
  try {
    const row = await env.DB.prepare(
      "SELECT id FROM notification_outbox WHERE entry_id=? AND kind=? AND status='pending'",
    )
      .bind(entryId, kind)
      .first<{ id: string }>()
    if (row)
      await env.NOTIFICATIONS.send({
        kind: 'dispatch-notification',
        notificationId: row.id,
      })
  } catch {
    console.warn('notification_publish_deferred')
  }
}
