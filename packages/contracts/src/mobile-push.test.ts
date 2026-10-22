import { expect, it } from 'vitest'
import { pushRegistrationSchema, pushNoticeDataSchema } from './mobile-push'
it('accepts platform-specific tokens, never an injected identity or consent', () => {
  expect(pushRegistrationSchema.safeParse({ platform: 'ios', provider: 'fcm', token: 'AbCdEf:token-01234567890123456789', locale: 'en' }).success).toBe(true)
  expect(pushRegistrationSchema.safeParse({ platform: 'android', token: 'fcm:abc-01234567890123456789', locale: 'es' }).success).toBe(true)
  expect(pushRegistrationSchema.safeParse({ platform: 'ios', token: 'AB'.repeat(32), locale: 'en' }).success).toBe(false)
  expect(pushRegistrationSchema.safeParse({ platform: 'ios', provider: 'apns', token: 'AB'.repeat(32), locale: 'en' }).success).toBe(false)
  for (const extra of [{ phone: '+34600000000' }, { installationHash: 'ab'.repeat(32) }, { provider: 'apns' }, { whatsapp: { consent: true } }])
    expect(pushRegistrationSchema.safeParse({ platform: 'android', token: 'fcm:abc-01234567890123456789', locale: 'es', ...extra }).success).toBe(false)
})
it('requires an opaque hint and strips extra routing fields rather than trusting arbitrary URLs', () => {
  expect(pushNoticeDataSchema.parse({ type: 'queue-update', notificationId: '11'.repeat(16), url: 'https://evil.invalid' })).toEqual({ type: 'queue-update', notificationId: '11'.repeat(16) })
  expect(pushNoticeDataSchema.safeParse({ type: 'queue-update', notificationId: '../../auth' }).success).toBe(false)
})
