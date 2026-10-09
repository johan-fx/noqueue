import { describe, expect, it } from 'vitest'
import type { OutboundWhatsAppMessage } from './360dialog'
import { copyVersion } from './whatsapp-copy-v3'
import {
  actualCallCopyVariant,
  lifecycleV4,
  renderLifecycleV4,
  whatsappV4Catalog,
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

  it('has a complete ES/EN registration manifest with stable names, sequential parameters, and approved button shapes', () => {
    expect(whatsappV4Catalog).toHaveLength(24)
    expect(new Set(whatsappV4Catalog.map((item) => item.name)).size).toBe(24)
    expect(new Set(whatsappV4Catalog.map((item) => item.binding)).size).toBe(24)

    for (const item of whatsappV4Catalog) {
      const placeholders = [...item.body.matchAll(/\{\{(\d+)\}\}/g)].map(
        (match) => Number(match[1]),
      )
      expect(placeholders).toEqual(item.parameters.map((_, index) => index + 1))
      expect(item.examples).toHaveLength(item.parameters.length)
      expect(item.body.length).toBeLessThanOrEqual(1024)
      expect(item.footer.length).toBeLessThanOrEqual(60)
      expect(item.buttons.length).toBeLessThanOrEqual(2)
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
    for (const variant of [
      'queue_joined',
      'delayed',
      'cancelled_staff',
      'cancelled_unknown',
      'service_ended',
    ])
      expect(buttons(variant)).toEqual([])
  })

  it('renders joined recovery as a body link with no button and honest zero/singular/plural/unknown waits', () => {
    const message = (overrides: Partial<OutboundWhatsAppMessage> = {}) =>
      ({
        ...base,
        ...overrides,
        notice: 'queue_joined',
        recoveryUrl:
          'https://example.test/t/' +
          'a'.repeat(64) +
          '?lang=es&source=whatsapp&notice=550e8400-e29b-41d4-a716-446655440000',
      }) as OutboundWhatsAppMessage

    const zero = lifecycleV4(message({ ahead: 0, etaMinutes: 0 }))
    expect(zero.template.buttons).toEqual([])
    expect(renderLifecycleV4(message({ ahead: 0, etaMinutes: 0 }))).toContain(
      'No tienes turnos por delante.',
    )
    expect(renderLifecycleV4(message({ ahead: 1, etaMinutes: 1 }))).toContain(
      'Hay 1 turno por delante.',
    )
    expect(renderLifecycleV4(message({ ahead: 3, etaMinutes: 12 }))).toContain(
      'Hay 3 turnos por delante.',
    )
    const unknown = renderLifecycleV4(
      message({ ahead: null, etaMinutes: 0, estimateQuality: 'unknown' }),
    )
    expect(unknown).toContain('Aún no podemos estimar la espera.')
    expect(unknown).not.toContain('turnos por delante')
    expect(unknown).not.toContain('0 minutos')
    expect(unknown).toContain('https://example.test/t/')
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
    expect(called.template.buttons).toHaveLength(2)
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
    expect(firstDelivery.template.parameters).toEqual([
      'venue',
      'resource',
      'recovery',
    ])
    expect(firstDelivery.parameters).toEqual([
      'Example venue',
      'Example terrace',
      'https://example.test/t/recovery-token',
    ])
    expect(renderLifecycleV4(message, { now: 1_700_000_000_000 })).toContain(
      'https://example.test/t/recovery-token',
    )
    expect(
      renderLifecycleV4(message, { now: 1_700_000_059_000 }),
    ).toBe(renderLifecycleV4(message, { now: 1_700_000_000_000 }))
    expect(renderLifecycleV4(message, { now: 1_700_000_000_000 })).not.toContain(
      'next 1 minute',
    )
    expect(lifecycleV4(message).template.buttons).toHaveLength(2)
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
