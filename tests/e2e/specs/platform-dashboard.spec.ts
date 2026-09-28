import { test, expect } from '@playwright/test'

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
    await page.route('**/api/v1/staff/**', async (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname.split('/staff')[1]!
      requests.push(`${route.request().method()} ${path}`)
      let body: unknown
      if (path === '/me')
        body = {
          user: { username: 'platform' },
          commercial: true,
          platformAdmin: true,
          venues: [],
        }
      else if (path === '/commercial/organizations')
        body = {
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
        }
      else if (path === '/commercial/venues/hotel')
        body = {
          id: 'hotel',
          name: 'Hotel Madrid',
          organizationId: 'org',
          organizationName: 'Empresa',
        }
      else if (path === '/venues/hotel/queues') body = [service]
      else if (path === '/queues/queue/entries')
        body = [
          {
            id: 'entry',
            code: 'A001',
            partySize: 2,
            status: 'waiting',
            sequence: 1,
            version: 1,
            calledAt: null,
          },
        ]
      else return route.fulfill({ status: 404, json: { error: 'not_found' } })
      await route.fulfill({ json: body })
    })
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
      page.getByRole('button', { name: 'Configurar servicio' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accesos' })).toBeVisible()
    await page.getByRole('button', { name: 'Ver cola', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Ver cola', exact: true })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('A001', { exact: true })).toBeVisible()
    await expect(
      drawer.getByRole('button', {
        name: /Llamar|Completar|Cancelar|Saltar|No presentado/,
      }),
    ).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath(`detail-${width}.png`),
      fullPage: true,
    })
    await drawer.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await page
      .getByRole('link', { name: 'Volver a establecimientos' })
      .click()
    await expect(page).toHaveURL(/\/staff\?page=2$/)
    await page.getByRole('link', { name: 'Página siguiente' }).click()
    await expect(page).toHaveURL(/\/staff\?page=3$/)
    expect(requests.some((request) => request.startsWith('POST'))).toBeFalsy()
    await page.goto('/staff/establishments/hotel')
    await expect(
      page.getByRole('link', { name: 'Volver a establecimientos' }),
    ).toHaveAttribute('href', '/staff')
  })
}
