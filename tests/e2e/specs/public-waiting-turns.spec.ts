import { test, expect, newClientContext } from '../fixtures.js'
import { fixture, type QueueOpeningContext } from '../demo/fixtures.js'
import type { Entry } from '../../../packages/contracts/src/queue.js'

test.use({ serviceWorkers: 'block' })
test('public surfaces count groups as turns across admission transitions without changing personal position', async ({ page, request, browser, baseURL }, info) => {
  test.setTimeout(120000)
  const f = await fixture(page, request, baseURL!, 'restaurant', 'main', { interval: 4, tables: 1, approach: 2, leaveInactive: true })
  const guest = await newClientContext(browser, info, 'public-turn-counts', { baseURL: baseURL!, serviceWorkers: 'block', viewport: { width: 390, height: 844 } })
  const client = await guest.newPage()
  const headers = () => ({ Origin: baseURL!, 'Idempotency-Key': crypto.randomUUID() })
  const serviceUrl = `/api/v1/public/services/${f.queue}`
  async function lifecycle(action: 'declare_full' | 'pause' | 'resume') {
    const context = await (await page.request.get(`/api/v1/staff/queues/${f.queue}/opening-context`)).json() as QueueOpeningContext
    const response = await page.request.post(`/api/v1/staff/queues/${f.queue}/lifecycle`, { headers: headers(), data: { action, contextToken: context.contextToken } })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  async function assertSurfaces(realTurns: number, people: number, display: number | null, locale: 'es' | 'en' = 'es', capture?: string) {
    const detail = await (await guest.request.get(serviceUrl)).json()
    const venue = await (await guest.request.get(`/api/v1/public/venues/${f.venueId}/services`)).json()
    const search = await (await guest.request.post('/api/v1/public/search', { headers: { Origin: baseURL! }, data: { recentIds: [f.queue] } })).json()
    expect(detail).toMatchObject({ waitingTurns: realTurns, waitingPeople: people })
    const visible = detail.serviceOpen && detail.queueState === 'active'
    for (const value of [venue.services.find((s: { id: string }) => s.id === f.queue), search.items.find((s: { id: string }) => s.id === f.queue)]) {
      if (visible) expect(value).toMatchObject({ waitingTurns: realTurns, waitingPeople: people })
      else expect(value).toBeUndefined()
    }
    const paths = { detail: `/q/${f.queue}?lang=${locale}`, venue: `/v/${f.venueId}?lang=${locale}`, search: `/search?text=${encodeURIComponent(f.venueName)}&lang=${locale}`, home: `/?lang=${locale}` }
    for (const [surface, path] of Object.entries(paths)) {
      await client.goto(path)
      const row = client.getByTestId('public-waiting-turns')
      // /q records the recent service, but inactive lists must also disappear from home.
      if (surface === 'detail') {
        await expect(client.getByText('Restaurante Miramar', { exact: true }).first()).toBeVisible()
        await expect(row).toHaveCount(0)
        if (detail.canJoin) expect((await client.getByRole('heading', { name: locale === 'es' ? 'Introduce tus datos' : 'Enter your details' }).boundingBox())?.y).toBe(68)
        await expect(client.getByText(/Lista activa|Estimación provisional|media de espera/)).toHaveCount(0)
      } else if (!visible) {
        await expect(client.getByText('No hay servicios disponibles.', { exact: true })).toBeVisible()
        await expect(client.getByRole('link', { name: /Restaurante Miramar/ })).toHaveCount(0)
        await expect(row).toHaveCount(0)
      } else {
        await expect(client.getByRole('link', { name: /Restaurante Miramar/ })).toBeVisible()
        const card = client.getByRole('link', { name: /Restaurante Miramar/ })
        if (surface === 'venue') {
          expect((await card.locator('.lucide-arrow-right').boundingBox())?.width).toBe(24)
          expect((await card.locator('.lucide-clock').boundingBox())?.width).toBe(16)
          expect((await card.boundingBox())?.height).toBe(108)
        } else {
          expect((await card.locator('.lucide-clock').boundingBox())?.width).toBe(12)
          expect((await card.locator('.lucide-utensils').boundingBox())?.width).toBe(24)
          expect((await card.boundingBox())?.height).toBe(53)
        }
        if (surface !== 'venue' || display === null) await expect(row).toHaveCount(0)
        else await expect(row).toHaveText(locale === 'es' ? `${display} ${display === 1 ? 'turno' : 'turnos'} en lista de espera` : `${display} ${display === 1 ? 'turn' : 'turns'} waiting`)
      }
      if (capture) await client.screenshot({ path: info.outputPath(`${capture}-${surface}.png`), fullPage: true })
    }
  }
  async function join(partySize: number) {
    const response = await guest.request.post(`${serviceUrl}/entries`, { headers: headers(), data: {
      displayName: `Group of ${partySize}`, partySize, preferredSpaceId: 'fastest', locale: 'es',
      whatsapp: { consent: true, phone: '+34600000000', version: 'whatsapp-public-service-updates-v1' },
    } })
    expect(response.ok(), await response.text()).toBeTruthy()
    return await response.json() as Entry & { recoveryToken: string }
  }
  try {
    await assertSurfaces(0, 0, null, 'es', 'direct-empty')
    await lifecycle('declare_full')
    await assertSurfaces(0, 0, 1, 'es', 'active-empty')
    const first = await join(4)
    await assertSurfaces(1, 4, 1)
    const second = await join(2)
    const before = await (await guest.request.get(`/api/v1/public/entries/${second.recoveryToken}`)).json() as Entry
    expect(before.position).toBe(2)
    await assertSurfaces(2, 6, 2, 'en')
    await assertSurfaces(2, 6, 2, 'es', 'two-turns-six-people')
    const after = await (await guest.request.get(`/api/v1/public/entries/${second.recoveryToken}`)).json() as Entry
    expect(after.position).toBe(before.position)
    expect(after.predictedAt).toBe(before.predictedAt)
    await client.screenshot({ path: info.outputPath('public-two-turns-six-people.png'), fullPage: true })
    await lifecycle('pause')
    await assertSurfaces(2, 6, 2)
    for (const entry of [first, second]) {
      const path = `/api/v1/public/entries/${entry.recoveryToken}`
      const current = await (await guest.request.get(path)).json() as Entry
      const response = await guest.request.post(`${path}/commands`, { headers: headers(), data: { action: 'cancel', version: current.customer!.version } })
      expect(response.ok(), await response.text()).toBeTruthy()
    }
    await assertSurfaces(0, 0, null, 'es', 'paused-empty')
    await expect(client.getByText('Lista pausada', { exact: true })).toHaveCount(0)
    await lifecycle('resume')
    await assertSurfaces(0, 0, 1)
  } finally {
    await guest.close()
  }
})
