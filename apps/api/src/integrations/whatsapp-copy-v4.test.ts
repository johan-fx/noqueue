import { describe, expect, it } from 'vitest'
import type { OutboundWhatsAppMessage } from './360dialog'
import { copyVersion } from './whatsapp-copy-v3'
import {
  actualCallCopyVariant,
  lifecycleV4,
  renderLifecycleV4,
  whatsappV4Catalog,
  whatsappV4CatalogForEnvironment,
} from './whatsapp-copy-v4'

const base = {
  phone: '+34600000000',
  locale: 'es',
  venue: 'Example venue',
  venueId: 'example-venue',
  serviceName: 'Example service',
  code: 'ABCD23',
  token: 'a'.repeat(64),
  payloadVersion: 2,
  copyVersion: 4,
  notificationId: '550e8400-e29b-41d4-a716-446655440000',
  notice: 'queue_joined',
  ahead: 2,
  etaMinutes: 12,
  estimateQuality: 'estimated',
  resourceName: 'Example terrace',
  arrivalDeadlineAt: 1_700_000_600_000,
} as unknown as OutboundWhatsAppMessage

describe('immutable WhatsApp lifecycle v4 catalog', () => {
  it('uses native URL buttons for every navigation and resolves only the current environment name', () => {
    expect(whatsappV4Catalog).toHaveLength(38)
    expect(new Set(whatsappV4Catalog.map((item) => item.name)).size).toBe(38)
    expect(whatsappV4CatalogForEnvironment('staging')).toHaveLength(24)
    expect(whatsappV4CatalogForEnvironment('production')).toHaveLength(24)

    const joined = lifecycleV4(base)
    expect(joined.template.name).toBe('noqueue_v4_queue_joined_es_production')
    expect(joined.template.parameters).toEqual(['venue', 'reference', 'wait'])
    expect(joined.template.buttons).toEqual([
      expect.objectContaining({
        type: 'url',
        label: 'Consultar turno',
        destination: 'turn',
        urlPattern: 'https://noqueue-app.com/t/{{1}}',
      }),
    ])
    expect(renderLifecycleV4(base)).not.toContain('https://')
    expect(renderLifecycleV4(base)).not.toContain('recovery-token')

    const staging = lifecycleV4(base, 'staging')
    expect(staging.template.name).toBe('noqueue_v4_queue_joined_es_staging')
    expect(staging.template.buttons[0]).toEqual(
      expect.objectContaining({
        urlPattern: 'https://staging.noqueue-app.com/t/{{1}}',
      }),
    )
    const englishStaging = lifecycleV4(
      { ...base, locale: 'en' } as OutboundWhatsAppMessage,
      'staging',
    )
    expect(englishStaging.template.name).toBe(
      'noqueue_v4_queue_joined_en_staging',
    )
    expect(englishStaging.template.buttons[0]).toEqual(
      expect.objectContaining({ label: 'View my turn' }),
    )

    const ready = lifecycleV4({
      ...base,
      notice: 'ready',
      copyVariant: 'ready',
    } as OutboundWhatsAppMessage)
    expect(ready.template.parameters).toEqual(['venue', 'resource'])
    expect(ready.template.buttons.map((button) => button.type)).toEqual([
      'quick_reply',
      'quick_reply',
      'url',
    ])
    expect(ready.template.buttons[2]).toEqual(
      expect.objectContaining({
        label: 'Consultar turno',
        destination: 'turn',
      }),
    )
    expect(
      renderLifecycleV4(
        { ...base, notice: 'ready', copyVariant: 'ready' } as OutboundWhatsAppMessage,
        { includeButtonPreview: true },
      ),
    ).toContain('[Pasar turno]  [Abandonar la lista]  [Consultar turno]')

    for (const template of whatsappV4Catalog) {
      expect(template.body).not.toMatch(/https?:\/\//)
      expect(template.body).not.toMatch(/\/[tv]\//)
      expect(template.parameters).not.toContain('recovery')
      expect(template.buttons.length).toBeLessThanOrEqual(3)
      const urlButtons = template.buttons.filter((button) => button.type === 'url')
      if (urlButtons.length > 0) {
        expect(template.environment).toMatch(/^(staging|production)$/)
        expect(template.name).toMatch(/_(staging|production)$/)
        expect(urlButtons.length).toBeLessThanOrEqual(2)
        for (const button of urlButtons)
          expect(button.urlPattern).toMatch(
            /^https:\/\/(staging\.)?noqueue-app\.com\/[tv]\/\{\{1\}\}$/,
          )
      } else {
        expect(template.environment).toBeUndefined()
        expect(template.name).not.toMatch(/_(staging|production)$/)
      }
    }
  })

  it('uses the improved-ready copy only when the actual call beats the accepted forecast by the configured threshold', () => {
    expect(actualCallCopyVariant(null, 1_000_000, 5)).toBe('ready')
    expect(actualCallCopyVariant(1_299_999, 1_000_000, 5)).toBe('ready')
    expect(actualCallCopyVariant(1_300_000, 1_000_000, 5)).toBe(
      'improved_ready',
    )
  })
  it('keeps v2 as the default and accepts only explicitly configured profiles 2, 3, and 4', () => {
    expect(copyVersion({})).toBe(2)
    expect(copyVersion({ WHATSAPP_COPY_VERSION: '2' })).toBe(2)
    expect(copyVersion({ WHATSAPP_COPY_VERSION: '3' })).toBe(3)
    expect(copyVersion({ WHATSAPP_COPY_VERSION: '4' })).toBe(4)
    expect(copyVersion({ WHATSAPP_COPY_VERSION: '' })).toBeNull()
    expect(copyVersion({ WHATSAPP_COPY_VERSION: '5' })).toBeNull()
  })

  it('has a complete ES/EN/environment registration manifest with sequential parameters and valid button grouping', () => {
    expect(whatsappV4Catalog).toHaveLength(38)
    expect(new Set(whatsappV4Catalog.map((item) => item.name)).size).toBe(38)
    expect(new Set(whatsappV4Catalog.map((item) => item.binding)).size).toBe(24)

    for (const item of whatsappV4Catalog) {
      const placeholders = [...item.body.matchAll(/\{\{(\d+)\}\}/g)].map(
        (match) => Number(match[1]),
      )
      const bodyParameters = [...item.body.matchAll(/\{\{\d+\}\}/g)]
      expect(placeholders).toEqual(item.parameters.map((_, index) => index + 1))
      expect(item.examples).toHaveLength(item.parameters.length)
      expect(item.body.length).toBeLessThanOrEqual(1024)
      expect(item.body).not.toMatch(/^\{\{\d+\}\}/)
      expect(item.body).not.toMatch(/https?:\/\//)
      if (bodyParameters.length > 0) {
        const finalParameter = bodyParameters[bodyParameters.length - 1]!
        const trailingText = item.body.slice(
          finalParameter.index! + finalParameter[0].length,
        )
        expect(trailingText, item.name).toMatch(/[A-Za-zÀ-ÿ0-9]/)
      }
      for (let index = 1; index < bodyParameters.length; index += 1) {
        const previousParameter = bodyParameters[index - 1]!
        const currentParameter = bodyParameters[index]!
        const fixedText = item.body.slice(
          previousParameter.index! + previousParameter[0].length,
          currentParameter.index,
        )
        expect(fixedText.replace(/[\s*]/g, ''), item.name).not.toBe('')
      }
      expect(item.footer.length).toBeLessThanOrEqual(60)
      expect(item.buttons.length).toBeLessThanOrEqual(3)
      const buttonTypes = item.buttons.map((button) => button.type)
      expect(buttonTypes.every((type) => ['quick_reply', 'url'].includes(type))).toBe(
        true,
      )
      if (buttonTypes.includes('url')) {
        const firstUrl = buttonTypes.indexOf('url')
        expect(buttonTypes.slice(0, firstUrl).every((type) => type === 'quick_reply')).toBe(
          true,
        )
        expect(buttonTypes.slice(firstUrl).every((type) => type === 'url')).toBe(true)
      }
      for (const button of item.buttons)
        expect(button.label.length).toBeLessThanOrEqual(25)
    }

    const buttons = (variant: string) =>
      whatsappV4Catalog.find(
        (item) => item.variant === variant && item.locale === 'es',
      )!.buttons
    expect(buttons('approaching').map((button) => button.label)).toEqual([
      'Pasar turno',
      'Abandonar la lista',
    ])
    expect(buttons('ready').map((button) => button.label)).toEqual([
      'Pasar turno',
      'Abandonar la lista',
      'Consultar turno',
    ])
    expect(buttons('improved_wait_recommended').map((button) => button.label)).toEqual([
      'Pasar turno',
      'Abandonar la lista',
    ])
    expect(buttons('improved_wait_neutral').map((button) => button.label)).toEqual([
      'Pasar turno',
      'Abandonar la lista',
    ])
    expect(buttons('improved_ready').map((button) => button.label)).toEqual([
      'Pasar turno',
      'Abandonar la lista',
      'Consultar turno',
    ])
    expect(buttons('expired')).toEqual([
      expect.objectContaining({
        type: 'url',
        label: 'Elegir lista de espera',
        destination: 'venue-selector',
      }),
    ])
    expect(buttons('cancelled_customer')).toEqual([
      expect.objectContaining({
        type: 'url',
        label: 'Elegir lista de espera',
        destination: 'venue-selector',
      }),
    ])
    for (const variant of ['queue_joined', 'cancelled_staff', 'cancelled_unknown'])
      expect(buttons(variant)).toEqual([
        expect.objectContaining({
          type: 'url',
          label: 'Consultar turno',
          destination: 'turn',
        }),
      ])
    for (const variant of ['delayed', 'service_ended'])
      expect(buttons(variant)).toEqual([])
  })

  it('renders joined recovery only as a native button and keeps one compound wait parameter for zero/singular/plural/unknown states', () => {
    const message = (overrides: Partial<OutboundWhatsAppMessage> = {}) =>
      ({
        ...base,
        ...overrides,
        notice: 'queue_joined',
        recoveryUrl:
          'https://example.test/t/' +
          'a'.repeat(64) +
          `?lang=${overrides.locale ?? 'es'}&source=whatsapp&notice=550e8400-e29b-41d4-a716-446655440000`,
      }) as OutboundWhatsAppMessage

    const known = lifecycleV4(message({ ahead: 2, etaMinutes: 12 }))
    expect(known.template.parameters).toEqual([
      'venue',
      'reference',
      'wait',
    ])
    expect(known.parameters).toEqual([
      'Example venue',
      'ABCD23',
      'hay 2 turnos por delante. La espera estimada es de unos 12 minutos.',
    ])
    expect(
      renderLifecycleV4(message({ ahead: 2, etaMinutes: 12 })),
    ).toContain(
      'Por ahora, *hay 2 turnos por delante. La espera estimada es de unos 12 minutos.*',
    )
    const spanishJoined = renderLifecycleV4(message())
    expect(spanishJoined).toContain('Consulta el botón para ver o gestionar tu turno.')
    expect(spanishJoined).not.toContain('https://')
    const englishJoined = renderLifecycleV4(message({ locale: 'en' }))
    expect(englishJoined).toContain('Use the button to view or manage your turn.')
    expect(englishJoined).not.toContain('https://')

    const zero = lifecycleV4(message({ ahead: 0, etaMinutes: 0 }))
    expect(zero.template.buttons.map((button) => button.type)).toEqual(['url'])
    expect(renderLifecycleV4(message({ ahead: 0, etaMinutes: 0 }))).toContain(
      'Por ahora, *no tienes turnos por delante. La espera estimada es de unos 0 minutos.*',
    )
    expect(renderLifecycleV4(message({ ahead: 1, etaMinutes: 1 }))).toContain(
      'Por ahora, *hay 1 turno por delante. La espera estimada es de unos 1 minuto.*',
    )
    expect(renderLifecycleV4(message({ ahead: 3, etaMinutes: 12 }))).toContain(
      'Por ahora, *hay 3 turnos por delante. La espera estimada es de unos 12 minutos.*',
    )
    const unknown = renderLifecycleV4(
      message({ ahead: null, etaMinutes: 0, estimateQuality: 'unknown' }),
    )
    expect(unknown).toContain('Por ahora, *aún no podemos estimar la espera.*')
    expect(unknown).not.toContain('turnos por delante')
    expect(unknown).not.toContain('0 minutos')
    expect(unknown).toContain('ABCD23')
    expect(unknown).not.toContain('https://example.test/t/')

    expect(
      renderLifecycleV4(
        message({ ahead: 2, etaMinutes: null, estimateQuality: 'unknown' }),
      ),
    ).toContain(
      'Por ahora, *hay 2 turnos por delante. Aún no podemos estimar la espera.*',
    )
    const knownEtaWithoutAhead = renderLifecycleV4(
      message({ ahead: null, etaMinutes: 12, estimateQuality: 'estimated' }),
    )
    expect(knownEtaWithoutAhead).toContain(
      'Por ahora, *la espera estimada es de unos 12 minutos.*',
    )
    expect(knownEtaWithoutAhead).not.toContain('turnos por delante')
  })

  it('uses a single nonempty wait parameter when position or ETA information is unknown', () => {
    const cases = [
      { variant: 'queue_joined', notice: 'queue_joined' },
      { variant: 'approaching', notice: 'approaching' },
      { variant: 'delayed', notice: 'delayed' },
      { variant: 'improved_wait_recommended', notice: 'improved' },
      { variant: 'improved_wait_neutral', notice: 'improved' },
    ] as const

    for (const { variant, notice } of cases) {
      const copy = lifecycleV4({
        ...base,
        notice,
        copyVariant: variant.startsWith('improved_wait_') ? variant : undefined,
        ahead: null,
        etaMinutes: null,
        estimateQuality: 'unknown',
      } as unknown as OutboundWhatsAppMessage)
      expect(copy.template.variant).toBe(variant)
      expect(copy.template.parameters).toContain('wait')
      expect(copy.parameters).toContain(
        variant === 'queue_joined' || variant === 'approaching'
          ? 'aún no podemos estimar la espera.'
          : 'Aún no podemos estimar la espera.',
      )
      expect(copy.parameters.every((value) => !value.includes('*'))).toBe(true)
      if (variant !== 'queue_joined' && variant !== 'delayed')
        expect(
          copy.template.buttons.map((button) =>
            button.type === 'quick_reply' ? button.action : 'url',
          ),
        ).toEqual(['yield', 'cancel'])
      if (variant === 'queue_joined')
        expect(copy.template.buttons.map((button) => button.type)).toEqual(['url'])
      if (variant === 'delayed') expect(copy.template.buttons).toEqual([])
    }

    const known = lifecycleV4({
      ...base,
      notice: 'approaching',
      ahead: 1,
      etaMinutes: 1,
      estimateQuality: 'estimated',
    } as OutboundWhatsAppMessage)
    expect(known.template.variant).toBe('approaching')
    expect(known.template.parameters).toEqual(['venue', 'wait'])
    expect(known.parameters).toEqual([
      'Example venue',
      'hay 1 turno por delante. La espera estimada es de unos 1 minuto.',
    ])

    const englishUnknown = lifecycleV4({
      ...base,
      locale: 'en',
      notice: 'approaching',
      ahead: null,
      etaMinutes: null,
      estimateQuality: 'unknown',
    } as OutboundWhatsAppMessage)
    expect(englishUnknown.template.variant).toBe('approaching')
    expect(englishUnknown.parameters).toEqual([
      'Example venue',
      'we cannot estimate the wait yet.',
    ])
    expect(
      renderLifecycleV4({
        ...base,
        notice: 'approaching',
        ahead: null,
        etaMinutes: null,
        estimateQuality: 'unknown',
      } as OutboundWhatsAppMessage),
    ).toContain('Por ahora, *aún no podemos estimar la espera.*')
  })

  it('keeps the approved wait chunk bold in fixed template text without formatting dynamic values', () => {
    const body = (variant: string, locale: 'es' | 'en' = 'es') =>
      whatsappV4Catalog.find(
        (item) => item.variant === variant && item.locale === locale,
      )!.body

    expect(body('queue_joined')).toContain('*{{3}}*')
    expect(body('approaching')).toContain('*{{2}}*')
    expect(body('delayed')).toContain('*{{2}}*')
    expect(body('queue_joined', 'en')).toContain('*{{3}}*')
    expect(body('approaching', 'en')).toContain('*{{2}}*')
    expect(body('delayed', 'en')).toContain('*{{2}}*')
    for (const variant of [
      'improved_wait_recommended',
      'improved_wait_neutral',
    ]) {
      expect(body(variant)).toContain(
        '*¡Buenas noticias! Tu espera en {{1}} se ha reducido.*',
      )
      expect(body(variant)).toContain('*{{2}}*')
    }
    expect(body('improved_wait_recommended', 'en')).toContain(
      '*Good news! Your wait at {{1}} has shortened.*',
    )
    expect(body('improved_wait_neutral', 'en')).toContain(
      '*Good news! Your wait at {{1}} has shortened.*',
    )
    expect(body('improved_wait_recommended', 'en')).toContain('*{{2}}*')
    expect(body('improved_wait_neutral', 'en')).toContain('*{{2}}*')
    expect(body('ready')).toContain(
      '*Dirígete a {{2}}. Consulta el botón para conocer el plazo de llegada.*',
    )
    expect(body('ready', 'en')).toContain(
      '*Go to {{2}}. Check the button for your arrival deadline.*',
    )
    expect(body('improved_ready')).toContain(
      '*Acércate a {{2}}. Consulta el botón para conocer el plazo de llegada.*',
    )
    expect(body('improved_ready', 'en')).toContain(
      '*Go to {{2}}. Check the button for your arrival deadline.*',
    )
    expect(body('expired')).toContain(
      '*Lo sentimos, tu turno en {{1}} ha expirado.*',
    )
    expect(body('expired', 'en')).toContain('*Sorry, your turn at {{1}} has expired.*')
    expect(body('cancelled_customer')).toContain(
      '*Has salido de la lista de espera de {{1}}.*',
    )
    expect(body('cancelled_customer', 'en')).toContain(
      '*You have left the waiting list at {{1}}.*',
    )

    for (const item of whatsappV4Catalog) {
      expect(item.parameters).not.toContain('*')
      expect(item.examples.join(' ')).not.toContain('*')
      expect((item.body.match(/\*/g) ?? []).length % 2).toBe(0)
    }
  })

  it('preserves natural compound wait wording and distinguishes zero/singular/plural/unknown values in ES/EN', () => {
    const cases = [
      {
        locale: 'es',
        ahead: 0,
        etaMinutes: 0,
        estimateQuality: 'estimated',
        expected:
          'Por ahora, *no tienes turnos por delante. La espera estimada es de unos 0 minutos.*',
        plain: 'Por ahora, no tienes turnos por delante. La espera estimada es de unos 0 minutos.',
      },
      {
        locale: 'es',
        ahead: 1,
        etaMinutes: 1,
        estimateQuality: 'estimated',
        expected:
          'Por ahora, *hay 1 turno por delante. La espera estimada es de unos 1 minuto.*',
        plain: 'Por ahora, hay 1 turno por delante. La espera estimada es de unos 1 minuto.',
      },
      {
        locale: 'es',
        ahead: 3,
        etaMinutes: 12,
        estimateQuality: 'estimated',
        expected:
          'Por ahora, *hay 3 turnos por delante. La espera estimada es de unos 12 minutos.*',
        plain: 'Por ahora, hay 3 turnos por delante. La espera estimada es de unos 12 minutos.',
      },
      {
        locale: 'en',
        ahead: 0,
        etaMinutes: 0,
        estimateQuality: 'estimated',
        expected: 'For now, *there are no turns ahead. The estimated wait is around 0 minutes.*',
        plain: 'For now, there are no turns ahead. The estimated wait is around 0 minutes.',
      },
      {
        locale: 'en',
        ahead: 1,
        etaMinutes: 1,
        estimateQuality: 'estimated',
        expected: 'For now, *there is 1 turn ahead. The estimated wait is around 1 minute.*',
        plain: 'For now, there is 1 turn ahead. The estimated wait is around 1 minute.',
      },
      {
        locale: 'en',
        ahead: 3,
        etaMinutes: 12,
        estimateQuality: 'estimated',
        expected: 'For now, *there are 3 turns ahead. The estimated wait is around 12 minutes.*',
        plain: 'For now, there are 3 turns ahead. The estimated wait is around 12 minutes.',
      },
      {
        locale: 'es',
        ahead: null,
        etaMinutes: null,
        estimateQuality: 'unknown',
        expected: 'Por ahora, *aún no podemos estimar la espera.*',
        plain: 'Por ahora, aún no podemos estimar la espera.',
      },
      {
        locale: 'en',
        ahead: null,
        etaMinutes: null,
        estimateQuality: 'unknown',
        expected: 'For now, *we cannot estimate the wait yet.*',
        plain: 'For now, we cannot estimate the wait yet.',
      },
    ] as const

    for (const sample of cases) {
      const rendered = renderLifecycleV4({
        ...base,
        locale: sample.locale,
        notice: 'queue_joined',
        ahead: sample.ahead,
        etaMinutes: sample.etaMinutes,
        estimateQuality: sample.estimateQuality,
      } as OutboundWhatsAppMessage)
      const paragraph = rendered.split('\n\n')[2] ?? ''
      expect(paragraph).toBe(sample.expected)
      expect(paragraph.replaceAll('*', '')).toBe(sample.plain)
    }
  })

  it('keeps approach advice conditional and distinguishes waiting improvement from a called improved-ready notice', () => {
    const waiting = lifecycleV4({
      ...base,
      notice: 'improved',
      copyVariant: 'improved_wait_recommended',
      approachRecommended: true,
    } as OutboundWhatsAppMessage)
    expect(waiting.template.variant).toBe('improved_wait_recommended')
    expect(waiting.template.buttons).toHaveLength(2)

    const notReady = lifecycleV4({
      ...base,
      notice: 'improved',
      copyVariant: 'improved_wait_neutral',
      approachRecommended: false,
    } as OutboundWhatsAppMessage)
    expect(notReady.template.variant).toBe('improved_wait_neutral')
    expect(renderLifecycleV4({
      ...base,
      notice: 'improved',
      copyVariant: 'improved_wait_neutral',
      approachRecommended: false,
    } as OutboundWhatsAppMessage)).not.toContain(
      'Es buen momento para ir acercándote con calma.',
    )

    const called = lifecycleV4({
      ...base,
      notice: 'ready',
      copyVariant: 'improved_ready',
    } as OutboundWhatsAppMessage)
    expect(called.template.variant).toBe('improved_ready')
    expect(called.template.buttons).toHaveLength(3)
  })

  it('keeps ready copy immutable across retries and links to the authoritative arrival deadline', () => {
    const message = {
      ...base,
      notice: 'ready',
      recoveryUrl: 'https://example.test/t/recovery-token',
      arrivalDeadlineAt: 1_700_000_060_000,
    } as OutboundWhatsAppMessage
    const firstDelivery = lifecycleV4(message)
    const retry = lifecycleV4(message)
    expect(firstDelivery.parameters).toEqual(retry.parameters)
    expect(firstDelivery.template.parameters).toEqual(['venue', 'resource'])
    expect(firstDelivery.parameters).toEqual(['Example venue', 'Example terrace'])
    expect(renderLifecycleV4(message, { now: 1_700_000_000_000 })).not.toContain(
      'https://example.test/t/recovery-token',
    )
    expect(
      renderLifecycleV4(message, { now: 1_700_000_059_000 }),
    ).toBe(renderLifecycleV4(message, { now: 1_700_000_000_000 }))
    expect(renderLifecycleV4(message, { now: 1_700_000_000_000 })).not.toContain(
      'next 1 minute',
    )
    expect(lifecycleV4(message).template.buttons).toHaveLength(3)
  })

  it('uses the establishment name, not the queue service name, in venue copy', () => {
    const rendered = lifecycleV4({
      ...base,
      venue: 'Café Central',
      serviceName: 'Reception',
      notice: 'approaching',
    } as OutboundWhatsAppMessage)

    expect(rendered.parameters[0]).toBe('Café Central')
  })
})
