import {
  confirmationExperimentEnabled,
  liveConfirmationEnabled,
} from '../features/queue/confirmation'
import { z } from 'zod'
export interface OutboundWhatsAppMessage {
  phone: string
  locale: 'es' | 'en'
  venue: string
  code: string
  token: string
  confirmationPayload?: string
  position?: number
}
export type ProviderSendResult =
  | { kind: 'accepted'; providerId: string }
  | { kind: 'unknown' | 'rate_limited' }
  | {
      kind: 'failed'
      diagnostic: {
        reason: 'configuration' | 'http_rejection'
        httpStatus: number | null
        providerCode: number | null
      }
    }
export interface WhatsAppSender {
  send(message: OutboundWhatsAppMessage): Promise<ProviderSendResult>
}
const receipt = z.object({
  messages: z.array(z.object({ id: z.string().min(1).max(512) })).min(1),
})
export function createWhatsAppSender(
  env: CloudflareBindings,
  fetcher: typeof fetch = fetch,
): WhatsAppSender {
  return {
    async send(message) {
      if (
        !env.D360DIALOG_API_KEY ||
        !['sandbox', 'cloud'].includes(env.WHATSAPP_MODE)
      )
        return configurationFailure()
      const confirmation = message.confirmationPayload !== undefined
      const positionUpdate = message.position !== undefined
      if (
        (confirmation || positionUpdate) &&
        env.APP_ENV !== 'local' &&
        (!liveConfirmationEnabled(env) || message.locale !== 'es')
      )
        return configurationFailure()
      if (
        positionUpdate &&
        (!Number.isInteger(message.position) || message.position! < 1)
      )
        return configurationFailure()
      if (confirmation && !confirmationExperimentEnabled(env))
        return configurationFailure()
      const sandbox = env.WHATSAPP_MODE === 'sandbox'
      const name =
        message.locale === 'es'
          ? env.WHATSAPP_QUEUE_JOINED_TEMPLATE_ES
          : env.WHATSAPP_QUEUE_JOINED_TEMPLATE_EN
      if (
        !confirmation &&
        !positionUpdate &&
        !sandbox &&
        (!name || env.STAGING_CONSENT_APPROVED !== 'true')
      )
        return configurationFailure()
      const link = `${env.PUBLIC_APP_ORIGIN}/t/${message.token}`
      const payload = positionUpdate
        ? {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'text',
            text: {
              body:
                message.position === 1
                  ? `Experimento NoQueue · ${message.code}: eres el siguiente en la cola. Esto no significa que tu mesa esté lista. Envía BAJA para dejar de recibir avisos.`
                  : `Experimento NoQueue · ${message.code}: ${
                      message.position === 2
                        ? 'queda 1 turno'
                        : `quedan ${message.position! - 1} turnos`
                    } delante de ti. Envía BAJA para dejar de recibir avisos.`,
            },
          }
        : confirmation
        ? {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'template',
            template: {
              name:
                env.APP_ENV === 'local'
                  ? 'noqueue_confirmation_experiment_mock'
                  : 'noqueue_queue_optin_confirm_pilot_v3',
              language: { code: message.locale },
              components: [
                {
                  type: 'body',
                  parameters: [{ type: 'text', text: message.code }],
                },
                {
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: '0',
                  parameters: [
                    { type: 'payload', payload: message.confirmationPayload },
                  ],
                },
              ],
            },
          }
        : sandbox
        ? {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'text',
            text: {
              body:
                message.locale === 'es'
                  ? `${message.venue}: tu turno es ${message.code}. ${link}`
                  : `${message.venue}: your queue code is ${message.code}. ${link}`,
            },
          }
        : {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'template',
            template: {
              name,
              language: { code: message.locale === 'es' ? 'es_ES' : 'en_US' },
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: message.venue },
                    { type: 'text', text: message.code },
                  ],
                },
                {
                  type: 'button',
                  sub_type: 'url',
                  index: '0',
                  parameters: [{ type: 'text', text: message.token }],
                },
              ],
            },
          }
      const controller = new AbortController()
      const timeout = Number(env.D360DIALOG_REQUEST_TIMEOUT_MS)
      if (!Number.isFinite(timeout) || timeout < 100 || timeout > 30000)
        return configurationFailure()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const response = await fetcher(
          (confirmation || positionUpdate) && env.APP_ENV === 'local'
            ? 'https://noqueue-experiment.invalid/messages'
            : sandbox
            ? 'https://waba-sandbox.360dialog.io/v1/messages'
            : 'https://waba-v2.360dialog.io/messages',
          {
            method: 'POST',
            redirect: 'manual',
            headers: {
              'Content-Type': 'application/json',
              'D360-API-KEY': env.D360DIALOG_API_KEY,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        )
        if (response.status === 429) return { kind: 'rate_limited' }
        if (response.status >= 500) return { kind: 'unknown' }
        if (response.status !== 200 && response.status !== 201) {
          let payload: unknown
          try {
            payload = await readProviderBody(response)
          } catch {
            // Known rejection remains terminal even when its body is unreadable.
          }
          if (response.status === 400 && isExplicitRateLimit(payload))
            return { kind: 'rate_limited' }
          const code = providerErrorCode.safeParse(payload)
          return {
            kind: 'failed',
            diagnostic: {
              reason: 'http_rejection',
              httpStatus: response.status,
              providerCode: code.success ? code.data.error.code : null,
            },
          }
        }
        const parsed = receipt.safeParse(await readProviderBody(response))
        const providerId = parsed.success
          ? parsed.data.messages[0]?.id
          : undefined
        return providerId
          ? { kind: 'accepted', providerId }
          : { kind: 'unknown' }
      } catch {
        return { kind: 'unknown' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
export type NormalizedWhatsAppEvent =
  | {
      kind: 'status'
      id: string
      status: 'sent' | 'delivered' | 'read' | 'failed'
      timestamp: number
    }
  | {
      kind: 'confirmation'
      id: string
      phone: string
      timestamp: number
      payload: string | null
      contextId: string | null
    }
  | { kind: 'inbound'; id: string; phone: string; timestamp: number }
  | { kind: 'opt_out'; id: string; phone: string; timestamp: number }
export interface WhatsAppWebhookParser {
  parse(payload: unknown): NormalizedWhatsAppEvent[]
}
const statusSchema = z.object({
  id: z.string().min(1).max(512),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: z.string().regex(/^\d{1,12}$/),
})
const messageSchema = z.object({
  id: z.string().min(1).max(512),
  from: z.string().regex(/^\d{8,15}$/),
  timestamp: z.string().regex(/^\d{1,12}$/),
  text: z.object({ body: z.string() }).optional(),
  type: z.string().optional(),
  button: z
    .object({ text: z.string(), payload: z.string().min(1).max(512) })
    .optional(),
  context: z.object({ id: z.string().min(1).max(512) }).optional(),
})
const valueSchema = z.object({
  statuses: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
})
const envelope = z.object({
  entry: z.array(
    z.object({ changes: z.array(z.object({ value: z.unknown() })) }),
  ),
})
export const whatsappWebhookParser: WhatsAppWebhookParser = {
  parse(payload) {
    const parsed = envelope.safeParse(payload)
    if (!parsed.success) return []
    const result: NormalizedWhatsAppEvent[] = []
    for (const entry of parsed.data.entry)
      for (const change of entry.changes) {
        const value = valueSchema.safeParse(change.value)
        if (!value.success) continue
        for (const item of value.data.statuses ?? []) {
          const parsedStatus = statusSchema.safeParse(item)
          if (!parsedStatus.success) continue
          const status = parsedStatus.data
          result.push({
            kind: 'status',
            id: status.id,
            status: status.status,
            timestamp: Number(status.timestamp) * 1000,
          })
        }
        for (const item of value.data.messages ?? []) {
          const parsedMessage = messageSchema.safeParse(item)
          if (!parsedMessage.success) continue
          const message = parsedMessage.data
          if (
            ['STOP', 'BAJA'].includes(
              message.text?.body.trim().toUpperCase() ?? '',
            )
          )
            result.push({
              kind: 'opt_out',
              id: message.id,
              phone: `+${message.from}`,
              timestamp: Number(message.timestamp) * 1000,
            })
          else if (
            (message.type === 'button' &&
              message.button?.text.trim().toUpperCase() === 'CONFIRMO' &&
              message.context) ||
            ((!message.type || message.type === 'text') &&
              message.text?.body.trim().toUpperCase() === 'CONFIRMO')
          )
            result.push({
              kind: 'confirmation',
              id: message.id,
              phone: `+${message.from}`,
              timestamp: Number(message.timestamp) * 1000,
              payload:
                message.type === 'button' ? message.button!.payload : null,
              contextId: message.context?.id ?? null,
            })
          else
            result.push({
              kind: 'inbound',
              id: message.id,
              phone: `+${message.from}`,
              timestamp: Number(message.timestamp) * 1000,
            })
        }
      }
    return result
  },
}

async function readProviderBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing provider body')
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > 65536) {
      await reader.cancel()
      throw new Error('Provider body too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}
const rateLimitBody = z.object({
  message: z.string().optional(),
  error: z
    .union([
      z.string(),
      z.object({ message: z.string().optional(), code: z.number().optional() }),
    ])
    .optional(),
})
function isExplicitRateLimit(payload: unknown) {
  const body = rateLimitBody.safeParse(payload)
  if (!body.success) return false
  const error = body.data.error
  const message =
    typeof error === 'string' ? error : error?.message ?? body.data.message
  // Only the provider's documented rejection, never fuzzy matching billing/policy errors.
  return message === 'You have exceeded the endpoint rate limit.'
}

// Only numeric code metadata crosses this boundary; provider text is never retained.
const providerErrorCode = z.object({
  error: z.object({ code: z.number().int().min(0).max(2147483647) }),
})
function configurationFailure(): ProviderSendResult {
  return {
    kind: 'failed',
    diagnostic: {
      reason: 'configuration',
      httpStatus: null,
      providerCode: null,
    },
  }
}
