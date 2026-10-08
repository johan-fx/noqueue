import { describe, it, expect } from 'vitest'
import {
  joinQueueSchema,
  consentVersion,
  manualJoinSchema,
  publicServiceJoinSchema,
  publicServiceConsentVersion,
} from './queue'
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

it('requires an explicit phone and consent for public service admissions', () => {
  const base = {
    displayName: 'Guest',
    partySize: 2,
    locale: 'en',
  }
  expect(publicServiceJoinSchema.safeParse(base).success).toBe(false)
  expect(
    publicServiceJoinSchema.safeParse({
      ...base,
      whatsapp: { consent: false },
    }).success,
  ).toBe(false)
  expect(
    publicServiceJoinSchema.safeParse({
      ...base,
      whatsapp: {
        consent: true,
        phone: '+34600000000',
        version: publicServiceConsentVersion,
      },
    }).success,
  ).toBe(true)
})
it('accepts optional service details but rejects empty names and invalid subtypes', () => {
  const base = { partySize: 2, locale: 'es', whatsapp: { consent: false } }
  expect(
    joinQueueSchema.parse({
      ...base,
      displayName: '  María  ',
      receptionService: 'check_in',
    }),
  ).toMatchObject({ displayName: 'María', receptionService: 'check_in' })
  expect(
    joinQueueSchema.parse({ ...base, preferredSpaceId: 'fastest' }),
  ).toMatchObject({ preferredSpaceId: 'fastest' })
  for (const details of [
    { displayName: ' ' },
    { receptionService: 'invalid' },
    { preferredSpaceId: '' },
  ])
    expect(joinQueueSchema.safeParse({ ...base, ...details }).success).toBe(
      false,
    )
})

it('validates explicit manual WhatsApp consent without accepting a request-side bypass', () => {
  const base = { displayName: 'Client', partySize: 1, locale: 'es' }
  expect(manualJoinSchema.parse(base).whatsapp).toEqual({ consent: false })
  expect(
    manualJoinSchema.safeParse({
      ...base,
      whatsapp: {
        consent: true,
        phone: '+34600000000',
        version: consentVersion,
      },
    }).success,
  ).toBe(true)
  for (const whatsapp of [
    { consent: true },
    { consent: true, phone: '600000000', version: consentVersion },
    { consent: false, phone: '+34600000000' },
  ])
    expect(manualJoinSchema.safeParse({ ...base, whatsapp }).success).toBe(
      false,
    )
  expect(
    manualJoinSchema.safeParse({ ...base, allowWithoutWhatsapp: true }).success,
  ).toBe(false)
})

it('accepts manual v1/v2 while keeping the public contract on v1', () => {
  const input = {
    displayName: 'Client',
    partySize: 1,
    locale: 'en',
    whatsapp: {
      consent: true,
      phone: '+34600000000',
      version: 'whatsapp-manual-queue-updates-v2',
    },
  }
  expect(manualJoinSchema.safeParse(input).success).toBe(true)
  expect(joinQueueSchema.safeParse(input).success).toBe(false)
  expect(
    manualJoinSchema.safeParse({
      ...input,
      whatsapp: { ...input.whatsapp, version: consentVersion },
    }).success,
  ).toBe(true)
  expect(
    manualJoinSchema.safeParse({
      ...input,
      whatsapp: { ...input.whatsapp, version: 'unknown' },
    }).success,
  ).toBe(false)
})
