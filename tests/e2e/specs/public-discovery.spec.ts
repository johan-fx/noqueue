import { test, expect, type APIRequestContext } from '../fixtures.js'
import { resolveFixtureLocation } from '../helpers/location.js'
import { selectCustomerLanguage } from '../helpers/customer-language.js'
test.use({ serviceWorkers: 'block' })
const pilot = {
  'X-NoQueue-Pilot-Token': 'test-pilot-access-at-least-32-characters',
}
async function catalogue(request: APIRequestContext, origin: string) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    sales = 'd_' + suffix,
    password = 'discovery-test-password-long'
  expect(
    (
      await request.post('/api/v1/experiments/local/staff/identity', {
        headers: pilot,
        data: { username: sales, password },
      })
    ).ok(),
  ).toBeTruthy()
  expect(
    (
      await request.post('/api/v1/auth/sign-in/username', {
        headers: { Origin: origin },
        data: { username: sales, password },
      })
    ).ok(),
  ).toBeTruthy()
  const fields = await resolveFixtureLocation(
    request,
    origin,
    'Paseo Marítimo 56 Málaga',
  )
  const common = {
    capacity: 20,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [],
    receptionServices: [],
  }
  const response = await request.post(
    '/api/v1/staff/commercial/organizations',
    {
      headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        ...fields,
        organizationName: 'Discovery ' + suffix,
        slug: 'discovery-' + suffix,
        venueName: 'Hotel Miramar ' + suffix,
        timezone: 'Europe/Madrid',
        ownerName: 'Owner',
        ownerUsername: 'o_' + suffix,
        ownerPassword: password,
        services: [
          {
            ...common,
            name: 'Hotel Miramar Recepción',
            type: 'reception',
            receptionServices: ['check_in'],
          },
          {
            ...common,
            name: 'Restaurante Miramar Playa',
            type: 'restaurant',
            spaces: [{ name: 'Interior', tables: 5 }],
          },
          { ...common, name: 'Beach Club Miramar', type: 'pool' },
        ],
      },
    },
  )
  expect(response.ok(), await response.text()).toBeTruthy()
  const { venueId } = await response.json()
  expect(
    (
      await request.post('/api/v1/experiments/local/staff/legacy-open', {
        headers: pilot,
        data: { venueId },
      })
    ).ok(),
  ).toBeTruthy()
  const queues = (await (
    await request.get(`/api/v1/staff/venues/${venueId}/queues`)
  ).json()) as { id: string; name: string }[]
  expect(
    (
      await request.post(
        '/api/v1/experiments/local/staff/discovery-projections',
        { headers: pilot, data: { venueId } },
      )
    ).ok(),
  ).toBeTruthy()
  return { venueId, queues, suffix }
}
test('anonymous home, exact service discovery, location consent, filtered return and responsive visuals', async ({
  page,
  request,
  baseURL,
  context,
}, info) => {
  test.setTimeout(90000)
  const fixture = await catalogue(request, baseURL!)
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 36.72016, longitude: -4.42034 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(
    page.getByRole('heading', {
      name: '¿Dónde quieres unirte a la lista de espera?',
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Usar mi ubicación/ }),
  ).toBeVisible()
  await expect(page.locator('main img')).toHaveCount(0)
  await page.screenshot({
    path: info.outputPath('public-home-390.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: /Usar mi ubicación/ }).click()
  await expect(
    page.getByRole('link', { name: /Miramar/ }).first(),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Servicios' })
      .getByRole('link', { name: /Miramar/ }),
  ).toHaveCount(3)
  await page.screenshot({
    path: info.outputPath('public-nearby-390.png'),
    fullPage: true,
    animations: 'disabled',
  })
  const locationData = await page.evaluate(() => ({
    storage: JSON.stringify({ ...localStorage }),
    url: location.href,
  }))
  expect(locationData.storage).not.toContain('36.72016')
  expect(locationData.url).not.toContain('36.72016')
  await page.getByRole('button', { name: 'Ver más' }).click()
  await expect(page).toHaveURL(/\/search\?.*scope=nearby/)
  const sorter = page.getByRole('combobox', { name: 'Ordenar' })
  await expect(sorter).toHaveAttribute('data-slot', 'select-trigger')
  await expect(sorter.locator('[data-slot="select-value"]')).toHaveText(
    'Más cerca',
  )
  await sorter.focus()
  await sorter.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'Más cerca' })).toBeVisible()
  const popup = await page
    .locator('[data-slot="select-content"][data-open]')
    .boundingBox()
  expect(popup).not.toBeNull()
  expect(popup!.x).toBeGreaterThanOrEqual(0)
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: info.outputPath('public-sort-390.png'),
    animations: 'disabled',
  })
  await expect(page.getByRole('option', { name: 'Más cerca' })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByRole('option', { name: 'Menos espera' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(sorter.locator('[data-slot="select-value"]')).toHaveText(
    'Menos espera',
  )
  await expect(sorter).toBeFocused()
  await expect(page).toHaveURL(/sort=wait/)
  await sorter.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'Menos espera' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('option', { name: 'Más cerca' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(sorter.locator('[data-slot="select-value"]')).toHaveText(
    'Más cerca',
  )
  await expect(page).toHaveURL(/sort=distance/)
  const language = page.getByRole('combobox', { name: 'Idioma' })
  await expect(language).toHaveAttribute('data-slot', 'select-trigger')
  await expect(language.locator('[data-slot="select-value"]')).toHaveText('ES')
  const beforeLanguage = new URL(page.url())
  await language.focus()
  await language.press('ArrowDown')
  await expect(
    page.getByRole('option', { name: 'ES', exact: true }),
  ).toBeFocused()
  const languagePopup = await page
    .locator('[data-slot="select-content"][data-open]')
    .boundingBox()
  expect(languagePopup).not.toBeNull()
  expect(languagePopup!.x).toBeGreaterThanOrEqual(0)
  expect(languagePopup!.x + languagePopup!.width).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: info.outputPath('public-language-390.png'),
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  await expect(language).toBeFocused()
  await expect(page).toHaveURL(beforeLanguage.toString())
  await selectCustomerLanguage(page, 'en')
  const afterLanguage = new URL(page.url())
  beforeLanguage.searchParams.set('lang', 'en')
  expect(afterLanguage.toString()).toBe(beforeLanguage.toString())
  await expect(
    page
      .getByRole('combobox', { name: 'Sort' })
      .locator('[data-slot="select-value"]'),
  ).toHaveText('Nearest')
  await selectCustomerLanguage(page, 'es')
  await expect(sorter.locator('[data-slot="select-value"]')).toHaveText(
    'Más cerca',
  )
  await page.getByLabel('Hotel, restaurante o local').fill(fixture.suffix)
  await expect(
    page
      .getByRole('region', { name: 'Servicios' })
      .getByRole('link', { name: /Miramar/ }),
  ).toHaveCount(3)
  await page.getByLabel('Hotel, restaurante o local').blur()
  await page.screenshot({
    path: info.outputPath('public-search-390.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await expect(
    page.getByRole('link', { name: 'Volver' }).locator('.lucide-chevron-left'),
  ).toHaveCount(1)
  await expect(page.locator('header .lucide-x')).toHaveCount(0)
  await page.getByRole('button', { name: 'Restaurantes', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: 'Servicios' })
      .getByRole('link', { name: /Miramar/ }),
  ).toHaveCount(1)
  await page.screenshot({
    path: info.outputPath('public-filtered-390.png'),
    fullPage: true,
    animations: 'disabled',
  })
  const searchUrl = page.url()
  // Keep this small fixture scrollable to verify restoration without extra services.
  const scrollFixtureStyle = await page.addStyleTag({
    content: 'main { padding-bottom: 1000px !important; }',
  })
  await page.evaluate(() => window.scrollTo({ top: 160, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(160)
  await page.getByRole('link', { name: /Restaurante Miramar Playa/ }).click()
  await expect(page).toHaveURL(/\/q\//)
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page).toHaveURL(searchUrl)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(160)
  await scrollFixtureStyle.evaluate((element) =>
    element.parentNode?.removeChild(element),
  )
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(
    page.getByRole('button', { name: 'Restaurantes' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Restaurantes' }).click()
  await expect(
    page
      .getByRole('region', { name: 'Servicios' })
      .getByRole('link', { name: /Miramar/ }),
  ).toHaveCount(3)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    path: info.outputPath('public-responsive-1280.png'),
    fullPage: true,
    animations: 'disabled',
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.reload()
  await expect(sorter.locator('[data-slot="select-value"]')).toHaveText(
    'Menos espera',
  )
  await sorter.click()
  await expect(page.getByRole('option', { name: 'Más cerca' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await page.keyboard.press('Escape')
  await expect(sorter).toBeFocused()
  await page.goto('/')
  await expect(
    page.getByRole('link', { name: /Restaurante Miramar Playa/ }),
  ).toBeVisible()
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('noqueue.recent-services')!),
  )
  expect(stored).toEqual([
    fixture.queues.find((q) => q.name.startsWith('Restaurante'))!.id,
  ])
})
test('denied location and camera keep public search available', async ({
  page,
  context,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (
          _success: unknown,
          error: (value: unknown) => void,
        ) => error({ code: 1 }),
      },
    })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () =>
        Promise.reject(new DOMException('Denied', 'NotAllowedError')),
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: /Usar mi ubicación/ }).click()
  await expect(page.getByRole('alert')).toContainText(
    'No podemos acceder a tu ubicación',
  )
  await page.getByRole('button', { name: /Escanear QR/ }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'No se puede acceder a la cámara',
  )
  await page.screenshot({
    path: info.outputPath('public-camera-denied-390.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Buscar servicio' }).click()
  await expect(page).toHaveURL(/\/search/)
  await expect(
    page.getByRole('heading', { name: 'Busca tu establecimiento' }),
  ).toBeVisible()
})
