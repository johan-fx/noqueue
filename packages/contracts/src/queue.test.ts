import { describe, it, expect } from 'vitest'
import { joinQueueSchema, consentVersion } from './queue'
describe('join contract', () => {
  it('allows no-consent joins without a telephone', () =>
    expect(
      joinQueueSchema.safeParse({
        partySize: 2,
        locale: 'en',
        whatsapp: { consent: false },
      }).success,
    ).toBe(true))
  it.each([0, 21, 1.5])('rejects invalid party size %i', (partySize) =>
    expect(
      joinQueueSchema.safeParse({
        partySize,
        locale: 'es',
        whatsapp: { consent: false },
      }).success,
    ).toBe(false),
  )
  it('requires E.164 and current consent', () => {
    expect(
      joinQueueSchema.safeParse({
        partySize: 2,
        locale: 'es',
        whatsapp: {
          consent: true,
          phone: '+34600000000',
          version: consentVersion,
        },
      }).success,
    ).toBe(true)
    expect(
      joinQueueSchema.safeParse({
        partySize: 2,
        locale: 'es',
        whatsapp: {
          consent: true,
          phone: '600000000',
          version: consentVersion,
        },
      }).success,
    ).toBe(false)
  })
})
