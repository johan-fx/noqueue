import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test'
import { resolveFixtureLocation } from '../helpers/location.js'
test.use({ serviceWorkers: 'block' })
const pilot = {
    'X-NoQueue-Pilot-Token': 'test-pilot-access-at-least-32-characters',
  },
  password = 'autocomplete-test-password-long'
async function login(page: Page, request: APIRequestContext) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    username = 'a_' + suffix
  expect(
    (
      await request.post('/api/v1/experiments/local/staff/identity', {
        headers: pilot,
        data: { username, password },
      })
    ).ok(),
  ).toBeTruthy()
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(username)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Establecimientos', exact: true }),
  ).toBeVisible()
  return suffix
}
test('commercial signup autocomplete: mobile empty Escape, Tab without selection, keyboard explicit selection and no extra query', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const suffix = await login(page, request)
  await page.getByRole('button', { name: 'Crear nuevo' }).click()
  const drawer = page.getByRole('dialog', { name: 'Cliente y administrador' }),
    input = page.getByLabel('Dirección del establecimiento')
  let queries = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/locations/autocomplete')) queries++
  })
  await input.fill('Vacío Madrid')
  await expect(page.locator('[data-slot=combobox-content]')).toBeVisible()
  await expect(page.getByRole('option')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reintentar búsqueda' }).click()
  await expect(page.locator('[data-slot=combobox-content]')).toContainText(
    'No hay direcciones precisas',
  )
  await expect(
    page.getByRole('combobox', { name: 'Dirección del establecimiento' }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('signup-empty-autocomplete-390.png'),
    animations: 'disabled',
  })
  await input.press('Escape')
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer).toBeVisible()
  await expect(input).toHaveValue('Vacío Madrid')
  await input.fill('Calle Mayor 1 Madrid')
  await expect(page.getByRole('option')).toHaveCount(1)
  await input.press('ArrowDown')
  await input.press('Tab')
  await expect(drawer).toBeVisible()
  await expect(
    drawer.getByText('Dirección seleccionada.', { exact: false }),
  ).toHaveCount(0)
  await input.focus()
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(input).toHaveValue('Calle Mayor 1, Madrid')
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  const count = queries
  await page.waitForTimeout(450)
  expect(queries).toBe(count)
  await page.getByLabel('Empresa / organización').fill('Autocomplete ' + suffix)
  await page
    .getByLabel('Hotel / establecimiento', { exact: true })
    .fill('Autocomplete ' + suffix)
  await page.getByLabel('Nombre del administrador').fill('Owner')
  await page.getByLabel('Usuario del administrador').fill('o_' + suffix)
  await page
    .getByLabel('Contraseña inicial (mínimo 15 caracteres)')
    .fill(password)
  await page.getByLabel('Confirmar contraseña').fill(password)
  await page.screenshot({
    path: testInfo.outputPath('signup-autocomplete-390.png'),
    animations: 'disabled',
  })
  await drawer.getByRole('button', { name: 'Continuar', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Configuración restaurante' }),
  ).toBeVisible()
})
test('venue edit autocomplete preserves the stored address until explicit save and retains input on provider failure', async ({
  page,
  request,
  baseURL,
  browser,
}, testInfo) => {
  const suffix = await login(page, request),
    fields = await resolveFixtureLocation(page.request, baseURL!)
  const response = await page.request.post(
    '/api/v1/staff/commercial/organizations',
    {
      headers: { Origin: baseURL!, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        ...fields,
        organizationName: 'Address ' + suffix,
        slug: 'address-' + suffix,
        venueName: 'Address ' + suffix,
        timezone: 'Europe/Madrid',
        ownerName: 'Owner',
        ownerUsername: 'o_' + suffix,
        ownerPassword: password,
        services: [
          {
            name: 'Pool',
            type: 'pool',
            capacity: 10,
            averageMinutes: 30,
            graceMinutes: 5,
            cutoffMinutes: 0,
            twentyFourHours: true,
            schedules: [],
            spaces: [],
            receptionServices: [],
          },
        ],
      },
    },
  )
  expect(response.ok(), await response.text()).toBeTruthy()
  const { venueId } = await response.json()
  await page.goto(`/staff/establishments/${venueId}`)
  await page.getByRole('button', { name: 'Editar ubicación' }).click()
  const input = page.getByLabel('Dirección del establecimiento'),
    save = page.getByRole('button', { name: 'Guardar ubicación' })
  await expect(input).toHaveValue('Calle Mayor 1, Madrid')
  await expect(save).toBeDisabled()
  let queries = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/locations/autocomplete')) queries++
  })
  await input.focus()
  await page.waitForTimeout(450)
  expect(queries).toBe(0)
  await input.fill('Error Madrid')
  await expect(page.getByRole('status')).toContainText('No se puede resolver')
  await expect(input).toHaveValue('Error Madrid')
  await expect(save).toBeDisabled()
  await input.fill('Calle Colón 1 Valencia')
  await page.getByRole('option', { name: /Calle Colón 1, Valencia/ }).click()
  await expect(save).toBeEnabled()
  expect(
    (
      await (
        await page.request.get(`/api/v1/staff/venues/${venueId}/location`)
      ).json()
    ).location.formatted,
  ).toBe('Calle Mayor 1, Madrid')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: testInfo.outputPath('venue-autocomplete-390.png'),
    animations: 'disabled',
  })
  await save.click()
  await expect(
    page.getByRole('button', { name: 'Editar ubicación' }),
  ).toBeVisible()
  expect(
    (
      await (
        await page.request.get(`/api/v1/staff/venues/${venueId}/location`)
      ).json()
    ).location.formatted,
  ).toBe('Calle Colón 1, Valencia')
  const staff = await browser.newContext({
    baseURL: baseURL!,
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'CF-Connecting-IP': crypto.randomUUID() },
  })
  try {
    const owner = await staff.newPage()
    await owner.goto('/login')
    await owner.getByLabel('Usuario o email').fill('o_' + suffix)
    await owner.getByLabel('Contraseña', { exact: true }).fill(password)
    await owner.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(
      owner.getByText('Calle Colón 1, Valencia', { exact: true }),
    ).toBeVisible()
    await expect(
      owner.getByRole('link', { name: 'Geoapify', exact: true }),
    ).toBeVisible()
    await expect(
      owner.getByRole('button', { name: 'Editar ubicación' }),
    ).toHaveCount(0)
    await expect(owner.getByLabel('Dirección del establecimiento')).toHaveCount(
      0,
    )
    await expect(
      owner.getByRole('button', { name: 'Guardar ubicación' }),
    ).toHaveCount(0)
    for (const endpoint of ['resolve', 'autocomplete'])
      expect(
        (
          await owner.request.post('/api/v1/staff/locations/' + endpoint, {
            headers: { Origin: baseURL! },
            data: {
              text: 'Calle Mayor 1 Madrid',
              scope: { kind: 'venue', id: venueId },
            },
          })
        ).status(),
      ).toBe(403)
    expect(
      (
        await owner.request.patch('/api/v1/staff/venues/' + venueId, {
          headers: { Origin: baseURL! },
          data: { version: 2, locationToken: 'invalid' },
        })
      ).status(),
    ).toBe(403)
    await owner.screenshot({
      path: testInfo.outputPath('owner-location-readonly-390.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await expect(
      owner.getByRole('button', { name: 'Configurar servicio' }),
    ).toBeVisible()
    const location = await owner.request.get(
      '/api/v1/staff/venues/' + venueId + '/location',
    )
    expect((await location.json()).location.formatted).toBe(
      'Calle Colón 1, Valencia',
    )
  } finally {
    await staff.close()
  }
})
