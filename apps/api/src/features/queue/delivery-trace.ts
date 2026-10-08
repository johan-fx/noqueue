export const deliveryRetentionMs = 7 * 24 * 60 * 60 * 1000
export async function notificationDeliverySummary(
  env: CloudflareBindings,
  queueId: string,
  since: number,
) {
  const rows = await env.DB.prepare(
    `SELECT n.kind,
      COUNT(DISTINCT CASE WHEN t.event='accepted' THEN n.id END) AS accepted,
      COUNT(DISTINCT CASE WHEN t.event IN ('delivered','read') THEN n.id END) AS delivered,
      COUNT(DISTINCT CASE WHEN t.event='read' THEN n.id END) AS read,
      COUNT(DISTINCT CASE WHEN t.event='failed' THEN n.id END) AS failed,
      COUNT(DISTINCT CASE WHEN t.event='unknown' THEN n.id END) AS unknown,
      COUNT(DISTINCT CASE WHEN t.event='opened' THEN n.id END) AS openings
    FROM notification_outbox n
    JOIN queue_entry e ON e.id=n.entry_id
    LEFT JOIN notification_trace t ON t.notification_id=n.id AND t.recorded_at>=?
    WHERE e.queue_id=? AND EXISTS (
      SELECT 1 FROM notification_trace recent
      WHERE recent.notification_id=n.id AND recent.recorded_at>=?
    )
    GROUP BY n.kind ORDER BY n.kind`,
  )
    .bind(since, queueId, since)
    .all<{
      kind: string
      accepted: number
      delivered: number
      read: number
      failed: number
      unknown: number
      openings: number
    }>()
  return rows.results
}
export function deliveryTraceStatement(
  env: CloudflareBindings,
  input: {
    id?: string
    notificationId: string
    event: string
    attempt?: number
    providerId?: string
    httpStatus?: number | null
    providerCode?: number | null
    occurredAt?: number
    recordedAt?: number
  },
) {
  return env.DB.prepare(
    'INSERT OR IGNORE INTO notification_trace(id,notification_id,event,attempt,provider_id,http_status,provider_code,occurred_at,recorded_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).bind(
    input.id ?? crypto.randomUUID(),
    input.notificationId,
    input.event,
    input.attempt ?? null,
    input.providerId ?? null,
    input.httpStatus ?? null,
    input.providerCode ?? null,
    input.occurredAt ?? null,
    input.recordedAt ?? Date.now(),
  )
}
export async function purgeDeliveryTrace(
  env: CloudflareBindings,
  now = Date.now(),
) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM notification_trace WHERE recorded_at<?').bind(
      now - deliveryRetentionMs,
    ),
    // Only processed delivery statuses are trace; inbound/consent and pending jobs remain operational data.
    env.DB.prepare(
      "DELETE FROM webhook_event WHERE kind='status' AND processed_at IS NOT NULL AND received_at<?",
    ).bind(now - deliveryRetentionMs),
  ])
}
