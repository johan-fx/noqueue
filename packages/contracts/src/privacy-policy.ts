/** Browser-safe contract: no schema-library/runtime locale catalogue in the static landing. */
export const PRIVACY_REVISION = 1
export const CONSENT_DAYS = 180
export const privacyOrigins = ['https://noqueue-app.com', 'https://app.noqueue-app.com'] as const
export type PrivacyConsent = {
  decisionId: string
  consentId: string
  revision: typeof PRIVACY_REVISION
  locale: 'es' | 'en'
  analytics: boolean
}
const keys = ['decisionId', 'consentId', 'revision', 'locale', 'analytics']
// Same RFC UUID rules as the server's z.uuid(), including nil/max UUIDs.
const uuid = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i
export function isPrivacyConsent(value: unknown): value is PrivacyConsent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return Object.keys(data).length === keys.length && Object.keys(data).every((key) => keys.includes(key)) &&
    typeof data.decisionId === 'string' && uuid.test(data.decisionId) &&
    typeof data.consentId === 'string' && uuid.test(data.consentId) &&
    data.revision === PRIVACY_REVISION && (data.locale === 'es' || data.locale === 'en') && typeof data.analytics === 'boolean'
}
