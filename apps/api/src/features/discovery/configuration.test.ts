import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { app } from '../../app'
import { serviceSchema } from '@noqueue/contracts/staff'
import { issueLocationToken, updateVenueLocation } from '../staff/location'
const origin = 'http://localhost:5173'
const valid = {
  name: 'Valid pool',
  type: 'pool',
  capacity: 10,
  averageMinutes: 30,
  graceMinutes: 5,
  cutoffMinutes: 0,
  twentyFourHours: true,
  schedules: [],
  spaces: [],
  receptionServices: [],
}
async function fixture() {
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
      'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
    ).bind(venue, org, prefix),
  ])
  async function insert(config: unknown, id = crypto.randomUUID()) {
    await env.DB.prepare(
      'INSERT INTO queue(id,venue_id,name,capacity,average_minutes,open,config) VALUES (?,?,?,10,30,1,?)',
    )
      .bind(
        id,
        venue,
        prefix,
        typeof config === 'string' ? config : JSON.stringify(config),
      )
      .run()
    return id
  }
  async function confirm() {
    const selected = await issueLocationToken(
      env,
      actor,
      { kind: 'venue', id: venue },
      {
        formatted: 'Calle Mayor 1 Madrid',
        address: { street: 'Calle Mayor', city: 'Madrid', countryCode: 'es' },
        latitude: 40.416,
        longitude: -3.704,
        provider: 'geoapify',
        providerId: 'fixture',
        attribution: [{ text: 'Geoapify', url: 'https://www.geoapify.com/' }],
      },
    )
    await updateVenueLocation(env, actor, org, venue, {
      version: 0,
      locationToken: selected.token,
    })
  }
  return { actor, org, venue, prefix, insert, confirm }
}
async function search(body: Record<string, unknown> = {}) {
  const response = await app.request(
    origin + '/api/v1/public/search',
    {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    },
    env,
  )
  return {
    response,
    body: (await response.json()) as {
      items: { id: string; open: boolean }[]
      hasMore: boolean
    },
  }
}
const invalid = [
  { type: 'restaurant', twentyFourHours: true },
  { ...valid, capacity: -1 },
  {
    ...valid,
    type: 'reception',
    schedules: 'bad',
    receptionServices: ['check_in'],
  },
  {
    ...valid,
    type: 'reception',
    twentyFourHours: false,
    schedules: 'bad',
    receptionServices: ['check_in'],
  },
]
it('HTTP excludes schema-invalid configurations before evaluating schedules or paginating valid services', async () => {
  const f = await fixture(),
    expected: string[] = []
  for (const config of invalid) {
    expect(serviceSchema.safeParse(config).success).toBe(false)
    await f.insert(config)
  }
  for (let i = 0; i < 3; i++)
    expected.push(await f.insert({ ...valid, name: 'Valid ' + i }))
  await f.confirm()
  const first = await search({ text: f.prefix, pageSize: 2 })
  expect(first.response.status).toBe(200)
  expect(first.body.items.map((row) => row.id)).toEqual(
    expected.sort().slice(0, 2),
  )
  expect(first.body.hasMore).toBe(true)
  const last = await search({ text: f.prefix, pageSize: 2, page: 2 })
  expect(last.response.status).toBe(200)
  expect(last.body.items.map((row) => row.id)).toEqual(expected.slice(2))
  expect(last.body.hasMore).toBe(false)
})
it('HTTP revalidation excludes invalid recent IDs rather than publishing incomplete services', async () => {
  const f = await fixture(),
    ids = []
  for (const config of invalid.slice(0, 3)) ids.push(await f.insert(config))
  await f.confirm()
  const result = await search({ recentIds: ids })
  expect(result.response.status).toBe(200)
  expect(result.body.items).toEqual([])
})

import { backfillDirectoryConfigs } from './configuration'
it('source binding fails closed for direct updates, including recents and valid replacement bytes', async () => {
  const f = await fixture(),
    id = await f.insert(valid)
  await f.confirm()
  expect(
    (await search({ recentIds: [id] })).body.items.map((row) => row.id),
  ).toEqual([id])
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify({ ...valid, capacity: 20 }), id)
    .run()
  expect((await search({ recentIds: [id] })).body.items).toEqual([])
  await backfillDirectoryConfigs(env)
  expect(
    (await search({ recentIds: [id] })).body.items.map((row) => row.id),
  ).toEqual([id])
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify(invalid[3]), id)
    .run()
  expect((await search({ text: f.prefix })).response.status).toBe(200)
  expect((await search({ recentIds: [id] })).body.items).toEqual([])
  await backfillDirectoryConfigs(env)
  expect(
    await env.DB.prepare(
      'SELECT normalized_config FROM service_directory_config WHERE queue_id=?',
    )
      .bind(id)
      .first('normalized_config'),
  ).toBeNull()
})
it('stores normalized schema semantics without rewriting source bytes', async () => {
  const f = await fixture()
  const source = {
    ...valid,
    type: 'restaurant',
    spaces: [
      { name: 'Terrace', tables: 2, tableTypes: [{ seats: 4, count: 2 }] },
    ],
    ignored: 'not projected',
  }
  const id = await f.insert(source)
  await f.confirm()
  const row = await env.DB.prepare(
    'SELECT source_config,normalized_config FROM service_directory_config WHERE queue_id=?',
  )
    .bind(id)
    .first<{ source_config: string; normalized_config: string }>()
  expect(row!.source_config).toBe(JSON.stringify(source))
  expect(JSON.parse(row!.normalized_config)).toMatchObject({
    spaces: [{ id: 'legacy-0', tableTypes: [{ averageMinutes: 30 }] }],
  })
  expect(JSON.parse(row!.normalized_config)).not.toHaveProperty('ignored')
  expect((await search({ recentIds: [id] })).body.items[0]).toMatchObject({
    id,
    open: false,
    serviceOpen: true,
    queueState: 'inactive',
    canJoin: false,
  })
})
it('scheduled compatibility backfill is bounded and invalid markers prevent starvation', async () => {
  const f = await fixture()
  await f.confirm()
  const a = await f.insert(invalid[0], 'a-invalid'),
    b = await f.insert('{broken', 'b-invalid'),
    c = await f.insert(valid, 'c-valid')
  expect((await search({ text: f.prefix })).body.items).toEqual([])
  expect(await backfillDirectoryConfigs(env, 2)).toBe(2)
  expect((await search({ recentIds: [a, b, c] })).body.items).toEqual([])
  expect(await backfillDirectoryConfigs(env, 2)).toBe(1)
  expect(
    (await search({ text: f.prefix })).body.items.map((row) => row.id),
  ).toEqual([c])
  expect(await backfillDirectoryConfigs(env, 2)).toBe(0)
  expect(
    await env.DB.prepare(
      'SELECT source_config FROM service_directory_config WHERE queue_id=?',
    )
      .bind(b)
      .first('source_config'),
  ).toBe('{broken')
})
it('location completion and directory backfill roll back together and version conflicts prepare nothing', async () => {
  const f = await fixture(),
    id = await f.insert(valid)
  await env.DB.exec(
    "CREATE TRIGGER reject_directory BEFORE INSERT ON service_directory_config BEGIN SELECT RAISE(ABORT,'fixture snapshot failure'); END",
  )
  await expect(f.confirm()).rejects.toThrow()
  expect(
    await env.DB.prepare('SELECT version FROM venue WHERE id=?')
      .bind(f.venue)
      .first('version'),
  ).toBe(0)
  expect(
    await env.DB.prepare('SELECT count(*) FROM staff_audit WHERE venue_id=?')
      .bind(f.venue)
      .first('count(*)'),
  ).toBe(0)
  expect(
    await env.DB.prepare(
      'SELECT queue_id FROM service_directory_config WHERE queue_id=?',
    )
      .bind(id)
      .first(),
  ).toBeNull()
  await env.DB.exec('DROP TRIGGER reject_directory')
  await f.confirm()
  await env.DB.prepare('DELETE FROM service_directory_config WHERE queue_id=?')
    .bind(id)
    .run()
  await expect(f.confirm()).rejects.toThrow('venue_version_conflict')
  expect(
    await env.DB.prepare(
      'SELECT queue_id FROM service_directory_config WHERE queue_id=?',
    )
      .bind(id)
      .first(),
  ).toBeNull()
})

it('publishes grouped calendars without legacy fields and derives open public admission from full-day ownership', async () => {
  const f = await fixture()
  const { twentyFourHours: _always, schedules: _slots, ...common } = valid
  const day = new Date().getUTCDay(), next = (day + 1) % 7
  const grouped = { ...common, scheduleGroups: [{ days: [day], twentyFourHours: true, ranges: [] }, { days: [next], twentyFourHours: false, ranges: [{ from: '12:00', to: '15:00' }] }] }
  const id = await f.insert(grouped)
  await f.confirm()
  const normalized = JSON.parse((await env.DB.prepare('SELECT normalized_config FROM service_directory_config WHERE queue_id=?').bind(id).first<{ normalized_config: string }>())!.normalized_config)
  expect(normalized.scheduleGroups).toEqual(grouped.scheduleGroups)
  expect(normalized).not.toHaveProperty('schedules')
  expect((await search({ recentIds: [id] })).body.items[0]).toMatchObject({ id, serviceOpen: true, canJoin: true })
})
