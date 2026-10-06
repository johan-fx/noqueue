import { directoryConfigStatement } from './configuration'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { searchServices } from './search'
import { publicSearchSchema } from '@noqueue/contracts/discovery'
const now = Date.now()
async function fixture(latitude = 40.416, longitude = -3.704, complete = true) {
  const actor = crypto.randomUUID(),
    org = crypto.randomUUID(),
    venue = crypto.randomUUID(),
    prefix = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)',
    ).bind(actor, 'Actor', actor + '@test.invalid', 'now', 'now'),
    env.DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(
      org,
      prefix,
    ),
    env.DB.prepare(
      'INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)',
    ).bind(org, actor),
    env.DB.prepare(
      'INSERT INTO venue(id,organization_id,name,address_formatted,address_json,latitude,longitude,location_provider,location_provider_id,location_attribution,location_confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(
      venue,
      org,
      `Hotel ${prefix}`,
      complete ? 'Calle Málaga 1' : null,
      '{}',
      latitude,
      longitude,
      'geoapify',
      'fixture',
      '[{"text":"Geoapify","url":"https://www.geoapify.com/"}]',
      complete ? now : null,
    ),
  ])
  async function service(
    name: string,
    wait: number | null = null,
    open = true,
    stale = false,
    type = 'restaurant',
  ) {
    const id = crypto.randomUUID(),
      entry = crypto.randomUUID()
    const source = JSON.stringify({
      name: `${prefix} ${name}`,
      type,
      capacity: 10,
      averageMinutes: 30,
      graceMinutes: 5,
      twentyFourHours: true,
      cutoffMinutes: 0,
      schedules: [],
      spaces: type === 'restaurant' ? [{ name: 'Interior', tables: 1 }] : [],
      receptionServices: type === 'reception' ? ['check_in'] : [],
    })
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO queue(id,venue_id,name,capacity,average_minutes,open,config) VALUES (?,?,?,10,30,?,?)',
      ).bind(id, venue, `${prefix} ${name}`, open ? 1 : 0, source),
      directoryConfigStatement(env, id, source),
    ])
    if (wait !== null)
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,?,1,'es',?,1)",
        ).bind(
          entry,
          id,
          crypto.randomUUID(),
          'hash',
          crypto.randomUUID(),
          entry,
          now,
        ),
        env.DB.prepare(
          'INSERT INTO queue_projection(entry_id,position,eta_minutes,predicted_at,quality,updated_at) VALUES (?,1,99,?,?,?)',
        ).bind(
          entry,
          now + wait * 60000,
          'estimated',
          stale ? now - 121000 : now,
        ),
      ])
    return id
  }
  return { actor, org, venue, prefix, service }
}
const search = (input: unknown) =>
  searchServices(env, publicSearchSchema.parse(input), now)
describe('D1 service discovery', () => {
  it('returns individual services with shared address, respects FTS accents and transactional updates', async () => {
    const f = await fixture(),
      a = await f.service('Recepción', 10, true, false, 'reception'),
      b = await f.service('Restaurante', 20)
    const result = await search({ text: f.prefix })
    expect(result.items.map((i) => i.id)).toEqual([a, b])
    expect(
      result.items.every(
        (i) => i.address === 'Calle Málaga 1' && i.distanceMeters === null,
      ),
    ).toBe(true)
    expect(
      (await search({ text: `${f.prefix} recepcion` })).items.map((i) => i.id),
    ).toEqual([a])
    await env.DB.prepare('UPDATE queue SET name=? WHERE id=?')
      .bind(`${f.prefix} Terraza`, b)
      .run()
    expect(
      (await search({ text: `${f.prefix} restaurante` })).items,
    ).toHaveLength(0)
    expect((await search({ text: `${f.prefix} terraza` })).items).toHaveLength(
      1,
    )
    await env.DB.prepare('UPDATE venue SET address_formatted=? WHERE id=?')
      .bind('Calle Ávila 8', f.venue)
      .run()
    expect((await search({ text: `${f.prefix} avila` })).items).toHaveLength(2)
    expect((await search({ text: '" OR * : ( )' })).items).toHaveLength(0)
  })
  it('excludes incomplete, suspended and unconfigured records but preserves closed services', async () => {
    const f = await fixture(),
      id = await f.service('Closed', 10, false)
    expect((await search({ recentIds: [id] })).items[0]?.open).toBe(false)
    await env.DB.prepare(
      "UPDATE tenant_account SET status='suspended' WHERE organization_id=?",
    )
      .bind(f.org)
      .run()
    expect((await search({ recentIds: [id] })).items).toHaveLength(0)
    const legacy = await fixture(40, -3, false),
      legacyId = await legacy.service('Legacy')
    expect((await search({ recentIds: [legacyId] })).items).toHaveLength(0)
    await env.DB.prepare('UPDATE queue SET config=NULL WHERE id=?')
      .bind(id)
      .run()
    expect((await search({ recentIds: [id] })).items).toHaveLength(0)
  })
  it('uses remaining fresh predictions rather than configured duration, keeps stale and empty waits unknown', async () => {
    const f = await fixture(),
      closed = await f.service('Closed', 1, false),
      stale = await f.service('Stale', 1, true, true),
      empty = await f.service('Empty'),
      known = await f.service('Known', 7)
    const result = await search({ text: f.prefix })
    expect(result.items[0]).toMatchObject({ id: known, waitMinutes: 7 })
    expect(
      result.items
        .slice(1, 3)
        .map((i) => i.id)
        .sort(),
    ).toEqual([stale, empty].sort())
    expect(result.items.slice(1, 3).every((i) => i.waitMinutes === null)).toBe(
      true,
    )
    expect(result.items[3]).toMatchObject({
      id: closed,
      open: false,
      waitMinutes: null,
    })
  })
  it('computes exact Haversine including coincident points before radius filtering and pagination', async () => {
    const far = await fixture(40.5, -3.704),
      outside = await far.service('Far', null, true, false, 'pool')
    const middle = await fixture(40.44, -3.704),
      mid = await middle.service('Mid', null, true, false, 'pool')
    const close = await fixture(),
      first = await close.service('First', null, true, false, 'pool'),
      second = await close.service('Second', null, true, false, 'pool')
    const coordinates = { latitude: 40.416, longitude: -3.704 }
    const a = await search({
      scope: 'nearby',
      coordinates,
      sort: 'distance',
      type: 'pool',
      pageSize: 2,
    })
    expect(a.items.map((i) => i.id)).toEqual([first, second].sort())
    expect(a.items.every((i) => i.distanceMeters === 0)).toBe(true)
    expect(a.hasMore).toBe(true)
    expect(
      (
        await search({
          scope: 'nearby',
          coordinates,
          sort: 'distance',
          type: 'pool',
          page: 2,
          pageSize: 2,
        })
      ).items.map((i) => i.id),
    ).toEqual([mid])
    expect(
      (await search({ recentIds: [outside], scope: 'nearby', coordinates }))
        .items,
    ).toHaveLength(0)
    expect(
      (
        await search({ text: far.prefix, scope: 'nearby', coordinates })
      ).items.map((i) => i.id),
    ).toEqual([outside])
  })
  it('supports island coordinates and the exact 5km boundary, filters type and preserves recent identity order', async () => {
    for (const coordinates of [
      { latitude: 39.57, longitude: 2.65 },
      { latitude: 28.46, longitude: -16.25 },
    ]) {
      const f = await fixture(coordinates.latitude, coordinates.longitude),
        id = await f.service('Island', null, true, false, 'pool')
      expect(
        (
          await search({
            scope: 'nearby',
            coordinates,
            sort: 'distance',
            type: 'pool',
          })
        ).items.some((i) => i.id === id),
      ).toBe(true)
      expect(
        (await search({ recentIds: [id], coordinates })).items[0]
          ?.distanceMeters,
      ).toBe(0)
    }
    const f = await fixture(),
      a = await f.service('A', 10),
      b = await f.service('B', 1)
    expect(
      (await search({ recentIds: [a, b] })).items.map((i) => i.id),
    ).toEqual([a, b])
    expect((await search({ text: f.prefix, type: 'pool' })).items).toHaveLength(
      0,
    )
  })
})

import { app } from '../../app'
it('bounds anonymous request origin and rate, sends no-cache headers and no internal metadata', async () => {
  const origin = 'http://localhost:5173',
    ip = crypto.randomUUID()
  const send = (headers: Record<string, string>, body: unknown = {}) =>
    app.request(
      origin + '/api/v1/public/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': ip,
          ...headers,
        },
        body: JSON.stringify(body),
      },
      env,
    )
  expect((await send({ Origin: 'https://other.invalid' })).status).toBe(403)
  expect(
    (
      await send(
        { Origin: origin },
        { coordinates: { latitude: 91, longitude: 0 } },
      )
    ).status,
  ).toBe(400)
  const oversized = await send({ Origin: origin }, { text: 'x'.repeat(3000) })
  expect(oversized.status).toBe(413)
  expect(oversized.headers.get('Cache-Control')).toBe('no-store')
  const response = await send({ Origin: origin })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  const result = (await response.json()) as { items: Record<string, unknown>[] }
  for (const row of result.items)
    expect(Object.keys(row).sort()).toEqual(
      [
        'address',
        'attribution',
        'distanceMeters',
        'id',
        'name',
        'open',
        'type',
        'venueId',
        'venueName',
        'waitMinutes',
      ].sort(),
    )
  for (let i = 0; i < 59; i++)
    expect((await send({ Origin: origin })).status).toBe(200)
  expect((await send({ Origin: origin })).status).toBe(429)
  expect(
    await env.DB.prepare('SELECT key FROM staff_rate WHERE key LIKE ?')
      .bind('%' + ip + '%')
      .first(),
  ).toBeNull()
})
it('does not silently expand the exact 5km radius', async () => {
  const coordinates = { latitude: 37, longitude: -5 }
  const delta = ((5000 / 6371000) * 180) / Math.PI
  const inside = await fixture(37 + delta - 0.000001, -5),
    a = await inside.service('Inside')
  const outside = await fixture(37 + delta + 0.000001, -5),
    b = await outside.service('Outside')
  const result = await search({
    scope: 'nearby',
    coordinates,
    sort: 'distance',
  })
  expect(result.items.some((i) => i.id === a)).toBe(true)
  expect(result.items.some((i) => i.id === b)).toBe(false)
})
