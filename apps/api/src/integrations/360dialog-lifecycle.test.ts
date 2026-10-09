import { describe, expect, it, vi } from 'vitest'
import {
  createWhatsAppSender,
  sandboxLifecycleCopy,
  whatsappWebhookParser,
  type OutboundWhatsAppMessage,
} from './360dialog'

const message: OutboundWhatsAppMessage = {
  phone: '+34600000000',
  locale: 'es',
  venue: 'Hotel LUMOSA',
  serviceName: 'Restaurante',
  code: 'ABCD23',
  token: 'not-logged-token',
  payloadVersion: 2,
  notice: 'queue_joined',
  ahead: 2,
  etaMinutes: 12,
  estimateQuality: 'estimated',
}

describe('sandbox lifecycle copy', () => {
  const context = {
    serviceName: 'Restaurante',
    ahead: '2',
    eta: '12 min',
    destination: 'Terraza',
    deadline: '12:15',
    link: 'https://example.test/t/token?lang=es&source=whatsapp',
  }

  it('renders joined, approaching, ready, and expired messages without inventing ETA', () => {
    expect(sandboxLifecycleCopy(message, context)).toBe(
      'Hotel LUMOSA · Restaurante · ABCD23: estás en la lista. Quedan 2 turnos por delante. Tiempo estimado: 12 min. https://example.test/t/token?lang=es&source=whatsapp Envía BAJA para dejar de recibir avisos.',
    )
    expect(
      sandboxLifecycleCopy({ ...message, notice: 'approaching' }, context),
    ).toContain('todavía no está asignado')
    expect(
      sandboxLifecycleCopy({ ...message, notice: 'ready' }, context),
    ).toContain('asignado en Terraza')
    expect(
      sandboxLifecycleCopy({ ...message, notice: 'expired' }, context),
    ).toContain('Puedes volver a inscribirte')
    expect(
      sandboxLifecycleCopy(
        { ...message, notice: 'delayed', etaMinutes: null, estimateQuality: 'unknown' },
        { ...context, eta: 'sin estimación' },
      ),
    ).toContain('sin estimación')
  })
})

it('includes the versioned notice id and locale/source in the cloud URL-button suffix', async () => {
  const notificationId = '550e8400-e29b-41d4-a716-446655440000'
  const token = 'a'.repeat(64)
  const payloads: {
    template?: { components: { parameters?: { text?: string }[] }[] }
  }[] = []
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    payloads.push(
      JSON.parse(String(init?.body)) as (typeof payloads)[number],
    )
    return Response.json({ messages: [{ id: 'accepted-id' }] }, { status: 200 })
  })
  const sender = createWhatsAppSender(
    {
      D360DIALOG_API_KEY: 'mock-key',
      D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
      PUBLIC_APP_ORIGIN: 'https://example.test',
      WHATSAPP_MODE: 'cloud',
      APP_ENV: 'staging',
      STAGING_CONSENT_APPROVED: 'true',
      WHATSAPP_V2_TEMPLATES_APPROVED: 'true',
      WHATSAPP_QUEUE_V2_READY_TEMPLATE_ES: 'noqueue_v2_ready_es',
    } as CloudflareBindings,
    fetcher as typeof fetch,
  )

  const result = await sender.send({
    ...message,
    token,
    notificationId,
    notice: 'ready',
  })

  expect(result).toEqual({ kind: 'accepted', providerId: 'accepted-id' })
  expect(payloads[0]?.template?.components[1]?.parameters?.[0]?.text).toBe(
    `${token}?lang=es&source=whatsapp&notice=${notificationId}`,
  )
})

it('sends v4 native reply actions with the frozen payloads and an honest venue-selector URL', async () => {
  const payloads: Record<string, any>[] = []
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, any>)
    return Response.json({ messages: [{ id: 'accepted-id' }] }, { status: 200 })
  })
  const sender = createWhatsAppSender(
    {
      D360DIALOG_API_KEY: 'mock-key',
      D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
      PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com',
      WHATSAPP_MODE: 'cloud',
      APP_ENV: 'staging',
      STAGING_CONSENT_APPROVED: 'true',
      WHATSAPP_V4_TEMPLATES_APPROVED: 'true',
      WHATSAPP_QUEUE_V4_APPROACHING_TEMPLATE_ES:
        'noqueue_v4_approaching_es',
      WHATSAPP_QUEUE_V4_EXPIRED_TEMPLATE_ES: 'noqueue_v4_expired_es_staging',
    } as unknown as CloudflareBindings,
    fetcher as typeof fetch,
  )

  const result = await sender.send({
    ...message,
    copyVersion: 4,
    notificationId: '550e8400-e29b-41d4-a716-446655440000',
    notice: 'approaching',
    copyVariant: 'approaching',
    actionPayloads: { yield: 'opaque-yield', cancel: 'opaque-cancel' },
  } as OutboundWhatsAppMessage)

  expect(result).toEqual({ kind: 'accepted', providerId: 'accepted-id' })
  expect(payloads[0]?.template?.name).toBe('noqueue_v4_approaching_es')
  expect(payloads[0]?.template?.components).toEqual([
    expect.objectContaining({ type: 'body' }),
    expect.objectContaining({
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: 'opaque-yield' }],
    }),
    expect.objectContaining({
      type: 'button',
      sub_type: 'quick_reply',
      index: '1',
      parameters: [{ type: 'payload', payload: 'opaque-cancel' }],
    }),
  ])

  await sender.send({
    ...message,
    copyVersion: 4,
    notice: 'expired',
    venueId: 'example-venue',
    token: 'a'.repeat(64),
    notificationId: '550e8400-e29b-41d4-a716-446655440001',
    copyVariant: 'expired',
  } as OutboundWhatsAppMessage)
  expect(payloads[1]?.template?.components[1]).toEqual({
    type: 'button',
    sub_type: 'url',
    index: '0',
    parameters: [
      { type: 'text', text: 'example-venue?lang=es&source=whatsapp' },
    ],
  })
  expect(payloads[1]?.template?.name).toBe('noqueue_v4_expired_es_staging')
})

it('sends turn navigation only as environment-specific native URL buttons', async () => {
  const payloads: Record<string, any>[] = []
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, any>)
    return Response.json({ messages: [{ id: 'accepted-id' }] }, { status: 200 })
  })
  const notificationId = '550e8400-e29b-41d4-a716-446655440002'
  const token = 'a'.repeat(64)
  const sender = createWhatsAppSender(
    {
      D360DIALOG_API_KEY: 'mock-key',
      D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
      PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com',
      WHATSAPP_MODE: 'cloud',
      APP_ENV: 'staging',
      STAGING_CONSENT_APPROVED: 'true',
      WHATSAPP_V4_TEMPLATES_APPROVED: 'true',
      WHATSAPP_QUEUE_V4_QUEUE_JOINED_TEMPLATE_ES:
        'noqueue_v4_queue_joined_es_staging',
      WHATSAPP_QUEUE_V4_READY_TEMPLATE_ES: 'noqueue_v4_ready_es_staging',
      WHATSAPP_QUEUE_V4_CANCELLED_STAFF_TEMPLATE_ES:
        'noqueue_v4_cancelled_staff_es_staging',
    } as unknown as CloudflareBindings,
    fetcher as typeof fetch,
  )

  const joined = await sender.send({
    ...message,
    token,
    payloadVersion: 2,
    copyVersion: 4,
    notificationId,
    notice: 'queue_joined',
    ahead: 2,
    etaMinutes: 12,
    estimateQuality: 'estimated',
  })
  expect(joined).toEqual({ kind: 'accepted', providerId: 'accepted-id' })
  expect(payloads[0]?.template?.name).toBe('noqueue_v4_queue_joined_es_staging')
  expect(payloads[0]?.template?.components).toEqual([
    expect.objectContaining({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Hotel LUMOSA' },
        { type: 'text', text: 'ABCD23' },
        {
          type: 'text',
          text: 'hay 2 turnos por delante. La espera estimada es de unos 12 minutos.',
        },
      ],
    }),
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [
        {
          type: 'text',
          text: `${token}?lang=es&source=whatsapp&notice=${notificationId}`,
        },
      ],
    },
  ])
  expect(JSON.stringify(payloads[0]?.template?.components[0])).not.toContain(token)
  expect(JSON.stringify(payloads[0]?.template?.components[0])).not.toContain('https://')

  const ready = await sender.send({
    ...message,
    token,
    payloadVersion: 2,
    copyVersion: 4,
    notificationId,
    notice: 'ready',
    copyVariant: 'ready',
    venueId: 'lumosa',
    resourceName: 'Terraza',
    actionPayloads: { yield: 'opaque-yield', cancel: 'opaque-cancel' },
  })
  expect(ready).toEqual({ kind: 'accepted', providerId: 'accepted-id' })
  expect(payloads[1]?.template?.name).toBe('noqueue_v4_ready_es_staging')
  expect(payloads[1]?.template?.components).toEqual([
    expect.objectContaining({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Hotel LUMOSA' },
        { type: 'text', text: 'Terraza' },
      ],
    }),
    expect.objectContaining({ type: 'button', sub_type: 'quick_reply', index: '0' }),
    expect.objectContaining({ type: 'button', sub_type: 'quick_reply', index: '1' }),
    {
      type: 'button',
      sub_type: 'url',
      index: '2',
      parameters: [
        {
          type: 'text',
          text: `${token}?lang=es&source=whatsapp&notice=${notificationId}`,
        },
      ],
    },
  ])

  const staffCancelled = await sender.send({
    ...message,
    token,
    payloadVersion: 2,
    copyVersion: 4,
    notificationId,
    notice: 'cancelled',
    cancellationReason: 'staff_cancel',
  })
  expect(staffCancelled).toEqual({ kind: 'accepted', providerId: 'accepted-id' })
  expect(payloads[2]?.template?.components[1]).toEqual({
    type: 'button',
    sub_type: 'url',
    index: '0',
    parameters: [
      {
        type: 'text',
        text: `${token}?lang=es&source=whatsapp&notice=${notificationId}`,
      },
    ],
  })
})

it('keeps sandbox V4 previews plain text while displaying the modeled button labels', async () => {
  let payload: Record<string, any> | undefined
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body)) as Record<string, any>
    return Response.json({ messages: [{ id: 'sandbox-id' }] }, { status: 200 })
  })
  const sender = createWhatsAppSender(
    {
      D360DIALOG_API_KEY: 'mock-key',
      D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
      PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com',
      WHATSAPP_MODE: 'sandbox',
      APP_ENV: 'staging',
    } as unknown as CloudflareBindings,
    fetcher as typeof fetch,
  )
  const token = 'a'.repeat(64)
  const result = await sender.send({
    ...message,
    token,
    payloadVersion: 2,
    copyVersion: 4,
    notificationId: '550e8400-e29b-41d4-a716-446655440003',
    notice: 'queue_joined',
    venueId: 'lumosa',
  })

  expect(result).toEqual({ kind: 'accepted', providerId: 'sandbox-id' })
  expect(payload?.type).toBe('text')
  expect(payload?.template).toBeUndefined()
  expect(payload?.text?.body).toContain('[Consultar turno]')
  expect(payload?.text?.body).not.toContain(token)
  expect(payload?.text?.body).not.toContain('https://')
})

it('blocks v4 cloud sends when any profile approval or template binding is incomplete', async () => {
  const fetcher = vi.fn()
  const sender = createWhatsAppSender(
    {
      D360DIALOG_API_KEY: 'mock-key',
      D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
      PUBLIC_APP_ORIGIN: 'https://example.test',
      WHATSAPP_MODE: 'cloud',
      APP_ENV: 'staging',
      STAGING_CONSENT_APPROVED: 'true',
      WHATSAPP_V4_TEMPLATES_APPROVED: 'true',
      WHATSAPP_QUEUE_V4_APPROACHING_TEMPLATE_ES:
        'noqueue_v4_approaching_es',
    } as unknown as CloudflareBindings,
    fetcher as typeof fetch,
  )
  const result = await sender.send({
    ...message,
    copyVersion: 4,
    notice: 'approaching',
    copyVariant: 'approaching',
    actionPayloads: { yield: 'opaque-yield', cancel: 'opaque-cancel' },
  } as OutboundWhatsAppMessage)
  expect(result).toEqual({
    kind: 'failed',
    diagnostic: {
      reason: 'configuration',
      httpStatus: null,
      providerCode: null,
    },
  })
  expect(fetcher).not.toHaveBeenCalled()
})

it('sends an event-bound action result as free-form text in the service window', async () => {
  let payload: Record<string, any> | undefined
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body)) as Record<string, any>
    return Response.json({ messages: [{ id: 'reply-id' }] }, { status: 200 })
  })
  const sender = createWhatsAppSender(
    {
      D360DIALOG_API_KEY: 'mock-key',
      D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
      PUBLIC_APP_ORIGIN: 'https://example.test',
      WHATSAPP_MODE: 'cloud',
      APP_ENV: 'staging',
    } as CloudflareBindings,
    fetcher as typeof fetch,
  )

  const result = await sender.send({
    phone: message.phone,
    locale: message.locale,
    venue: message.venue,
    code: message.code,
    token: message.token,
    textBody: 'You passed your turn.',
    serviceWindowReply: true,
  })

  expect(result).toEqual({ kind: 'accepted', providerId: 'reply-id' })
  expect(payload).toEqual({
    messaging_product: 'whatsapp',
    to: '34600000000',
    type: 'text',
    text: { body: 'You passed your turn.' },
  })
})

it('sends a cancelled-action selector as a short standalone CTA URL reply', async () => {
  let payload: Record<string, any> | undefined
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body)) as Record<string, any>
    return Response.json({ messages: [{ id: 'selector-id' }] }, { status: 200 })
  })
  const sender = createWhatsAppSender(
    {
      D360DIALOG_API_KEY: 'mock-key',
      D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
      PUBLIC_APP_ORIGIN: 'https://example.test',
      WHATSAPP_MODE: 'cloud',
      APP_ENV: 'staging',
    } as CloudflareBindings,
    fetcher as typeof fetch,
  )

  const result = await sender.send({
    phone: message.phone,
    locale: 'es',
    venue: message.venue,
    venueId: 'example-venue',
    code: message.code,
    token: message.token,
    textBody: 'Has salido de la lista y se ha liberado tu turno.',
    serviceWindowReply: true,
    serviceWindowCta: { label: 'Elegir lista' },
  })

  expect(result).toEqual({ kind: 'accepted', providerId: 'selector-id' })
  expect(payload).toEqual({
    messaging_product: 'whatsapp',
    to: '34600000000',
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: 'Has salido de la lista y se ha liberado tu turno.' },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: 'Elegir lista',
          url: 'https://example.test/v/example-venue?lang=es&source=whatsapp',
        },
      },
    },
  })
  expect('Elegir lista'.length).toBeLessThanOrEqual(20)
})

it('fails closed for overlong standalone CTA labels before contacting the provider', async () => {
  const fetcher = vi.fn()
  const sender = createWhatsAppSender(
    {
      D360DIALOG_API_KEY: 'mock-key',
      D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
      PUBLIC_APP_ORIGIN: 'https://example.test',
      WHATSAPP_MODE: 'cloud',
      APP_ENV: 'staging',
    } as CloudflareBindings,
    fetcher as typeof fetch,
  )

  const result = await sender.send({
    phone: message.phone,
    locale: 'es',
    venue: message.venue,
    venueId: 'example-venue',
    code: message.code,
    token: message.token,
    textBody: 'Has salido de la lista.',
    serviceWindowReply: true,
    serviceWindowCta: {
      label: 'Elegir lista de espera',
    },
  })

  expect(result.kind).toBe('failed')
  expect(fetcher).not.toHaveBeenCalled()
})

it('normalizes only signed provider button payloads with the original message context', () => {
  const envelope = (message: Record<string, unknown>) => ({
    entry: [
      {
        changes: [
          {
            value: { messages: [{
              id: 'inbound-message',
              from: '34600000000',
              timestamp: '1700000000',
              ...message,
            }] },
          },
        ],
      },
    ],
  })
  expect(
    whatsappWebhookParser.parse(
      envelope({
        type: 'button',
        button: { text: 'Pasar turno', payload: `wa1.y.${'a'.repeat(64)}` },
        context: { id: 'provider-message' },
      }),
    ),
  ).toEqual([
    {
      kind: 'action',
      id: 'inbound-message',
      phone: '+34600000000',
      timestamp: 1_700_000_000_000,
      payload: `wa1.y.${'a'.repeat(64)}`,
      contextId: 'provider-message',
    },
  ])
  expect(
    whatsappWebhookParser.parse(
      envelope({
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: {
            id: `wa1.c.${'b'.repeat(64)}`,
            title: 'Abandonar la lista',
          },
        },
        context: { id: 'provider-message' },
      }),
    )[0],
  ).toMatchObject({
    kind: 'action',
    payload: `wa1.c.${'b'.repeat(64)}`,
    contextId: 'provider-message',
  })
})
