import { describe, expect, it } from 'vitest'
import {
  VENUE_LOGO_MAX_BYTES,
  venueLogoMutationSchema,
  venueLogoStateSchema,
} from './staff'

describe('venue logo contracts', () => {
  it('allows an empty establishment logo and a rasterized SVG result', () => {
    expect(VENUE_LOGO_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(
      venueLogoStateSchema.parse({
        logo: null,
        logoVersion: 0,
        canEditLogo: true,
      }).logo,
    ).toBeNull()
    expect(
      venueLogoStateSchema.parse({
        logo: {
          url: '/api/v1/venue-logos/venue/key.png',
          name: 'logo.png',
          type: 'image/png',
          size: 123,
        },
        logoVersion: 2,
        canEditLogo: false,
      }).logo?.type,
    ).toBe('image/png')
  })
  it('does not expose original SVG files as stored logos', () => {
    expect(
      venueLogoStateSchema.safeParse({
        logo: {
          url: '/logo.svg',
          name: 'logo.svg',
          type: 'image/svg+xml',
          size: 123,
        },
        logoVersion: 1,
        canEditLogo: true,
      }).success,
    ).toBe(false)
  })
  it.each([-1, 1.5, '0', Infinity, Number.MAX_SAFE_INTEGER])(
    'rejects unsafe revision %s',
    (version) => {
      expect(venueLogoMutationSchema.safeParse({ version }).success).toBe(false)
    },
  )
  it('requires a revision and does not accept client authorization or object keys', () => {
    expect(venueLogoMutationSchema.parse({ version: 0 })).toEqual({
      version: 0,
    })
    for (const value of [
      {},
      { version: 0, canEditLogo: true },
      { version: 0, key: 'foreign.png' },
    ])
      expect(venueLogoMutationSchema.safeParse(value).success).toBe(false)
  })
})
