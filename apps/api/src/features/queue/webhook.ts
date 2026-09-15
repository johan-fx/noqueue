import { confirmationExperimentEnabled } from './confirmation'
import { z } from 'zod'
import { whatsappWebhookParser } from '../../integrations/360dialog'
import { hash, phoneHash, secureEqual } from './crypto'
export async function receiveWebhook(
  request: Request,
  env: CloudflareBindings,
  capability?: string,
) {
  const token =
    env.WHATSAPP_MODE === 'sandbox'
      ? capability ?? ''
      : request.headers.get('X-NoQueue-Webhook-Token') ?? ''
  if (!(await secureEqual(token, env.D360DIALOG_WEBHOOK_TOKEN)))
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (Number(request.headers.get('Content-Length')) > 262144)
    return new Response(null, { status: 413 })
  const reader = request.body?.getReader()
  if (!reader) return new Response(null, { status: 200 })
  let text = '',
    length = 0
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > 262144) {
      await reader.cancel()
      return new Response(null, { status: 413 })
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    console.warn('webhook_invalid_json')
    return new Response(null, { status: 200 })
  }
  if (env.WHATSAPP_MODE === 'cloud') {
    if (!env.D360DIALOG_PHONE_NUMBER_ID)
      return new Response(null, { status: 503 })
    const source = z
      .object({
        entry: z.array(
          z.object({
            changes: z.array(
              z.object({
                value: z.object({
                  metadata: z.object({ phone_number_id: z.string() }),
                }),
              }),
            ),
          }),
        ),
      })
      .safeParse(payload)
    if (
      source.success &&
      source.data.entry.some((entry) =>
        entry.changes.some(
          (change) =>
            change.value.metadata.phone_number_id !==
            env.D360DIALOG_PHONE_NUMBER_ID,
        ),
      )
    )
      return new Response(null, { status: 403 })
    if (!source.success && whatsappWebhookParser.parse(payload).length)
      return new Response(null, { status: 403 })
  }
  const events = whatsappWebhookParser.parse(payload)
  if (!events.length) console.info('webhook_no_supported_events')
  for (const event of events) {
    if (event.kind === 'confirmation' && !confirmationExperimentEnabled(env))
      continue
    const id = crypto.randomUUID(),
      now = Date.now()
    const senderHash =
      event.kind !== 'status' ? await phoneHash(env, event.phone) : null
    // Persist inbound window and withdrawal at ingress, before queue publication.
    // Future-dated payloads never extend a conversation window. STOP is a permanent
    // experiment suppression latch, independent of delayed consent processing.
    if (event.kind !== 'status' && event.timestamp <= now + 1000) {
      await env.DB.prepare(
        `INSERT INTO whatsapp_contact_state(phone_hash,last_inbound_at,stopped_at) VALUES (?,?,?)
        ON CONFLICT(phone_hash) DO UPDATE SET last_inbound_at=MAX(last_inbound_at,excluded.last_inbound_at),
        stopped_at=COALESCE(stopped_at,excluded.stopped_at)`,
      )
        .bind(
          senderHash,
          Math.min(now, event.timestamp),
          event.kind === 'opt_out' ? now : null,
        )
        .run()
    }
    // Freeze the intended entry at receipt; deferred jobs must not retarget a typed
    // confirmation after another entry is confirmed, revoked or created.
    const target =
      event.kind === 'confirmation'
        ? await env.DB.prepare(
            `SELECT CASE WHEN COUNT(*)=1 THEN MIN(f.entry_id) ELSE NULL END AS entry_id
          FROM queue_confirmation f JOIN queue_entry_contact p ON p.entry_id=f.entry_id
          WHERE p.phone_hash=? AND f.confirmed_at IS NULL AND f.revoked_at IS NULL AND f.expires_at>?
            AND (? IS NULL OR f.payload=?)`,
          )
            .bind(senderHash, now, event.payload, event.payload)
            .first<{ entry_id: string | null }>()
        : null
    const dedupe = await hash(
      `${event.kind}:${event.id}:${
        event.kind === 'status' ? event.status : ''
      }`,
    )
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_event(id,dedupe_key,kind,provider_id,status,phone_hash,occurred_at,received_at,confirmation_payload,context_id,confirmation_entry_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
        dedupe,
        event.kind,
        event.id,
        event.kind === 'status' ? event.status : null,
        senderHash,
        event.timestamp,
        now,
        event.kind === 'confirmation' ? event.payload : null,
        event.kind === 'confirmation' ? event.contextId : null,
        target?.entry_id ?? null,
      )
      .run()
    if (inserted.meta.changes) {
      try {
        await env.NOTIFICATIONS.send({
          kind: 'process-webhook',
          webhookEventId: id,
        })
      } catch {
        console.warn('webhook_publish_deferred')
      }
    }
  }
  return new Response(null, { status: 200 })
}
