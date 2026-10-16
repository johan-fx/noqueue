import { expect, it } from 'vitest'
import { privacyConsentSchema } from './privacy'
import { isPrivacyConsent } from './privacy-policy'
it('keeps the small browser guard identical to strict receipt validation', () => {
  const data = { decisionId: '123e4567-e89b-42d3-a456-426614174000', consentId: '123e4567-e89b-42d3-a456-426614174000', revision: 1, locale: 'es', analytics: true }
  expect(isPrivacyConsent(data)).toBe(true)
  const cases: unknown[] = [null, [], false, data, { ...data, locale: 'en', analytics: false }, { ...data, extra: 1 }, { ...data, revision: 2 }, { ...data, locale: 'fr' }, { ...data, analytics: 1 }, { ...data, decisionId: 'a' }, { ...data, consentId: '00000000-0000-0000-0000-000000000000' }]
  for (const value of cases) expect(isPrivacyConsent(value)).toBe(privacyConsentSchema.safeParse(value).success)
})
