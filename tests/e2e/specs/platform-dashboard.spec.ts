import { test, expect } from '../fixtures.js'
import { strictApiMocks } from '../helpers/api-mocks.js'

// Route-mocked identities must not be bypassed by the app's service worker.
test.use({ serviceWorkers: 'block' })

for (const width of [320, 390, 1280]) {
  test(`platform cards, read-only detail and return navigation at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const requests: string[] = []
    const service = {
      id: 'queue',
      venueId: 'hotel',
      name: 'Restaurante',
      capacity: 20,
      averageMinutes: 30,
      open: 1,
      version: 1,
      config: {
        name: 'Restaurante',
        type: 'restaurant',
        capacity: 20,
        averageMinutes: 30,
        graceMinutes: 5,
        cutoffMinutes: 0,
        twentyFourHours: true,
        schedules: [],
        spaces: [],
        receptionServices: [],
      },
    }
    const recorded = (
      request: import('@playwright/test').Request,
      body: unknown,
    ) => {
      const path = new URL(request.url()).pathname.split('/staff')[1]!
      requests.push(`${request.method()} ${path}`)
      return { json: body }
    }
    const mocks = await strictApiMocks(page, [
      {
        method: 'GET',
        path: '/api/v1/staff/me',
        expectedHits: { min: 1 },
        respond: (request) =>
          recorded(request, {
          user: { username: 'platform' },
          commercial: true,
          platformAdmin: true,
          venues: [],
          }),
      },
      {
        method: 'GET',
        path: '/api/v1/staff/commercial/organizations',
        expectedHits: { min: 1 },
        respond: (request) => {
          const url = new URL(request.url())
          return recorded(request, {
          items: [
            {
              id: 'org',
              name: 'Empresa',
              slug: 'empresa',
              status: 'active',
              venueId: 'hotel',
              venueName: 'Hotel Madrid',
            },
          ],
          page: Number(url.searchParams.get('page') ?? 1),
          hasMore: true,
          })
        },
      },
      {
        method: 'GET',
        path: '/api/v1/staff/commercial/venues/hotel',
        expectedHits: { min: 1 },
        respond: (request) =>
          recorded(request, {
          id: 'hotel',
          name: 'Hotel Madrid',
          organizationId: 'org',
          organizationName: 'Empresa',
          }),
      },
      {
        method: 'GET',
        path: '/api/v1/staff/venues/hotel/queues',
        expectedHits: { min: 1 },
        respond: (request) => recorded(request, [service]),
      },
      {
        method: 'GET',
        path: '/api/v1/staff/queues/queue/entries',
        expectedHits: { min: 1 },
        respond: (request) =>
          recorded(request, [
          {
            id: 'entry',
            code: 'A001',
            partySize: 2,
            status: 'waiting',
            sequence: 1,
            version: 1,
            calledAt: null,
          },
          ]),
      },
      {
        method: 'GET',
        path: '/api/v1/staff/venues/hotel/location',
        respond: (request) =>
          recorded(request, { version: 1, confirmedAt: null, location: null }),
      },
    ])
    await page.goto('/staff?page=2')
    const card = page.getByRole('link', { name: /Hotel Madrid/ })
    await expect(card).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    expect(
      requests.filter((request) => request.includes('/queues')),
    ).toHaveLength(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy()
    await page.screenshot({
      path: testInfo.outputPath(`cards-${width}.png`),
      fullPage: true,
    })
    await card.click()
    await expect(
      page.getByRole('heading', { name: 'Hotel Madrid', exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Opciones del servicio' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accesos' })).toBeVisible()
    await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Ver lista', exact: true })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('Turno A001', { exact: true })).toBeVisible()
    await expect(
      drawer.getByRole('button', {
        name: /Llamar|Completar|Cancelar|Saltar|No presentado/,
      }),
    ).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath(`detail-${width}.png`),
      fullPage: true,
    })
    await drawer.getByRole('button', { name: 'Volver', exact: true }).click()
    await page.getByRole('link', { name: 'Volver a establecimientos' }).click()
    await expect(page).toHaveURL(/\/staff\?page=2$/)
    await page.getByRole('link', { name: 'Página siguiente' }).click()
    await expect(page).toHaveURL(/\/staff\?page=3$/)
    expect(requests.some((request) => request.startsWith('POST'))).toBeFalsy()
    await page.goto('/staff/establishments/hotel')
    await expect(
      page.getByRole('link', { name: 'Volver a establecimientos' }),
    ).toHaveAttribute('href', '/staff')
    await mocks.assertComplete()
  })
}
