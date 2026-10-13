import { expect, it } from 'vitest'
import { publicServiceSchema } from './queue'

const service = { id: 'q', name: 'Restaurant', venueName: 'Hotel', open: 1, type: 'restaurant', receptionServices: [], spaces: [] }
it('keeps the public logo URL without requiring staff metadata', () => {
  for (const venueLogoUrl of [null, '/api/v1/venue-logos/v/logo.png', 'https://assets.example.com/v/logo.png']) {
    expect(publicServiceSchema.parse({ ...service, venueLogoUrl })).toMatchObject({ venueLogoUrl })
  }
  expect(publicServiceSchema.safeParse(service).success).toBe(true)
  expect(publicServiceSchema.safeParse({ ...service, venueLogoUrl: {} }).success).toBe(false)
})
