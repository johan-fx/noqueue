import { whatsappV3Catalog } from '../../integrations/whatsapp-copy-v3'
import { whatsappV4CatalogForEnvironment } from '../../integrations/whatsapp-copy-v4'
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

it('requires the explicit v3 locale manifest approval and rejects invalid profiles', () => {
  expect(
    publicWhatsappAdmissionError(
      bindings({ WHATSAPP_COPY_VERSION: '3' }),
      contact,
      'es',
    ),
  ).toBe('whatsapp_unavailable')
  expect(
    publicWhatsappAdmissionError(
      bindings({ WHATSAPP_COPY_VERSION: 'invalid' }),
      contact,
      'es',
    ),
  ).toBe('whatsapp_unavailable')
})

it('requires every selected-locale v3 variant and keeps locale readiness independent', () => {
  const configured = Object.fromEntries(
    whatsappV3Catalog
      .filter((t) => t.locale === 'es')
      .map((t) => [t.binding, t.name]),
  )
  const ready = bindings({
    ...configured,
    WHATSAPP_COPY_VERSION: '3',
    WHATSAPP_V3_TEMPLATES_APPROVED: 'true',
  })
  expect(publicWhatsappAdmissionError(ready, contact, 'es')).toBeNull()
  const productionNames = Object.fromEntries(
    whatsappV4CatalogForEnvironment('production')
      .filter((template) => template.locale === 'es')
      .map((template) => [template.binding, template.name]),
  )
  expect(
    publicWhatsappAdmissionError(
      bindings({
        ...productionNames,
        PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com',
        WHATSAPP_COPY_VERSION: '4',
        WHATSAPP_V4_TEMPLATES_APPROVED: 'true',
      }),
      contact,
      'es',
    ),
  ).toBe('whatsapp_unavailable')
  expect(publicWhatsappAdmissionError(ready, contact, 'en')).toBe(
    'whatsapp_unavailable',
  )
  for (const spec of whatsappV3Catalog.filter((t) => t.locale === 'es')) {
    expect(
      publicWhatsappAdmissionError(
        { ...ready, [spec.binding]: '' },
        contact,
        'es',
      ),
    ).toBe('whatsapp_unavailable')
  }
})

it('fails closed for v4 until all selected-locale templates are registered and approved', () => {
  const configured = Object.fromEntries(
    whatsappV4CatalogForEnvironment('staging')
      .filter((template) => template.locale === 'es')
      .map((template) => [template.binding, template.name]),
  )
  const ready = bindings({
    ...configured,
    PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com',
    WHATSAPP_COPY_VERSION: '4',
    WHATSAPP_V4_TEMPLATES_APPROVED: 'true',
  })
  expect(publicWhatsappAdmissionError(ready, contact, 'es')).toBeNull()
  expect(publicWhatsappAdmissionError(ready, contact, 'en')).toBe(
    'whatsapp_unavailable',
  )
  expect(
    publicWhatsappAdmissionError(
      { ...ready, WHATSAPP_V4_TEMPLATES_APPROVED: 'false' },
      contact,
      'es',
    ),
  ).toBe('whatsapp_unavailable')
  const missingOne = {
    ...ready,
    [whatsappV4CatalogForEnvironment('staging').find(
      (template) => template.locale === 'es',
    )!.binding]: '',
  }
  expect(publicWhatsappAdmissionError(missingOne, contact, 'es')).toBe(
    'whatsapp_unavailable',
  )
})
