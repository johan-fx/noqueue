import { describe, expect, it, vi } from 'vitest'
import { createWhatsAppSender, type OutboundWhatsAppMessage } from './360dialog'
import {
  copyVersion,
  lifecycleV3,
  renderLifecycleV3,
  whatsappV3Catalog,
} from './whatsapp-copy-v3'

const base: OutboundWhatsAppMessage = {
  phone: '+34600000000',
  locale: 'es',
  venue: 'Example venue',
  serviceName: 'Example service',
  code: 'ABCD23',
  token: 'a'.repeat(64),
  payloadVersion: 2,
  copyVersion: 3,
  notificationId: '550e8400-e29b-41d4-a716-446655440000',
  notice: 'queue_joined',
  ahead: 2,
  etaMinutes: 12,
  estimateQuality: 'estimated',
}
const env = {
  APP_ENV: 'staging',
  WHATSAPP_MODE: 'cloud',
  D360DIALOG_API_KEY: 'mock-key',
  D360DIALOG_REQUEST_TIMEOUT_MS: '1000',
  PUBLIC_APP_ORIGIN: 'https://example.test',
  STAGING_CONSENT_APPROVED: 'true',
  WHATSAPP_V3_TEMPLATES_APPROVED: 'true',
} as CloudflareBindings

function bindings(message: OutboundWhatsAppMessage) {
  const spec = lifecycleV3(message).template
  return { ...env, [spec.binding]: spec.name } as CloudflareBindings
}
describe('natural lifecycle v3 catalog', () => {
  it('defaults only absent profiles to v2 and refuses invalid configured versions', () => {
    expect(copyVersion({})).toBe(2)
    expect(copyVersion({ WHATSAPP_COPY_VERSION: '3' })).toBe(3)
    expect(copyVersion({ WHATSAPP_COPY_VERSION: 'invalid' })).toBeNull()
    expect(copyVersion({ WHATSAPP_COPY_VERSION: '' })).toBeNull()
  })
  it('publishes 20 provider-ready locale variants with sequential used parameters and safe examples', () => {
    expect(whatsappV3Catalog).toHaveLength(20)
    for (const spec of whatsappV3Catalog) {
      const placeholders = [...spec.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
        Number(m[1]),
      )
      expect(placeholders).toEqual(spec.parameters.map((_, i) => i + 1))
      expect(spec.examples).toHaveLength(spec.parameters.length)
      expect(spec.body.length).toBeLessThanOrEqual(1024)
      expect(spec.footer.length).toBeLessThanOrEqual(60)
      expect(spec.body).not.toMatch(/^\{\{|\}\}$/)
      expect(spec.body).not.toMatch(/\}\}\s*\{\{/)
      expect(spec.button).toBeTruthy()
    }
  })
  it.each(['es', 'en'] as const)(
    'renders every kind and cancellation reason identically in sandbox and cloud (%s)',
    async (locale) => {
      for (const notice of [
        'queue_joined',
        'approaching',
        'delayed',
        'improved',
        'ready',
        'expired',
        'cancelled',
        'service_ended',
      ] as const) {
        for (const cancellationReason of [
          'customer_cancel',
          'staff_cancel',
          undefined,
        ] as const) {
          const message = {
            ...base,
            locale,
            notice,
            ...(cancellationReason ? { cancellationReason } : {}),
          }
          const cloud = vi.fn(
            async (_url: RequestInfo | URL, _init?: RequestInit) =>
              Response.json({ messages: [{ id: 'mock-id' }] }),
          )
          const sandbox = vi.fn(
            async (_url: RequestInfo | URL, _init?: RequestInit) =>
              Response.json({ messages: [{ id: 'mock-id' }] }),
          )
          await createWhatsAppSender(bindings(message), cloud).send(message)
          await createWhatsAppSender(
            { ...env, WHATSAPP_MODE: 'sandbox' },
            sandbox,
          ).send(message)
          const cloudPayload = JSON.parse(
            String(cloud.mock.calls[0]?.[1]?.body),
          )
          const sandboxPayload = JSON.parse(
            String(sandbox.mock.calls[0]?.[1]?.body),
          )
          const rendered = lifecycleV3(message)
          expect(cloudPayload.template.name).toBe(rendered.template.name)
          expect(
            cloudPayload.template.components[0].parameters.map(
              (p: { text: string }) => p.text,
            ),
          ).toEqual(rendered.parameters)
          expect(sandboxPayload.text.body).toBe(
            renderLifecycleV3(
              message,
              `https://example.test/t/${base.token}?lang=${locale}&source=whatsapp&notice=${base.notificationId}`,
            ),
          )
          expect(cloudPayload.template.components[1].parameters[0].text).toBe(
            `${base.token}?lang=${locale}&source=whatsapp&notice=${base.notificationId}`,
          )
        }
      }
    },
  )
  it('handles unknown, provisional, zero, singular and null context without inventing state', () => {
    expect(renderLifecycleV3(base, 'LINK')).toContain(
      'Calculamos unos 12 minutos de espera.',
    )
    expect(
      renderLifecycleV3(
        { ...base, estimateQuality: 'provisional', etaMinutes: 1, ahead: 1 },
        'LINK',
      ),
    ).toContain('Calculamos alrededor de 1 minuto de espera.')
    const unknown = renderLifecycleV3(
      { ...base, estimateQuality: 'unknown', etaMinutes: 0, ahead: null },
      'LINK',
    )
    expect(unknown).toContain('Aún no podemos estimar la espera.')
    expect(unknown).not.toContain('0 minutos')
    expect(unknown).not.toContain('por delante')
    expect(
      renderLifecycleV3({ ...base, etaMinutes: 0, ahead: 0 }, 'LINK'),
    ).toContain('Calculamos unos 0 minutos de espera.')
    expect(
      renderLifecycleV3({ ...base, etaMinutes: 0, ahead: 0 }, 'LINK'),
    ).toContain('Estás al principio de la cola.')
    const ready = renderLifecycleV3(
      { ...base, notice: 'ready', resourceName: 'Terrace' },
      'LINK',
    )
    expect(ready).toContain('Example service · Terrace')
    expect(ready).toContain('Consulta tu plazo de llegada en el enlace.')
    expect(ready).not.toContain('antes de las Consulta')
    expect(
      renderLifecycleV3({ ...base, venue: 'Example service' }, 'LINK').match(
        /Example service/g,
      ),
    ).toHaveLength(1)
    expect(
      renderLifecycleV3(
        { ...base, notice: 'improved', approachRecommended: true },
        'LINK',
      ),
    ).toContain('acercándote con calma')
    expect(
      renderLifecycleV3(
        { ...base, notice: 'improved', approachRecommended: false },
        'LINK',
      ),
    ).not.toContain('acercándote con calma')
    expect(
      renderLifecycleV3(
        { ...base, notice: 'cancelled', cancellationReason: 'staff_cancel' },
        'LINK',
      ),
    ).not.toContain('staff_cancel')
  })
  it('renders bilingual singular wait/ahead and complete known deadlines', () => {
    const english = renderLifecycleV3(
      {
        ...base,
        locale: 'en',
        etaMinutes: 1,
        ahead: 1,
        estimateQuality: 'provisional',
      },
      'LINK',
    )
    expect(english).toContain('We estimate a wait of around 1 minute.')
    expect(english).toContain('There is 1 turn ahead of you.')
    for (const locale of ['es', 'en'] as const) {
      const ready = renderLifecycleV3(
        {
          ...base,
          locale,
          notice: 'ready',
          arrivalDeadlineAt: 1_800_000_000_000,
        },
        'LINK',
      )
      expect(ready).toContain(
        locale === 'es' ? 'Llega antes de las' : 'Arrive before',
      )
      expect(ready).not.toContain(
        locale === 'es' ? 'Consulta tu plazo' : 'Check your arrival deadline',
      )
      const ended = renderLifecycleV3(
        { ...base, locale, notice: 'service_ended' },
        'LINK',
      )
      expect(ended).toContain(
        locale === 'es'
          ? 'cuando el servicio esté disponible'
          : 'when the service is available',
      )
      expect(ended).not.toContain('today')
    }
  })
  it('independently guards every v3 dispatch variant without provider fetch or v2 fallback', async () => {
    for (const spec of whatsappV3Catalog) {
      const cancellationReason =
        spec.variant === 'customer'
          ? 'customer_cancel'
          : spec.variant === 'staff'
          ? 'staff_cancel'
          : undefined
      const message = {
        ...base,
        locale: spec.locale,
        notice: spec.kind,
        ...(cancellationReason
          ? {
              cancellationReason: cancellationReason as
                | 'customer_cancel'
                | 'staff_cancel',
            }
          : {}),
      }
      const fetcher = vi.fn()
      const result = await createWhatsAppSender(
        { ...env, WHATSAPP_V2_TEMPLATES_APPROVED: 'true' },
        fetcher,
      ).send(message)
      expect(result.kind).toBe('failed')
      expect(fetcher).not.toHaveBeenCalled()
    }
  })
  it('fails closed without fetching for absent, mismatched or unapproved v3 binding', async () => {
    for (const overrides of [
      {},
      { [lifecycleV3(base).template.binding]: 'wrong' },
      { ...bindings(base), WHATSAPP_V3_TEMPLATES_APPROVED: 'false' },
    ]) {
      const fetcher = vi.fn()
      const result = await createWhatsAppSender(
        { ...env, ...overrides },
        fetcher,
      ).send(base)
      expect(result.kind).toBe('failed')
      expect(fetcher).not.toHaveBeenCalled()
    }
  })
})

it('puts the improved action before wait details', () => {
  const body = renderLifecycleV3(
    { ...base, notice: 'improved', approachRecommended: true },
    'LINK',
  )
  expect(body.indexOf('acercándote con calma')).toBeLessThan(
    body.indexOf('Calculamos'),
  )
})

it.each(['es', 'en'] as const)(
  'keeps natural sentences without administrative labels (%s)',
  (locale) => {
    for (const spec of whatsappV3Catalog.filter(
      (spec) => spec.locale === locale,
    )) {
      const text = renderLifecycleV3(
        { ...base, locale, notice: spec.kind, approachRecommended: true },
        'LINK',
      )
      expect(text).not.toMatch(
        /Sobre la espera:|Qué hacer ahora:|Dónde acudir:|Tu llegada:|About the wait:|What to do now:|Where to go:|Your arrival:/,
      )
      expect(spec.body).not.toMatch(/\}\}\s*\{\{/)
      expect(spec.body).not.toMatch(/^\{\{|\}\}$/)
      expect(text).toContain(
        locale === 'es'
          ? '\n\nTu turno: Example venue · Example service · ABCD23'
          : '\n\nYour turn: Example venue · Example service · ABCD23',
      )
    }
  },
)
it('uses one details fragment for improved and one arrival fragment for ready without a whole-body variable', () => {
  const improved = lifecycleV3({
    ...base,
    notice: 'improved',
    approachRecommended: true,
  })
  expect(improved.template.parameters).toEqual(['details', 'reference'])
  expect(improved.parameters[0]).toMatch(
    /^Es buen momento para ir acercándote con calma\./,
  )
  expect(improved.parameters[0]).toContain(
    'Calculamos unos 12 minutos de espera.',
  )
  const ready = lifecycleV3({
    ...base,
    notice: 'ready',
    resourceName: 'Terrace',
  })
  expect(ready.template.parameters).toEqual(['arrival', 'reference'])
  expect(ready.parameters[0]).toBe(
    'Acude a Example service · Terrace. Consulta tu plazo de llegada en el enlace.',
  )
  expect(ready.template.body).toMatch(/^¡Ya es tu turno!\n\n\{\{1\}\}/)
  expect(ready.template.body).toContain(
    '\n\nTu turno: {{2}}\n\nPuedes consultar tu turno en el enlace.',
  )
})
