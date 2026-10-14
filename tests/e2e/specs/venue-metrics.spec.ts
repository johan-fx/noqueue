import { test, expect } from '../fixtures.js'
import { setup, pilot } from '../helpers/queue-actions.js'

test('owner switches management/metrics with fixed scope, responsive charts and no hidden operational polling', async ({ page, request, baseURL }, info) => {
  const { queue, venueId, headers } = await setup(page, request, baseURL!, 'restaurant')
  const added = await page.request.post(`/api/v1/staff/queues/${queue}/entries`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: { displayName: 'Venue metrics E2E', partySize: 2, locale: 'es', whatsapp: { consent: false } },
  })
  expect(added.ok(), await added.text()).toBeTruthy()
  const cut = await request.post('/api/v1/experiments/local/staff/metrics-process', {
    headers: pilot, data: { queueId: queue },
  })
  expect(cut.ok(), await cut.text()).toBeTruthy()
  let metricsRequests = 0, operationalRequests = 0
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname
    if (path.endsWith('/metrics')) metricsRequests++
    if (path === `/api/v1/staff/venues/${venueId}/queues`) operationalRequests++
  })
  // A stale/manipulated commercial filter must not control member metrics.
  await page.goto('/staff?mPeriod=today&mVenue=foreign&mPage=99')
  await expect(page.getByRole('tab', { name: 'Gestión', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Ver lista', exact: true })).toBeVisible()
  expect(metricsRequests).toBe(0)
  const resultPromise = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/staff/venues/${venueId}/metrics`)
  await page.getByRole('tab', { name: 'Métricas', exact: true }).click()
  const result = await resultPromise
  expect(result.ok()).toBeTruthy()
  const data = await result.json()
  expect(data.summary.generated).toBe(1)
  expect(data.venues.items.map((v: { venueId: string }) => v.venueId)).toEqual([venueId])
  const url = new URL(result.url())
  expect(url.searchParams.has('venueId')).toBe(false)
  expect(url.searchParams.has('page')).toBe(false)
  await expect(page.getByRole('heading', { name: 'Métricas ejecutivas' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Comparativa por establecimiento' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Establecimiento', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ver lista', exact: true })).toHaveCount(0)
  await expect(page.locator('[data-chart] svg').first()).toBeVisible()
  const operationsAtMetrics = operationalRequests
  await page.waitForTimeout(5500)
  expect(operationalRequests).toBe(operationsAtMetrics)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await info.attach(`venue-metrics-${width}`, {
      body: await page.screenshot({ fullPage: true, path: info.outputPath(`venue-metrics-${width}.png`) }),
      contentType: 'image/png',
    })
  }
  await page.getByRole('tab', { name: 'Gestión', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ver lista', exact: true })).toBeVisible()
  await expect.poll(() => operationalRequests).toBeGreaterThan(operationsAtMetrics)
  await expect(page.getByRole('heading', { name: 'Métricas ejecutivas' })).toHaveCount(0)
})
