import { describe, expect, it, vi } from 'vitest'
import {
  createWhatsAppSender,
  sandboxLifecycleCopy,
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
