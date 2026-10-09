import { sameConfiguration } from './configuration'
import { venueDirectoryStatements } from '../discovery/configuration'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  locationSchema,
  locationScopeSchema,
  type LocationScope,
  type VenueLocation,
  type VenueLocationSnapshot,
} from '@noqueue/contracts/discovery'
import { hash, hmac, secureEqual } from '../queue/crypto'

const payloadSchema = z.object({
  actor: z.string(),
  scope: locationScopeSchema,
  location: locationSchema,
  issuedAt: z.number(),
  expiresAt: z.number(),
})
const domain = 'venue-location:v1:'
const invalid = () =>
  new HTTPException(400, { message: 'location_confirmation_invalid' })
export async function issueLocationToken(
  env: CloudflareBindings,
  actor: string,
  scope: LocationScope,
  location: VenueLocation,
  now = Date.now(),
) {
  const expiresAt = now + 600_000
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      actor,
      scope,
      location: locationSchema.parse(location),
      issuedAt: now,
      expiresAt,
    }),
  )
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  const signature = await hmac(
    await hash(env.BETTER_AUTH_SECRET),
    domain + encoded,
  )
  return { location, token: encoded + '.' + signature, expiresAt }
}
export async function readLocationToken(
  env: CloudflareBindings,
  token: string,
  actor: string,
  scope: LocationScope,
  now = Date.now(),
): Promise<VenueLocation> {
  try {
    const [encoded, signature, extra] = token.split('.')
    if (
      !encoded ||
      !signature ||
      extra ||
      token.length > 6000 ||
      !/^[A-Za-z0-9_-]+$/.test(encoded)
    )
      throw invalid()
    const expected = await hmac(
      await hash(env.BETTER_AUTH_SECRET),
      domain + encoded,
    )
    if (!(await secureEqual(signature, expected))) throw invalid()
    const parsed = payloadSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(
            atob(encoded.replaceAll('-', '+').replaceAll('_', '/')),
            (c) => c.charCodeAt(0),
          ),
        ),
      ),
    )
    if (
      parsed.actor !== actor ||
      parsed.scope.kind !== scope.kind ||
      parsed.scope.id !== scope.id ||
      parsed.expiresAt <= now ||
      parsed.issuedAt > now ||
      parsed.expiresAt - parsed.issuedAt !== 600_000
    )
      throw invalid()
    return parsed.location
  } catch {
    throw invalid()
  }
}
const propertiesSchema = z.object({
  formatted: z.string(),
  lat: z.number(),
  lon: z.number(),
  place_id: z.string(),
  result_type: z.string(),
  datasource: z
    .object({
      sourcename: z.string(),
      attribution: z.string(),
      license: z.string(),
      url: z.url(),
    })
    .optional(),
  street: z.string(),
  city: z.string().optional(),
  town: z.string().optional(),
  village: z.string().optional(),
  country_code: z.literal('es'),
  housenumber: z.string().optional(),
  postcode: z.string().optional(),
  state: z.string().optional(),
})
export async function resolveLocation(
  env: CloudflareBindings,
  actor: string,
  input: { text: string; scope: LocationScope },
  operation: 'search' | 'autocomplete' = 'search',
) {
  if (!env.GEOAPIFY_API_KEY)
    throw new HTTPException(503, { message: 'location_provider_unavailable' })
  const url = new URL(`https://api.geoapify.com/v1/geocode/${operation}`)
  url.searchParams.set('text', input.text)
  url.searchParams.set('filter', 'countrycode:es')
  url.searchParams.set('limit', '5')
  url.searchParams.set('lang', 'es')
  url.searchParams.set('format', 'geojson')
  url.searchParams.set('apiKey', env.GEOAPIFY_API_KEY)
  let data: unknown
  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error('provider_failed')
    data = await response.json()
  } catch {
    throw new HTTPException(503, { message: 'location_provider_unavailable' })
  }
  const features = z
    .object({
      features: z.array(z.object({ properties: z.unknown() })).max(20),
    })
    .safeParse(data)
  if (!features.success)
    throw new HTTPException(503, { message: 'location_provider_unavailable' })
  const candidates = []
  const seen = new Set<string>()
  for (const feature of features.data.features.slice(0, 5)) {
    const parsed = propertiesSchema.safeParse(feature.properties)
    if (!parsed.success) continue
    const p = parsed.data,
      city = p.city ?? p.town ?? p.village
    if (!city || !['building', 'amenity', 'street'].includes(p.result_type))
      continue
    const location = locationSchema.safeParse({
      formatted: p.formatted,
      latitude: p.lat,
      longitude: p.lon,
      address: {
        street: p.street,
        houseNumber: p.housenumber,
        city,
        postcode: p.postcode,
        state: p.state,
        countryCode: 'es',
      },
      source: p.datasource
        ? {
            name: p.datasource.sourcename,
            attribution: p.datasource.attribution,
            license: p.datasource.license,
            url: p.datasource.url,
          }
        : {
            name: 'openstreetmap',
            attribution: '© OpenStreetMap contributors',
            license: 'Open Database License',
            url: 'https://www.openstreetmap.org/copyright',
          },
      provider: 'geoapify',
      providerId: p.place_id,
      attribution: [
        { text: 'Geoapify', url: 'https://www.geoapify.com/' },
        {
          text: p.datasource?.attribution ?? '© OpenStreetMap contributors',
          url: p.datasource?.url ?? 'https://www.openstreetmap.org/copyright',
        },
      ],
    })
    if (location.success && !seen.has(location.data.providerId)) {
      seen.add(location.data.providerId)
      candidates.push(
        await issueLocationToken(env, actor, input.scope, location.data),
      )
    }
  }
  return { candidates }
}
export function locationValues(location: VenueLocation, now = Date.now()) {
  return [
    location.formatted,
    JSON.stringify(location.address),
    location.latitude,
    location.longitude,
    location.provider,
    location.providerId,
    JSON.stringify(location.attribution),
    now,
    location.source ? JSON.stringify(location.source) : null,
  ]
}
export async function readVenueLocation(
  env: CloudflareBindings,
  venueId: string,
): Promise<VenueLocationSnapshot> {
  const row = await env.DB.prepare(
    'SELECT address_formatted,address_json,latitude,longitude,location_provider,location_provider_id,location_attribution,location_confirmed_at,location_source,version FROM venue WHERE id=?',
  )
    .bind(venueId)
    .first<{
      address_formatted: string | null
      address_json: string | null
      latitude: number | null
      longitude: number | null
      location_provider: string | null
      location_provider_id: string | null
      location_attribution: string | null
      location_source: string | null
      location_confirmed_at: number | null
      version: number
    }>()
  if (!row) throw new HTTPException(404, { message: 'not_found' })
  return {
    version: row.version,
    confirmedAt: row.location_confirmed_at,
    location: row.location_confirmed_at
      ? locationSchema.parse({
          formatted: row.address_formatted,
          address: JSON.parse(row.address_json ?? '{}'),
          latitude: row.latitude,
          longitude: row.longitude,
          source: row.location_source
            ? JSON.parse(row.location_source)
            : undefined,
          provider: row.location_provider,
          providerId: row.location_provider_id,
          attribution: JSON.parse(row.location_attribution ?? '[]'),
        })
      : null,
  }
}
export async function updateVenueLocation(
  env: CloudflareBindings,
  actor: string,
  org: string,
  venueId: string,
  input: { version: number; locationToken: string },
) {
  const location = await readLocationToken(env, input.locationToken, actor, {
    kind: 'venue',
    id: venueId,
  })
  const current = await readVenueLocation(env, venueId)
  if (current.version !== input.version)
    throw new HTTPException(409, { message: 'venue_version_conflict' })
  const locationChanged = !sameConfiguration(current.location, location)
  const auditId = crypto.randomUUID()
  const snapshots = await venueDirectoryStatements(env, venueId, auditId)
  // D1 batch is a transaction; changes() refers to the immediately preceding update.
  const result = await env.DB.batch([
    env.DB.prepare(
      'UPDATE venue SET address_formatted=?,address_json=?,latitude=?,longitude=?,location_provider=?,location_provider_id=?,location_attribution=?,location_confirmed_at=?,location_source=?,configuration_updated_at=CASE WHEN ? THEN ? ELSE configuration_updated_at END,version=version+1 WHERE id=? AND version=?',
    ).bind(
      ...locationValues(location),
      Number(locationChanged),
      Date.now(),
      venueId,
      input.version,
    ),
    env.DB.prepare(
      'INSERT INTO staff_audit SELECT ?,?,?,?,?,?,? WHERE changes()=1',
    ).bind(
      auditId,
      actor,
      org,
      venueId,
      'venue.location_updated',
      venueId,
      Date.now(),
    ),
    ...snapshots,
  ])
  if (!result[0]?.meta.changes)
    throw new HTTPException(409, { message: 'venue_version_conflict' })
  return readVenueLocation(env, venueId)
}
