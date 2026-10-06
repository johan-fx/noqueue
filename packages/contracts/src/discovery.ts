import { z } from 'zod'

const text = z.string().trim().min(1).max(300)
export const coordinatesSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict()
export const attributionSchema = z.object({ text, url: z.url().max(500) })
export const locationSchema = coordinatesSchema.extend({
  formatted: text,
  address: z.object({
    street: text,
    houseNumber: z.string().max(30).optional(),
    city: text,
    postcode: z.string().max(20).optional(),
    state: z.string().max(100).optional(),
    countryCode: z.literal('es'),
  }),
  source: z
    .object({
      name: text,
      attribution: text,
      license: text,
      url: z.url().max(500),
    })
    .optional(),
  provider: z.literal('geoapify'),
  providerId: text,
  attribution: z.array(attributionSchema).min(1).max(5),
})
export type VenueLocation = z.infer<typeof locationSchema>
export const locationScopeSchema = z
  .object({
    kind: z.enum(['provision', 'venue']),
    id: z.uuid(),
  })
  .strict()
export type LocationScope = z.infer<typeof locationScopeSchema>
export const locationResolveSchema = z
  .object({
    text: z.string().trim().min(5).max(200),
    scope: locationScopeSchema,
  })
  .strict()
export const locationCandidateSchema = z.object({
  location: locationSchema,
  token: z.string().min(1).max(6000),
  expiresAt: z.number().int().positive(),
})
export type LocationCandidate = z.infer<typeof locationCandidateSchema>
export const locationCandidatesSchema = z.object({
  candidates: z.array(locationCandidateSchema).max(5),
})
export const venueLocationUpdateSchema = z
  .object({
    version: z.number().int().nonnegative(),
    locationToken: z.string().min(1).max(6000),
  })
  .strict()
export type VenueLocationSnapshot = {
  location: VenueLocation | null
  version: number
  confirmedAt: number | null
}
export const publicSearchSchema = z
  .object({
    text: z.string().trim().max(200).default(''),
    type: z.enum(['restaurant', 'reception', 'pool']).optional(),
    scope: z.enum(['global', 'nearby']).default('global'),
    coordinates: coordinatesSchema.optional(),
    sort: z.enum(['wait', 'distance']).default('wait'),
    page: z.number().int().min(1).max(1000).default(1),
    pageSize: z.number().int().min(1).max(100).default(24),
    recentIds: z.array(z.string().min(1).max(100)).max(3).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      (input.scope === 'nearby' || input.sort === 'distance') &&
      !input.coordinates
    )
      ctx.addIssue({
        code: 'custom',
        path: ['coordinates'],
        message: 'Location required',
      })
  })
export type PublicSearchInput = z.infer<typeof publicSearchSchema>
export const publicSearchResultSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  name: z.string(),
  venueName: z.string(),
  type: z.enum(['restaurant', 'reception', 'pool']),
  address: z.string(),
  open: z.boolean(),
  waitMinutes: z.number().int().nonnegative().nullable(),
  distanceMeters: z.number().nonnegative().nullable(),
  attribution: z.array(attributionSchema),
})
export type PublicSearchResult = z.infer<typeof publicSearchResultSchema>
export const publicSearchResponseSchema = z.object({
  items: z.array(publicSearchResultSchema),
  page: z.number().int().positive(),
  hasMore: z.boolean(),
})
