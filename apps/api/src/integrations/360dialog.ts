import { lifecycleV3, renderLifecycleV3, v3TemplateReady } from './whatsapp-copy-v3'
import {
  lifecycleV4,
  renderLifecycleV4,
  v4TemplateReady,
  type LifecycleV4Variant,
} from './whatsapp-copy-v4'
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
  payloadVersion?: 1 | 2
  copyVersion?: 2 | 3 | 4
  copyVariant?: LifecycleV4Variant
  venueId?: string
  recoveryUrl?: string
  actionPayloads?: { yield: string; cancel: string }
  approachRecommended?: boolean
  notificationId?: string
  serviceName?: string
  ahead?: number | null
  etaMinutes?: number | null
  estimateQuality?: 'estimated' | 'provisional' | 'unknown'
  resourceName?: string | null
  arrivalDeadlineAt?: number | null
  cancellationReason?: 'customer_cancel' | 'staff_cancel' | 'service_ended'
  confirmationPayload?: string
  textBody?: string
  serviceWindowReply?: true
  serviceWindowCta?: { label: string }
  notice?:
    | 'queue_joined'
    | 'ready'
    | 'approaching'
    | 'delayed'
    | 'improved'
    | 'expired'
    | 'cancelled'
    | 'service_ended'
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
type LifecycleCopyContext = {
  serviceName: string
  ahead: string
  eta: string
  destination: string
  deadline: string
  link: string
}
export function sandboxLifecycleCopy(
  message: OutboundWhatsAppMessage,
  context: LifecycleCopyContext,
) {
  const header = `${message.venue} · ${context.serviceName} · ${message.code}`
  const footer =
    message.locale === 'es'
      ? 'Envía BAJA para dejar de recibir avisos.'
      : 'Reply STOP to stop receiving updates.'
  if (message.locale === 'es') {
    switch (message.notice) {
      case 'queue_joined':
        return `${header}: estás en la lista. Quedan ${context.ahead} turnos por delante. Tiempo estimado: ${context.eta}. ${context.link} ${footer}`
      case 'approaching':
        return `${header}: tu turno se acerca; todavía no está asignado. Quedan ${context.ahead} turnos por delante. Tiempo estimado: ${context.eta}. ${context.link} ${footer}`
      case 'delayed':
        return `${header}: el tiempo estimado ha cambiado. Nueva estimación: ${context.eta}. ${context.link} ${footer}`
      case 'improved':
        return `${header}: la estimación de tu turno ha mejorado. Nueva estimación: ${context.eta}. ${context.link} ${footer}`
      case 'ready':
        return `${header}: tu turno está asignado${context.destination ? ` en ${context.destination}` : ''}. Acude ahora y llega antes de las ${context.deadline}. ${context.link} ${footer}`
      case 'expired':
        return `${header}: el plazo de llegada ha terminado. Puedes volver a inscribirte: ${context.link} ${footer}`
      case 'cancelled':
        return `${header}: ${message.cancellationReason === 'customer_cancel' ? 'has cancelado tu turno' : 'el establecimiento ha cancelado tu turno'}. ${context.link} ${footer}`
      case 'service_ended':
        return `${header}: el servicio ha terminado por hoy. Puedes volver a inscribirte cuando esté disponible: ${context.link} ${footer}`
      default:
        return `${header}: tu turno es ${message.code}. ${context.link} ${footer}`
    }
  }
  switch (message.notice) {
    case 'queue_joined':
      return `${header}: you are on the list. ${context.ahead} turns are ahead of you. Estimated wait: ${context.eta}. ${context.link} ${footer}`
    case 'approaching':
      return `${header}: your turn is approaching but has not been assigned. ${context.ahead} turns are ahead of you. Estimated wait: ${context.eta}. ${context.link} ${footer}`
    case 'delayed':
      return `${header}: your estimated wait has changed. New estimate: ${context.eta}. ${context.link} ${footer}`
    case 'improved':
      return `${header}: your estimated wait has improved. New estimate: ${context.eta}. ${context.link} ${footer}`
    case 'ready':
      return `${header}: your turn is assigned${context.destination ? ` at ${context.destination}` : ''}. Come now and arrive before ${context.deadline}. ${context.link} ${footer}`
    case 'expired':
      return `${header}: your arrival window has ended. You can join again: ${context.link} ${footer}`
    case 'cancelled':
      return `${header}: ${message.cancellationReason === 'customer_cancel' ? 'you cancelled your turn' : 'the venue cancelled your turn'}. ${context.link} ${footer}`
    case 'service_ended':
      return `${header}: service has ended for today. You can join again when it is available: ${context.link} ${footer}`
    default:
      return `${header}: your queue code is ${message.code}. ${context.link} ${footer}`
  }
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
      const serviceWindowReply = message.serviceWindowReply === true
      const serviceWindowCta = message.serviceWindowCta
      if (
        (serviceWindowReply &&
          (typeof message.textBody !== 'string' ||
            !message.textBody.trim() ||
            message.textBody.length > (serviceWindowCta ? 1024 : 4096))) ||
        (!serviceWindowReply &&
          (message.textBody !== undefined || serviceWindowCta !== undefined)) ||
        (serviceWindowCta &&
          (!message.venueId ||
            !serviceWindowCta.label.trim() ||
            serviceWindowCta.label.length > 20))
      )
        return configurationFailure()
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
      const noticeTemplates = env as CloudflareBindings &
        Partial<
          Record<
            `WHATSAPP_QUEUE_${'READY' | 'APPROACHING' | 'EXPIRED'}_TEMPLATE_${
              | 'ES'
              | 'EN'}`,
            string
          >
        >
      const lifecycleTemplates = env as CloudflareBindings &
        Partial<
          Record<
            `WHATSAPP_QUEUE_V2_${
              | 'QUEUE_JOINED'
              | 'READY'
              | 'APPROACHING'
              | 'DELAYED'
              | 'IMPROVED'
              | 'EXPIRED'
              | 'CANCELLED'
              | 'SERVICE_ENDED'}_TEMPLATE_${'ES' | 'EN'}`,
            string
          >
        >
      const version2 = message.payloadVersion === 2
      const version3 = version2 && message.copyVersion === 3
      const version4 = version2 && message.copyVersion === 4
      const linkUrl = new URL(`/t/${message.token}`, env.PUBLIC_APP_ORIGIN)
      linkUrl.searchParams.set('lang', message.locale)
      linkUrl.searchParams.set('source', 'whatsapp')
      if (version2 && message.notificationId)
        linkUrl.searchParams.set('notice', message.notificationId)
      const link = linkUrl.toString()
      let serviceWindowCtaUrl: string | null = null
      if (serviceWindowCta && message.venueId) {
        try {
          const selectorUrl = new URL(
            `/v/${encodeURIComponent(message.venueId)}`,
            env.PUBLIC_APP_ORIGIN,
          )
          selectorUrl.searchParams.set('lang', message.locale)
          selectorUrl.searchParams.set('source', 'whatsapp')
          if (
            selectorUrl.protocol === 'https:' &&
            selectorUrl.toString().length <= 2000
          )
            serviceWindowCtaUrl = selectorUrl.toString()
        } catch {
          return configurationFailure()
        }
        if (!serviceWindowCtaUrl) return configurationFailure()
      }
      const templateLinkParameter = `${linkUrl.pathname.slice('/t/'.length)}${linkUrl.search}`
      const v4Message = version4
        ? { ...message, recoveryUrl: link }
        : message
      if (
        message.copyVersion !== undefined &&
        ![2, 3, 4].includes(message.copyVersion)
      )
        return configurationFailure()
      let natural: ReturnType<typeof lifecycleV3> | undefined
      let naturalV4: ReturnType<typeof lifecycleV4> | undefined
      if (version3) {
        try {
          natural = lifecycleV3(message)
        } catch {
          return configurationFailure()
        }
        if (!sandbox && !v3TemplateReady(env, natural.template))
          return configurationFailure()
      }
      if (version4) {
        try {
          naturalV4 = lifecycleV4(v4Message)
        } catch {
          return configurationFailure()
        }
        if (!sandbox && !v4TemplateReady(env, naturalV4.template))
          return configurationFailure()
        if (
          !sandbox &&
          naturalV4.template.buttons.some((button) => button.type === 'quick_reply') &&
          (!message.actionPayloads?.yield || !message.actionPayloads.cancel)
        )
          return configurationFailure()
        if (
          naturalV4.template.buttons.some((button) => button.type === 'url') &&
          !message.venueId
        )
          return configurationFailure()
      }
      if (
        version2 &&
        (!message.notice || !z.uuid().safeParse(message.notificationId).success)
      )
        return configurationFailure()
      const name = naturalV4?.template.name ?? (natural ? natural.template.name : message.notice
        ? version2
          ? lifecycleTemplates[
              `WHATSAPP_QUEUE_V2_${message.notice.toUpperCase() as
                | 'QUEUE_JOINED'
                | 'READY'
                | 'APPROACHING'
                | 'DELAYED'
                | 'IMPROVED'
                | 'EXPIRED'
                | 'CANCELLED'
                | 'SERVICE_ENDED'}_TEMPLATE_${message.locale.toUpperCase() as 'ES' | 'EN'}`
            ]
          : message.notice === 'ready' ||
            message.notice === 'approaching' ||
            message.notice === 'expired'
          ? noticeTemplates[
            `WHATSAPP_QUEUE_${
              message.notice.toUpperCase() as
                | 'READY'
                | 'APPROACHING'
                | 'EXPIRED'
            }_TEMPLATE_${message.locale.toUpperCase() as 'ES' | 'EN'}`
          ]
          : undefined
        : message.locale === 'es'
        ? env.WHATSAPP_QUEUE_JOINED_TEMPLATE_ES
        : env.WHATSAPP_QUEUE_JOINED_TEMPLATE_EN
        )
      if (
        !confirmation &&
        !positionUpdate &&
        !serviceWindowReply &&
        !sandbox &&
        (!name ||
          env.STAGING_CONSENT_APPROVED !== 'true' ||
          (version2 && !version3 && !version4 && env.WHATSAPP_V2_TEMPLATES_APPROVED !== 'true'))
      )
        return configurationFailure()
      const serviceName = message.serviceName ?? message.venue
      const ahead =
        message.ahead == null
          ? message.locale === 'es'
            ? 'no disponible'
            : 'not available'
          : String(message.ahead)
      const eta =
        message.etaMinutes == null || message.estimateQuality === 'unknown'
          ? message.locale === 'es'
            ? 'sin estimación'
            : 'not available'
          : message.locale === 'es'
          ? `${message.etaMinutes} min`
          : `${message.etaMinutes} min`
      const deadline = message.arrivalDeadlineAt
        ? new Intl.DateTimeFormat(message.locale === 'es' ? 'es-ES' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(message.arrivalDeadlineAt)
        : message.locale === 'es'
        ? 'consulta el enlace'
        : 'check the link'
      const destination = message.resourceName ?? ''
      const reason = message.cancellationReason ?? ''
      const templateParameters = (naturalV4
        ? naturalV4.parameters
        : natural
        ? natural.parameters
        : [
            serviceName,
            message.code,
            ahead,
            eta,
            destination,
            deadline,
            reason,
          ]
      ).map((text) => ({ type: 'text', text }))
      const v4ButtonComponents = naturalV4?.template.buttons.map(
        (button, index) => ({
          type: 'button',
          sub_type: button.type === 'quick_reply' ? 'quick_reply' : 'url',
          index: String(index),
          parameters:
            button.type === 'quick_reply'
              ? [
                  {
                    type: 'payload',
                    payload:
                      button.action === 'yield'
                        ? message.actionPayloads?.yield
                        : message.actionPayloads?.cancel,
                  },
                ]
              : [
                  {
                    type: 'text',
                    text: `${message.venueId}?lang=${message.locale}&source=whatsapp`,
                  },
                ],
        }),
      ) ?? []
      const payload = serviceWindowReply
        ? serviceWindowCta
          ? {
              messaging_product: 'whatsapp',
              to: message.phone.slice(1),
              type: 'interactive',
              interactive: {
                type: 'cta_url',
                body: { text: message.textBody! },
                action: {
                  name: 'cta_url',
                  parameters: {
                    display_text: serviceWindowCta.label,
                    url: serviceWindowCtaUrl!,
                  },
                },
              },
            }
          : {
              messaging_product: 'whatsapp',
              to: message.phone.slice(1),
              type: 'text',
              text: { body: message.textBody! },
            }
        : positionUpdate
        ? {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'text',
            text: {
              body:
                message.position === 1
                  ? `Experimento NoQueue · ${message.code}: eres el siguiente en la lista. Esto no significa que tu mesa esté lista. Envía BAJA para dejar de recibir avisos.`
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
        : sandbox && version2
        ? {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'text',
            text: {
              body: version4
                ? renderLifecycleV4(v4Message)
                : version3 ? renderLifecycleV3(message, link) : sandboxLifecycleCopy(message, {
                serviceName,
                ahead,
                eta,
                destination,
                deadline,
                link,
              }),
            },
          }
        : sandbox
        ? {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'text',
            text: {
              body:
                message.notice === 'ready'
                  ? `${message.venue} · ${message.code}: ${message.locale === 'es' ? 'Tu turno está asignado. Acude ahora; consulta tu plazo en el enlace.' : 'Your turn is assigned. Come now; check your deadline using the link.'} ${link}`
                  : message.notice === 'approaching'
                  ? `${message.venue} · ${message.code}: ${message.locale === 'es' ? 'Tu turno se acerca. Todavía no está asignado.' : 'Your turn is approaching but has not been assigned yet.'} ${link}`
                  : message.notice === 'expired'
                  ? `${message.venue} · ${message.code}: ${message.locale === 'es' ? 'El plazo de llegada ha terminado. Puedes volver a inscribirte.' : 'The arrival deadline has passed. You can join again.'} ${link}`
                  : message.locale === 'es'
                  ? `${message.venue}: tu turno es ${message.code}. ${link}`
                  : `${message.venue}: your waiting list code is ${message.code}. ${link}`
            },
          }
        : version2 && version4 && naturalV4
        ? {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'template',
            template: {
              name: naturalV4.template.name,
              language: { code: message.locale === 'es' ? 'es_ES' : 'en_US' },
              components: [
                { type: 'body', parameters: templateParameters },
                ...v4ButtonComponents,
              ],
            },
          }
        : version2
        ? {
            messaging_product: 'whatsapp',
            to: message.phone.slice(1),
            type: 'template',
            template: {
              name,
              language: { code: message.locale === 'es' ? 'es_ES' : 'en_US' },
              components: [
                { type: 'body', parameters: templateParameters },
                {
                  type: 'button',
                  sub_type: 'url',
                  index: '0',
                  parameters: [{ type: 'text', text: templateLinkParameter }],
                },
              ],
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
  | {
      kind: 'action'
      id: string
      phone: string
      timestamp: number
      payload: string
      contextId: string
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
  interactive: z
    .object({
      type: z.literal('button_reply'),
      button_reply: z.object({
        id: z.string().regex(/^wa1\.[yc]\.[a-f0-9]{64}$/),
        title: z.string().max(256).optional(),
      }),
    })
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
          else if (
            message.context &&
            ((message.type === 'button' &&
              message.button?.payload !== undefined &&
              /^wa1\.[yc]\.[a-f0-9]{64}$/.test(message.button.payload) &&
              message.button.payload.length > 0) ||
              (message.type === 'interactive' &&
                message.interactive?.type === 'button_reply' &&
                message.interactive.button_reply.id))
          )
            result.push({
              kind: 'action',
              id: message.id,
              phone: `+${message.from}`,
              timestamp: Number(message.timestamp) * 1000,
              payload:
                message.type === 'button'
                  ? message.button!.payload
                  : message.interactive!.button_reply.id,
              contextId: message.context.id,
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
      z.object({
        message: z.string().optional(),
        code: z.number().optional(),
      }),
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
