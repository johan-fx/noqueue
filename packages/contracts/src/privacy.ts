import { z } from 'zod'

import { PRIVACY_REVISION, type PrivacyConsent } from './privacy-policy'
export { PRIVACY_REVISION, CONSENT_DAYS, privacyOrigins, type PrivacyConsent } from './privacy-policy'
export const privacyConsentSchema = z.object({
  decisionId: z.uuid(),
  consentId: z.uuid(),
  revision: z.literal(PRIVACY_REVISION),
  locale: z.enum(['es', 'en']),
  analytics: z.boolean(),
}).strict() satisfies z.ZodType<PrivacyConsent>

