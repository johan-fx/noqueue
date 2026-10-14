import { test, expect } from '../fixtures.js'
import { setup, pilot } from '../helpers/queue-actions.js'

test('real capture → aggregate → commercial dashboard is responsive and reconciled', async ({
  page,
  request,
  baseURL,
}, info) => {
  const { queue, venueId, headers } = await setup(
    page,
    request,
    baseURL!,
    'restaurant',
  )
  const added = await page.request.post(
    `/api/v1/staff/queues/${queue}/entries`,
    {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        displayName: 'Metrics E2E',
        partySize: 2,
        locale: 'es',
        whatsapp: { consent: false },
      },
    },
  )
  expect(added.ok(), await added.text()).toBeTruthy()
  const entries = (await (
    await page.request.get(`/api/v1/staff/queues/${queue}/entries`)
  ).json()) as Array<{ id: string; version: number }>
  const called = await page.request.post(
    `/api/v1/staff/queues/${queue}/commands`,
    {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        entryId: entries[0]!.id,
        version: entries[0]!.version,
        action: 'call',
        arrivalMode: 'present',
        seating: { mode: 'confirmed', spaceId: 'terrace', seats: 4 },
      },
    },
  )
  expect(called.ok(), await called.text()).toBeTruthy()
  const cut = await request.post(
    '/api/v1/experiments/local/staff/metrics-process',
    { headers: pilot, data: { queueId: queue } },
  )
  expect(cut.ok(), await cut.text()).toBeTruthy()
  // The independent request fixture still has the commercial identity created by setup.
  await page.context().clearCookies()
  await page.context().addCookies((await request.storageState()).cookies)
  let response:
    | {
        summary: { generated: number; completed: number; pending: number }
        freshness: { lastCompleteAt: number | null }
      }
    | undefined
  page.on('response', async (r) => {
    if (
      new URL(r.url()).pathname === '/api/v1/staff/commercial/metrics' &&
      r.ok()
    )
      response = await r.json()
  })
  await page.goto(`/staff?tab=metrics&mPeriod=today&mVenue=${venueId}`)
  await expect(
    page.getByRole('heading', { name: 'Métricas ejecutivas' }),
  ).toBeVisible()
  await expect.poll(() => response?.summary.generated).toBe(1)
  expect(response?.summary).toMatchObject({
    generated: 1,
    completed: 1,
    pending: 0,
  })
  expect(response?.freshness.lastCompleteAt).not.toBeNull()
  await expect(
    page.getByRole('heading', { name: 'Comparativa por establecimiento' }),
  ).toBeVisible()
  await expect(page.locator('[data-chart] svg').first()).toBeVisible()
  await page
    .getByText('Cómo se calculan estas métricas', { exact: true })
    .click()
  await expect(page.getByText(/Llegada confirmada/).first()).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true)
    await info.attach(`metrics-${width}`, {
      body: await page.screenshot({ fullPage: true, path: info.outputPath(`metrics-${width}.png`) }),
      contentType: 'image/png',
    })
  }
  await page.getByRole('tab', { name: 'Establecimientos', exact: true }).click()
  await page.getByRole('tab', { name: 'Métricas', exact: true }).click()
  await expect(page).toHaveURL(/mPeriod=today/)
  await expect(page).toHaveURL(/mVenue=/)
})
