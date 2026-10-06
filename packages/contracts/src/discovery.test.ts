import { describe, expect, it } from 'vitest'
import {
  locationSchema,
  locationResolveSchema,
  publicSearchSchema,
} from './discovery'
describe('public discovery contracts', () => {
  it('requires coordinates for nearby scope and distance sorting', () => {
    expect(publicSearchSchema.safeParse({ scope: 'nearby' }).success).toBe(
      false,
    )
    expect(publicSearchSchema.safeParse({ sort: 'distance' }).success).toBe(
      false,
    )
    expect(publicSearchSchema.parse({}).sort).toBe('wait')
    expect(
      publicSearchSchema.safeParse({
        scope: 'nearby',
        coordinates: { latitude: 40, longitude: -3 },
      }).success,
    ).toBe(true)
  })
  it('bounds private search inputs, pagination and recent service identities', () => {
    for (const input of [
      { text: 'x'.repeat(201) },
      { pageSize: 101 },
      { page: -1 },
      { recentIds: ['a', 'b', 'c', 'd'] },
      { coordinates: { latitude: 91, longitude: 0 } },
      { token: 'private' },
    ])
      expect(publicSearchSchema.safeParse(input).success).toBe(false)
  })
  it('requires a scoped address resolve and complete Spain location', () => {
    expect(locationResolveSchema.safeParse({ text: 'Madrid' }).success).toBe(
      false,
    )
    expect(
      locationSchema.safeParse({
        formatted: 'Madrid',
        latitude: 40,
        longitude: -3,
      }).success,
    ).toBe(false)
  })
})

import { provisionSchema } from './staff'
it('requires a verified location selection for a new commercial account', () => {
  expect(provisionSchema.shape.locationToken.safeParse(undefined).success).toBe(
    false,
  )
  expect(
    provisionSchema.shape.locationOperationId.safeParse('not-an-operation')
      .success,
  ).toBe(false)
})
