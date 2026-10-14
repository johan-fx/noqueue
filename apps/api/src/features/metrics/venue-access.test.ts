import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'
import type { MetricsResponse } from '@noqueue/contracts/metrics'
import type { StaffRole } from '@noqueue/contracts/staff'
import { readVenueMetrics } from './read'
import { app } from '../../app'
import { createAuth } from '../../auth/server'
import { credentialStatements, membershipStatements } from '../../auth/credentials'

const enabled = { ...env, METRICS_DASHBOARD_ENABLED: 'true' }
const origin = 'http://localhost:5173'
const day = 86400000
const date = new Date(Date.now() - 2 * day).toISOString().slice(0, 10)
const start = Date.parse(`${date}T00:00:00Z`)
const query = `from=${date}&to=${date}`
let user: string, cookie: string, org: string, venue: string, sibling: string, foreign: string

function request(path: string, bindings = enabled, auth = cookie) {
  return app.request(`${origin}/api/v1/staff${path}`, {
    headers: { Cookie: auth, Origin: origin },
  }, bindings)
}
async function setRole(role: StaffRole) {
  await env.DB.prepare('UPDATE venue_membership SET role=? WHERE user_id=? AND venue_id=?')
    .bind(role, user, venue).run()
}
async function seedVenue(organization: string, name: string, generated: number, hour: number) {
  const id = crypto.randomUUID(), queue = crypto.randomUUID(), dimension = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare("INSERT INTO venue(id,organization_id,name,timezone) VALUES(?,?,?,'UTC')").bind(id, organization, name),
    env.DB.prepare("INSERT INTO queue(id,venue_id,name,capacity,average_minutes,config) VALUES(?,?,'Service',10,10,?)")
      .bind(queue, id, JSON.stringify({ type: 'restaurant' })),
    env.DB.prepare("INSERT INTO metrics_queue(dimension,queue_id,venue_id,organization_id,service_type,timezone,people,integrated_at,coverage_since) VALUES(?,?,?,?,'restaurant','UTC',0,?,?)")
      .bind(dimension, queue, id, organization, start + day, start - day),
    env.DB.prepare("INSERT INTO metrics_daily(dimension,queue_id,venue_id,organization_id,service_type,timezone,date,generated,completed,wait_sum_ms,wait_samples,observed_ms,first_wait_at,last_wait_at) VALUES(?,?,?,?,'restaurant','UTC',?,?,?,?,?,?,?,?)")
      .bind(dimension, queue, id, organization, date, generated, generated, generated * 60000, generated, day, start + hour * 3600000, start + (hour + 1) * 3600000),
    env.DB.prepare("INSERT INTO metrics_hourly(dimension,queue_id,venue_id,organization_id,service_type,timezone,date,hour,bucket_at,bucket_end,generated,wait_sum_ms,wait_samples,people_ms,observed_ms) VALUES(?,?,?,?,'restaurant','UTC',?,?,?,?,?,?,?,?,?)")
      .bind(dimension, queue, id, organization, date, hour, start + hour * 3600000, start + (hour + 1) * 3600000, generated, generated * 60000, generated, 3600000, 3600000),
    env.DB.prepare('INSERT INTO metrics_backfill(queue_id,started_at,completed_at) VALUES(?,?,?)').bind(queue, start - day, start - day),
  ])
  return id
}
beforeEach(async () => {
  user = crypto.randomUUID()
  org = crypto.randomUUID()
  const otherOrg = crypto.randomUUID(), username = `u${user.replaceAll('-', '').slice(0, 20)}`
  const password = 'metrics-test-password-12345'
  await env.DB.batch(await credentialStatements(env, user, 'Owner', username, password))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rateLimit'),
    env.DB.prepare('DELETE FROM metrics_capture_gap'),
    env.DB.prepare('INSERT INTO organization(id,name,slug) VALUES(?,?,?)').bind(org, 'Own org', org),
    env.DB.prepare('INSERT INTO organization(id,name,slug) VALUES(?,?,?)').bind(otherOrg, 'Foreign org', otherOrg),
    // Being the creator must not give a normal member portfolio-wide access.
    env.DB.prepare('INSERT INTO tenant_account(organization_id,created_by) VALUES(?,?)').bind(org, user),
    env.DB.prepare('INSERT INTO tenant_account(organization_id,created_by) VALUES(?,?)').bind(otherOrg, user),
    env.DB.prepare('UPDATE metrics_control SET target_at=NULL,last_complete_at=?').bind(Date.now()),
  ])
  venue = await seedVenue(org, 'Own venue', 3, 10)
  sibling = await seedVenue(org, 'Unassigned sibling', 900, 18)
  foreign = await seedVenue(otherOrg, 'Foreign venue', 7000, 20)
  await env.DB.batch(membershipStatements(env, user, org, venue, 'owner'))
  const login = await createAuth(enabled).api.signInUsername({ body: { username, password }, asResponse: true })
  expect(login.status).toBe(200)
  cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
})

it.each(['owner', 'venue_manager'] as const)('%s reads only its venue across summary, trends, hourly patterns and service breakdown', async (role) => {
  await setRole(role)
  // A sibling's unfinished import must not make this venue's coverage partial.
  await env.DB.prepare('DELETE FROM metrics_backfill WHERE queue_id IN (SELECT id FROM queue WHERE venue_id=?)').bind(sibling).run()
  const response = await request(`/venues/${venue}/metrics?${query}`)
  expect(response.status, await response.clone().text()).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const data = await response.json() as MetricsResponse
  expect(data.summary).toMatchObject({ generated: 3, completed: 3, activeVenues: 1, activeServices: 1, meanWaitMs: 60000 })
  expect(data.executive.completed.value).toBe(3)
  expect(data.trend).toEqual([{ date, generated: 3, completed: 3 }])
  expect(data.patterns.overall.peakHour).toBe(10)
  expect(data.services.map(({ serviceType, generated }) => ({ serviceType, generated }))).toEqual([
    { serviceType: 'reception', generated: 0 },
    { serviceType: 'restaurant', generated: 3 },
    { serviceType: 'pool', generated: 0 },
  ])
  expect(data.venues.items.map((v) => v.venueId)).toEqual([venue])
  expect(data.coverage.status).toBe('complete')
  expect(data.period.timezone).toBe('UTC')
  expect(JSON.stringify(data)).not.toMatch(/Unassigned sibling|Foreign venue/)
  const me = await (await request('/me')).json() as { features: { metrics: boolean }; venues: { id: string; timezone: string; canReadMetrics: boolean }[] }
  expect(me.features.metrics).toBe(true)
  expect(me.venues).toEqual([expect.objectContaining({ id: venue, timezone: 'UTC', canReadMetrics: true })])
})

it.each(['viewer', 'queue_staff'] as const)('denies %s even with a valid membership and assigned queue', async (role) => {
  await setRole(role)
  if (role === 'queue_staff') {
    await env.DB.prepare('INSERT INTO staff_queue_assignment(user_id,venue_id,queue_id) SELECT ?,?,id FROM queue WHERE venue_id=?').bind(user, venue, venue).run()
  }
  expect((await request(`/venues/${venue}/metrics?${query}`)).status).toBe(403)
  const me = await (await request('/me')).json() as { features: { metrics: boolean }; venues: { canReadMetrics: boolean }[] }
  expect(me.features.metrics).toBe(false)
  expect(me.venues[0]!.canReadMetrics).toBe(false)
})

it('rejects other venues in the same organization and other tenants', async () => {
  for (const id of [sibling, foreign, 'missing'])
    expect((await request(`/venues/${id}/metrics?${query}`)).status).toBe(404)
  expect((await request(`/commercial/metrics?${query}`)).status).toBe(403)
  expect((await request('/commercial/metrics/venues')).status).toBe(403)
})

it('does not accept query scope overrides, pagination or invalid ranges', async () => {
  for (const suffix of [`&venueId=${foreign}`, '&venueId=', '&page=2', '&organizationId=demo-org', '&serviceType=invalid'])
    expect((await request(`/venues/${venue}/metrics?${query}${suffix}`)).status).toBe(400)
  expect((await request(`/venues/${venue}/metrics?from=${date}&to=2000-01-01`)).status).toBe(400)
  expect((await request(`/venues/${venue}/metrics?${query}&serviceType=pool`)).status).toBe(200)
})

it('enforces each venue role separately for a multi-venue member', async () => {
  await env.DB.prepare("INSERT INTO venue_membership(user_id,venue_id,role) VALUES(?,?,'viewer')").bind(user, sibling).run()
  expect((await request(`/venues/${venue}/metrics?${query}`)).status).toBe(200)
  expect((await request(`/venues/${sibling}/metrics?${query}`)).status).toBe(403)
  await env.DB.prepare("UPDATE venue_membership SET role='venue_manager' WHERE user_id=? AND venue_id=?").bind(user, sibling).run()
  const result = await (await request(`/venues/${sibling}/metrics?${query}`)).json() as MetricsResponse
  expect(result.summary.generated).toBe(900)
  expect(result.venues.items.map((v) => v.venueId)).toEqual([sibling])
})

it.each(['inactive', 'removed-org-membership', 'suspended', 'demoted', 'banned'] as const)('revalidates %s access with an existing session', async (change) => {
  expect((await request(`/venues/${venue}/metrics?${query}`)).status).toBe(200)
  if (change === 'inactive') await env.DB.prepare('UPDATE venue_membership SET active=0 WHERE user_id=?').bind(user).run()
  if (change === 'removed-org-membership') await env.DB.prepare('DELETE FROM member WHERE userId=?').bind(user).run()
  if (change === 'suspended') await env.DB.prepare("UPDATE tenant_account SET status='suspended' WHERE organization_id=?").bind(org).run()
  if (change === 'demoted') await setRole('viewer')
  if (change === 'banned') await env.DB.prepare('UPDATE user SET banned=1 WHERE id=?').bind(user).run()
  const result = await request(`/venues/${venue}/metrics?${query}`)
  expect([401, 403, 404]).toContain(result.status)
})

it('hides metrics when disabled and requires authentication', async () => {
  const disabled = { ...enabled, METRICS_DASHBOARD_ENABLED: 'false' }
  expect((await request(`/venues/${venue}/metrics?${query}`, disabled)).status).toBe(404)
  const me = await (await request('/me', disabled)).json() as { features: { metrics: boolean }; venues: { canReadMetrics: boolean }[] }
  expect(me.features.metrics).toBe(false)
  expect(me.venues[0]!.canReadMetrics).toBe(false)
  expect((await request(`/venues/${venue}/metrics?${query}`, enabled, '')).status).toBe(401)
})


it('rechecks membership in the rollup transaction after authorization has already succeeded', async () => {
  let intercepted = false
  const DB = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
        intercepted = true
        await env.DB.prepare("UPDATE venue_membership SET role='viewer' WHERE user_id=? AND venue_id=?").bind(user, venue).run()
        return target.batch(statements)
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const data = await readVenueMetrics({ ...enabled, DB }, { id: user, role: 'user' }, venue, { from: date, to: date })
  expect(intercepted).toBe(true)
  expect(data.summary.generated).toBe(0)
  expect(data.venues.items).toEqual([])
  expect(data.coverage.status).toBe('unavailable')
})

it('preserves commercial/admin portfolio access without granting unassigned member-endpoint access', async () => {
  for (const role of ['commercial_operator', 'platform_admin']) {
    await env.DB.prepare('UPDATE user SET role=? WHERE id=?').bind(role, user).run()
    const response = await request(`/commercial/metrics?${query}&venueId=${foreign}`)
    expect(response.status).toBe(200)
    const data = await response.json() as MetricsResponse
    expect(data.summary.generated).toBe(7000)
    expect(data.venues.items.map((v) => v.venueId)).toEqual([foreign])
    expect((await request(`/venues/${foreign}/metrics?${query}`)).status).toBe(404)
  }
})

it('keeps another commercial portfolio out of unfiltered aggregates and the catalog while admin can read it', async () => {
  const otherSales = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES(?,'Other sales',?,datetime('now'),datetime('now'),'commercial_operator')")
    .bind(otherSales, `${otherSales}@test.invalid`).run()
  await env.DB.prepare('UPDATE tenant_account SET created_by=? WHERE organization_id=(SELECT organization_id FROM venue WHERE id=?)')
    .bind(otherSales, foreign).run()
  await env.DB.prepare("UPDATE user SET role='commercial_operator' WHERE id=?").bind(user).run()
  const commercial = await (await request(`/commercial/metrics?${query}`)).json() as MetricsResponse
  expect(commercial.summary.generated).toBe(903)
  expect(commercial.venues.items.map((v) => v.venueId).sort()).toEqual([venue, sibling].sort())
  const catalog = await (await request('/commercial/metrics/venues')).json() as { items: { id: string }[] }
  expect(catalog.items.map((v) => v.id).sort()).toEqual([venue, sibling].sort())
  expect((await request(`/commercial/metrics?${query}&venueId=${foreign}`)).status).toBe(404)
  await env.DB.prepare("UPDATE user SET role='platform_admin' WHERE id=?").bind(user).run()
  const admin = await (await request(`/commercial/metrics?${query}&venueId=${foreign}`)).json() as MetricsResponse
  expect(admin.summary.generated).toBe(7000)
  const adminCatalog = await (await request('/commercial/metrics/venues')).json() as { items: { id: string }[] }
  expect(adminCatalog.items.map((v) => v.id)).toContain(foreign)
})

it('member access is independent of portfolio reassignment and filters cannot bring back another venue', async () => {
  const otherSales = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES(?,'Other sales',?,datetime('now'),datetime('now'),'commercial_operator')")
    .bind(otherSales, `${otherSales}@test.invalid`).run()
  await env.DB.prepare('UPDATE tenant_account SET created_by=? WHERE organization_id=?').bind(otherSales, org).run()
  const result = await request(`/venues/${venue}/metrics?${query}&serviceType=restaurant`)
  expect(result.status).toBe(200)
  const data = await result.json() as MetricsResponse
  expect(data.summary.generated).toBe(3)
  expect(data.venues.items.map((v) => v.venueId)).toEqual([venue])
  const empty = await (await request(`/venues/${venue}/metrics?${query}&serviceType=pool`)).json() as MetricsResponse
  expect(empty.summary.generated).toBe(0)
  expect(empty.venues.items).toEqual([])
})
