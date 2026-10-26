import { test, expect, newClientContext } from '../fixtures.js'
import { fixture, type QueueOpeningContext } from '../demo/fixtures.js'
import type { PublicService } from '../../../packages/contracts/src/queue.js'

test.use({ serviceWorkers: 'block' })
test('scheduled closed metadata survives legacy venue redirects and discovery refreshes from real admission', async ({
  page,
  request,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90000)
  const f = await fixture(page, request, baseURL!, 'restaurant', 'main', {
    interval: 4,
    tables: 1,
    approach: 2,
    leaveInactive: true,
  })
  await page.goto('/')
  async function configure(scheduled: boolean) {
    const [queue] = (await (
      await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
    ).json()) as {
      config: Record<string, unknown>
      version: number
      open: number
    }[]
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    )
    const start = (hour + 2) % 23
    const from = `${String(start).padStart(2, '0')}:00`,
      to = `${String(start + 1).padStart(2, '0')}:00`
    const response = await page.request.patch(
      `/api/v1/staff/queues/${f.queue}`,
      {
        headers: f.headers,
        data: {
          ...queue!.config,
          name: 'Restaurante',
          version: queue!.version,
          open: !!queue!.open,
          twentyFourHours: !scheduled,
          schedules: scheduled
            ? [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, from, to }))
            : [],
        },
      },
    )
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  const guest = await newClientContext(browser, info, 'opening-countdown', {
    baseURL: baseURL!,
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
  })
  const client = await guest.newPage()
  try {
    await configure(true)
    const detail = (await (
      await guest.request.get(`/api/v1/public/services/${f.queue}`)
    ).json()) as PublicService
    expect(detail.serviceOpen).toBe(false)
    expect(detail.canJoin).toBe(false)
    expect(detail.nextOpening!.at).toBeGreaterThan(
      detail.nextOpening!.serverNow,
    )
    const venue = await (
      await guest.request.get(`/api/v1/public/venues/${f.venueId}/services`)
    ).json()
    expect(venue.services[0].nextOpening.at).toBe(detail.nextOpening!.at)
    const search = await (
      await guest.request.post('/api/v1/public/search', {
        headers: { Origin: baseURL! },
        data: { recentIds: [f.queue] },
      })
    ).json()
    expect(search.items).toHaveLength(0)
    await client.goto(`/q/${f.queue}?lang=es`)
    await expect(
      client.getByText('No se admiten inscripciones en este momento.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(client.getByTestId('closed-service-card')).toHaveCount(0)
    for (const path of [
      '/?lang=es',
      `/search?text=${encodeURIComponent(f.venueName)}&lang=es`,
    ]) {
      await client.goto(path)
      await expect(
        client.getByText('No hay servicios disponibles.', { exact: true }),
      ).toBeVisible()
      await expect(client.getByTestId('closed-service-card')).toHaveCount(0)
    }
    await client.goto(`/v/${f.venueId}?lang=es`)
    // The scheduled-opening projection remains available to legacy API clients,
    // but /v no longer renders the deprecated venue selector/countdown card.
    await expect(client).toHaveURL(`${baseURL}/?lang=es`)
    await expect(client.getByTestId('closed-service-card')).toHaveCount(0)
    await expect(client.getByText('No hay servicios disponibles.', { exact: true })).toBeVisible()
    await client.screenshot({ path: info.outputPath('closed-legacy-redirect.png'), fullPage: true })
    await configure(false)
    await expect.poll(async () => {
      const current = await (await guest.request.get(`/api/v1/public/venues/${f.venueId}/services`)).json()
      return current.services.length
    }).toBe(0)
    await expect(
      client.getByText('No hay servicios disponibles.', { exact: true }),
    ).toBeVisible()
    await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)
    const context = (await (
      await page.request.get(`/api/v1/staff/queues/${f.queue}/opening-context`)
    ).json()) as QueueOpeningContext
    const activated = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/lifecycle`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: { action: 'declare_full', contextToken: context.contextToken },
      },
    )
    expect(activated.ok(), await activated.text()).toBeTruthy()
    await expect(
      client.getByRole('link', { name: /Restaurante/ }),
    ).toBeVisible()
    await expect(client.getByTestId('public-waiting-turns')).toHaveCount(0)
    await expect(client.getByTestId('closed-service-card')).toHaveCount(0)
    const opened = await (await guest.request.get(`/api/v1/public/services/${f.queue}`)).json()
    expect(opened).toMatchObject({ serviceOpen: true, queueState: 'active', canJoin: true, waitingTurns: 0 })
    expect(opened.nextOpening).toBeNull()
    await client.screenshot({
      path: info.outputPath('opened-active-selection.png'),
      fullPage: true,
    })
  } finally {
    await guest.close()
  }
})
