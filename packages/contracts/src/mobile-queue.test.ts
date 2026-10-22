import { expect, it } from 'vitest'
import { mobileServiceJoinSchema, publicServiceJoinSchema, publicServiceConsentVersion } from './queue'
const input = { displayName: ' Guest ', partySize: 1, locale: 'es' }
it('requires an operational name but no account, phone or WhatsApp in mobile', () => {
  expect(mobileServiceJoinSchema.parse(input)).toEqual({ ...input, displayName: 'Guest' })
  expect(mobileServiceJoinSchema.safeParse({ ...input, displayName: '' }).success).toBe(false)
  for (const extra of [{ phone: '+34600000000' }, { whatsapp: { consent: false } }, { source: 'mobile-app' }, { installationId: 'guess' }])
    expect(mobileServiceJoinSchema.safeParse({ ...input, ...extra }).success).toBe(false)
})
it('does not relax the existing public web contract', () => {
  expect(publicServiceJoinSchema.safeParse(input).success).toBe(false)
  expect(publicServiceJoinSchema.safeParse({ ...input, whatsapp: { consent: false } }).success).toBe(false)
  expect(publicServiceJoinSchema.safeParse({ ...input, whatsapp: { consent: true, phone: '+34600000000', version: publicServiceConsentVersion } }).success).toBe(true)
})
