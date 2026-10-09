import { env } from 'cloudflare:workers'
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  issueLocationToken,
  readLocationToken,
  resolveLocation,
  updateVenueLocation,
} from './location'
import type { VenueLocation } from '@noqueue/contracts/discovery'
const location: VenueLocation = {
  formatted: 'Calle Mayor 1, Madrid, España',
  latitude: 40.416,
  longitude: -3.704,
  address: {
    street: 'Calle Mayor',
    houseNumber: '1',
    city: 'Madrid',
    countryCode: 'es',
  },
  provider: 'geoapify',
  providerId: 'test-place',
  attribution: [
    { text: 'Geoapify', url: 'https://www.geoapify.com/' },
    {
      text: '© OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright',
    },
  ],
}
afterEach(() => vi.restoreAllMocks())
describe('verified venue locations', () => {
  it('authenticates actor and scope and expires in ten minutes', async () => {
    const scope = { kind: 'venue' as const, id: crypto.randomUUID() }
    const token = await issueLocationToken(
      env,
      'actor',
      scope,
      location,
      1_000_000,
    )
    expect(
      await readLocationToken(env, token.token, 'actor', scope, 1_000_001),
    ).toEqual(location)
    for (const [value, actor, target, now] of [
      [token.token + 'x', 'actor', scope, 1_000_001],
      [token.token, 'another', scope, 1_000_001],
      [token.token, 'actor', { ...scope, id: crypto.randomUUID() }, 1_000_001],
      [token.token, 'actor', scope, token.expiresAt],
    ] as const)
      await expect(
        readLocationToken(env, value, actor, target, now),
      ).rejects.toMatchObject({ message: 'location_confirmation_invalid' })
  })
  it('filters city/postcode-only, foreign and malformed provider results', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        features: [
          {
            properties: {
              formatted: 'Madrid',
              city: 'Madrid',
              country_code: 'es',
              lat: 40,
              lon: -3,
              result_type: 'city',
            },
          },
          {
            properties: {
              formatted: 'Paris',
              street: 'Rue',
              city: 'Paris',
              country_code: 'fr',
              lat: 48,
              lon: 2,
              place_id: 'foreign',
              result_type: 'building',
            },
          },
          {
            properties: {
              formatted: location.formatted,
              street: 'Calle Mayor',
              housenumber: '1',
              city: 'Madrid',
              country_code: 'es',
              lat: 40.416,
              lon: -3.704,
              place_id: 'test-place',
              result_type: 'building',
            },
          },
        ],
      }),
    )
    const result = await resolveLocation(
      { ...env, GEOAPIFY_API_KEY: 'fake' },
      'actor',
      {
        text: 'Calle Mayor 1 Madrid',
        scope: { kind: 'provision', id: crypto.randomUUID() },
      },
    )
    expect(result.candidates).toHaveLength(1)
    const url = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(url.searchParams.get('filter')).toBe('countrycode:es')
    expect(url.searchParams.get('apiKey')).toBe('fake')
  })
  it('reports provider failures without accepting a draft', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 503 }),
    )
    await expect(
      resolveLocation({ ...env, GEOAPIFY_API_KEY: 'fake' }, 'actor', {
        text: 'Calle Mayor 1 Madrid',
        scope: { kind: 'provision', id: crypto.randomUUID() },
      }),
    ).rejects.toMatchObject({ message: 'location_provider_unavailable' })
  })
  it('updates and audits atomically, rejects stale versions without a second audit', async () => {
    const actor = crypto.randomUUID(),
      org = crypto.randomUUID(),
      venue = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)',
      ).bind(actor, 'Actor', actor + '@test.invalid', 'now', 'now'),
      env.DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(
        org,
        'Location Test',
      ),
      env.DB.prepare(
        'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
      ).bind(venue, org, 'Test Venue'),
    ])
    const token = await issueLocationToken(
      env,
      actor,
      { kind: 'venue', id: venue },
      location,
    )
    const snapshot = await updateVenueLocation(env, actor, org, venue, {
      version: 0,
      locationToken: token.token,
    })
    expect(snapshot.version).toBe(1)
    const stamp = await env.DB.prepare(
      'SELECT configuration_updated_at FROM venue WHERE id=?',
    )
      .bind(venue)
      .first('configuration_updated_at')
    expect(stamp).toEqual(expect.any(Number))
    const noOp = await updateVenueLocation(env, actor, org, venue, {
      version: 1,
      locationToken: token.token,
    })
    expect(noOp.version).toBe(2)
    expect(
      await env.DB.prepare(
        'SELECT configuration_updated_at FROM venue WHERE id=?',
      )
        .bind(venue)
        .first('configuration_updated_at'),
    ).toBe(stamp)
    await expect(
      updateVenueLocation(env, actor, org, venue, {
        version: 0,
        locationToken: token.token,
      }),
    ).rejects.toMatchObject({ message: 'venue_version_conflict' })
    expect(
      await env.DB.prepare(
        'SELECT count(*) n FROM staff_audit WHERE venue_id=?',
      )
        .bind(venue)
        .first('n'),
    ).toBe(2)
    expect(
      await env.DB.prepare('SELECT address_formatted FROM venue WHERE id=?')
        .bind(venue)
        .first('address_formatted'),
    ).toBe(location.formatted)
  })
})

it('rolls back location fields when the audit insert fails', async () => {
  const org = crypto.randomUUID(),
    venue = crypto.randomUUID(),
    actor = 'missing-actor'
  await env.DB.batch([
    env.DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(
      org,
      'Atomic location',
    ),
    env.DB.prepare(
      'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
    ).bind(venue, org, 'Atomic venue'),
  ])
  const token = await issueLocationToken(
    env,
    actor,
    { kind: 'venue', id: venue },
    location,
  )
  await expect(
    updateVenueLocation(env, actor, org, venue, {
      version: 0,
      locationToken: token.token,
    }),
  ).rejects.toThrow()
  expect(
    await env.DB.prepare('SELECT version FROM venue WHERE id=?')
      .bind(venue)
      .first('version'),
  ).toBe(0)
  expect(
    await env.DB.prepare('SELECT address_formatted FROM venue WHERE id=?')
      .bind(venue)
      .first('address_formatted'),
  ).toBeNull()
})

it('leaves historical configuration unknown and rolls back the timestamp with location audit failures', async () => {
  const org = crypto.randomUUID(),
    venue = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(
      org,
      'Legacy',
    ),
    env.DB.prepare(
      'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
    ).bind(venue, org, 'Legacy'),
  ])
  const stamp = () =>
    env.DB.prepare('SELECT configuration_updated_at FROM venue WHERE id=?')
      .bind(venue)
      .first('configuration_updated_at')
  expect(await stamp()).toBeNull()
  const token = await issueLocationToken(
    env,
    'absent',
    { kind: 'venue', id: venue },
    location,
  )
  await expect(
    updateVenueLocation(env, 'absent', org, venue, {
      version: 0,
      locationToken: token.token,
    }),
  ).rejects.toThrow()
  expect(await stamp()).toBeNull()
})
