export const deliveryRetentionMs = 7 * 24 * 60 * 60 * 1000
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
