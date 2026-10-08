import { expect, type APIRequestContext, type Page } from '../fixtures.js'
import { resolveFixtureLocation } from '../helpers/location.js'
import { pilot } from '../helpers/queue-actions.js'
type QueueSummary = { id: string; open: number; config: { approachTurns: number; approachMinutes: number } }
export type QueueOpeningContext = { contextToken: string; queueState: string; canJoin: boolean; groups: { spaceId: string; seats: number; occupied: number; allocated: number; count: number }[] }
export type ServiceType = 'restaurant' | 'reception' | 'pool'
export type ChapterId = 'main' | 'alternatives' | 'expiration'
export const serviceNames = { restaurant: 'Restaurante Miramar', reception: 'Recepción Miramar', pool: 'Bar Piscina Miramar' }

/** Every chapter provisions a fresh organization in the isolated local worker. */
export async function fixture(page: Page, request: APIRequestContext, origin: string, type: ServiceType, chapter: ChapterId) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
  const owner = `owner_${suffix}`, password = 'demo-fictional-password-long'
  const headers = { Origin: origin }
  const sales = `sales_${suffix}`
  expect((await request.post('/api/v1/experiments/local/staff/identity', { headers: pilot, data: { username: sales, password } })).ok()).toBeTruthy()
  expect((await request.post('/api/v1/auth/sign-in/username', { headers, data: { username: sales, password } })).ok()).toBeTruthy()
  const venueName = `Hotel Miramar ${suffix.slice(0, 4)}`
  const spaces = type === 'restaurant' ? [{ id: 'terrace', name: 'Terraza', tables: 1, tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }] }, ...(chapter === 'alternatives' ? [{ id: 'interior', name: 'Interior', tables: 1, tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }] }] : [])] : []
  const graceMinutes = chapter === 'expiration' ? 1 : type === 'restaurant' ? 5 : 2
  const created = await request.post('/api/v1/staff/commercial/organizations', {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: { ...(await resolveFixtureLocation(request, origin)), organizationName: 'Local video demonstration', slug: `demo-${suffix}`, venueName, timezone: 'Europe/Madrid', ownerName: 'Demo Owner', ownerUsername: owner, ownerPassword: password,
      services: [{ name: serviceNames[type], type, capacity: 99, stations: 1, averageMinutes: 30, graceMinutes, cutoffMinutes: 0, twentyFourHours: true, schedules: [], receptionServices: type === 'reception' ? ['check_in', 'check_out', 'other'] : [], spaces }],
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { venueId } = await created.json() as { venueId: string }
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: venueName, exact: true })).toBeVisible()
  const [queue] = await (await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)).json() as QueueSummary[]
  expect(queue!.config.approachTurns ?? 2).toBe(2)
  expect(queue!.config.approachMinutes ?? 10).toBe(10)
  if (type === 'restaurant') {
    const context = await (await page.request.get(`/api/v1/staff/queues/${queue!.id}/opening-context`)).json() as QueueOpeningContext
    expect((await page.request.post(`/api/v1/staff/queues/${queue!.id}/lifecycle`, { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: { action: 'declare_full', contextToken: context.contextToken } })).ok()).toBeTruthy()
    for (const group of context.groups) {
      const current = await (await page.request.get(`/api/v1/staff/queues/${queue!.id}/opening-context`)).json() as QueueOpeningContext
      expect((await page.request.post(`/api/v1/staff/queues/${queue!.id}/lifecycle`, { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: { action: 'occupancy', contextToken: current.contextToken, group: { spaceId: group.spaceId, seats: group.seats, occupied: chapter === 'alternatives' && group.spaceId === 'interior' ? 1 : 0 }, reason: 'Synthetic local video fixture' } })).ok()).toBeTruthy()
    }
  } else {
    // Align the legacy header through the real lifecycle, before seeding or capture.
    for (const action of ['pause', 'resume']) {
      const current = await (await page.request.get(`/api/v1/staff/queues/${queue!.id}/opening-context`)).json() as QueueOpeningContext
      const response = await page.request.post(`/api/v1/staff/queues/${queue!.id}/lifecycle`, {
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        data: { action, contextToken: current.contextToken },
      })
      expect(response.status()).toBe(200)
    }
  }
  const effective = await (await page.request.get(`/api/v1/staff/queues/${queue!.id}/opening-context`)).json() as QueueOpeningContext
  expect(effective.queueState).toBe('active')
  expect(effective.canJoin).toBe(true)
  const [currentQueue] = await (await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)).json() as QueueSummary[]
  expect(currentQueue!.open).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Gestionar lista', exact: true }).getByText('Abierto', { exact: true })).toBeVisible()
  return { queue: queue!.id, venueId, venueName, headers, graceMinutes }
}

export async function supportEntry(request: APIRequestContext, origin: string, queue: string, type: ServiceType, name: string, preferredSpaceId = 'terrace') {
  const response = await request.post(`/api/v1/public/services/${queue}/entries`, {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { displayName: name, partySize: type === 'restaurant' ? 2 : 1, ...(type === 'restaurant' ? { preferredSpaceId } : {}), ...(type === 'reception' ? { receptionService: 'check_in' } : {}), locale: 'es', whatsapp: { consent: true, phone: '+34600000000', version: 'whatsapp-public-service-updates-v1' } },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json()
}
