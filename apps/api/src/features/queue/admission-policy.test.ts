import { describe, expect, it } from 'vitest'
import { publicWhatsappAdmissionError } from './entries'

const contact = {
  consent: true,
  phone: '+34600000000',
  version: 'whatsapp-public-service-updates-v1',
} as const

function bindings(overrides: Partial<CloudflareBindings> = {}) {
  return {
    APP_ENV: 'production',
    PUBLIC_APP_ORIGIN: 'https://app.example.test',
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_MODE: 'cloud',
    STAGING_CONSENT_APPROVED: 'true',
    D360DIALOG_API_KEY: 'configured',
    D360DIALOG_PHONE_NUMBER_ID: 'configured',
    WHATSAPP_V2_TEMPLATES_APPROVED: 'true',
    WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_ES: 'joined_es_v2',
    WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_EN: 'joined_en_v2',
    WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
    ...overrides,
  } as CloudflareBindings
}

describe('public WhatsApp admission policy', () => {
  it('requires consent and a current LUMOSA notice version before a real public join', () => {
    expect(
      publicWhatsappAdmissionError(bindings(), { consent: false }, 'es'),
    ).toBe('whatsapp_consent_required')
    expect(
      publicWhatsappAdmissionError(
        bindings(),
        { ...contact, version: 'whatsapp-queue-updates-v1' },
        'es',
      ),
    ).toBe('whatsapp_consent_version_required')
  })

  it('fails closed when sender, locale template, approval or recipient is unavailable', () => {
    expect(
      publicWhatsappAdmissionError(
        bindings({ WHATSAPP_ENABLED: 'false' }),
        contact,
        'es',
      ),
    ).toBe('whatsapp_unavailable')
    expect(
      publicWhatsappAdmissionError(
        bindings({ WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_EN: '' }),
        contact,
        'en',
      ),
    ).toBe('whatsapp_unavailable')
    expect(
      publicWhatsappAdmissionError(
        bindings({ WHATSAPP_RECIPIENT_ALLOWLIST: '' }),
        contact,
        'es',
      ),
    ).toBe('recipient_not_allowed')
  })

  it('keeps the server-local loopback test exception', () => {
    expect(
      publicWhatsappAdmissionError(
        bindings({
          APP_ENV: 'local',
          PUBLIC_APP_ORIGIN: 'http://localhost:4173',
          WHATSAPP_ENABLED: 'false',
          D360DIALOG_API_KEY: '',
          WHATSAPP_RECIPIENT_ALLOWLIST: '',
        }),
        { consent: false },
        'es',
      ),
    ).toBeNull()
  })
})
