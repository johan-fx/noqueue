import { describe, expect, it } from 'vitest'
import { customerRouteFromUrl } from './deep-link-routing'

describe('customerRouteFromUrl', () => {
  const origin = 'https://customers.example.test'

  it('routes only the public customer views and preserves supported locale/source', () => {
    expect(
      customerRouteFromUrl(
        'https://customers.example.test/t/' + 'a'.repeat(64) + '?lang=en&source=whatsapp',
        origin,
      ),
    ).toBe(`/t/${'a'.repeat(64)}?lang=en&source=whatsapp`)
    expect(customerRouteFromUrl('https://customers.example.test/v/venue_1?lang=es', origin)).toBe(
      '/v/venue_1?lang=es',
    )
    expect(customerRouteFromUrl('https://customers.example.test/q/queue-1', origin)).toBe(
      '/q/queue-1',
    )
  })

  it('preserves a versioned WhatsApp notice id only for turn links', () => {
    const notice = '550e8400-e29b-41d4-a716-446655440000'
    expect(
      customerRouteFromUrl(
        `https://customers.example.test/t/${'a'.repeat(64)}?lang=es&source=whatsapp&notice=${notice}`,
        origin,
      ),
    ).toBe(`/t/${'a'.repeat(64)}?lang=es&source=whatsapp&notice=${notice}`)
    expect(
      customerRouteFromUrl(
        `https://customers.example.test/v/venue?source=whatsapp&notice=${notice}`,
        origin,
      ),
    ).toBeNull()
    expect(
      customerRouteFromUrl(
        `https://customers.example.test/t/${'a'.repeat(64)}?notice=${notice}`,
        origin,
      ),
    ).toBeNull()
  })

  it.each([
    'https://attacker.example.test/t/' + 'a'.repeat(64),
    'http://customers.example.test/t/' + 'a'.repeat(64),
    'https://customers.example.test/staff',
    'https://customers.example.test/t/not-a-token',
    'https://customers.example.test/t/' + 'a'.repeat(64) + '?redirect=https://attacker.test',
    'https://customers.example.test/t/' + 'a'.repeat(64) + '#fragment',
  ])('rejects untrusted or unsupported URL %s', (url) => {
    expect(customerRouteFromUrl(url, origin)).toBeNull()
  })

  it('fails closed without a configured canonical origin', () => {
    expect(customerRouteFromUrl('https://customers.example.test/v/venue', undefined)).toBeNull()
  })
})
