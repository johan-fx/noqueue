import { test, expect, newClientContext } from '../fixtures.js'
import { resolveFixtureLocation } from '../helpers/location.js'

const password = 'e2e-only-password-12345'
const names = [
  'Recepción Sol Lunamar Palmanova',
  'Snack Bar',
  'Restaurante Lunamar Buffet',
] as const
const service = (name: string) => ({
  name,
  type: 'restaurant',
  capacity: 20,
  averageMinutes: 30,
  graceMinutes: 5,
  cutoffMinutes: 0,
  twentyFourHours: true,
  schedules: [],
  receptionServices: [],
  assignmentPreference: 'fastest',
  spaces: [
    {
      id: 'terrace',
      name: 'Terrace',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }],
    },
  ],
})

test.use({ serviceWorkers: 'block' })
test('creates and edits explicit assignments, filters staff views and revokes an open queue', async ({
  page,
  request,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90000)
  const origin = baseURL!,
    suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const sales = `sales_${suffix}`,
    owner = `owner_${suffix}`,
    username = `staff_${suffix}`
  const headers = { Origin: origin }
  expect(
    (
      await request.post('/api/v1/experiments/local/staff/identity', {
        headers: {
          'X-NoQueue-Pilot-Token': 'test-pilot-access-at-least-32-characters',
        },
        data: { username: sales, password },
      })
    ).ok(),
  ).toBeTruthy()
  expect(
    (
      await request.post('/api/v1/auth/sign-in/username', {
        headers,
        data: { username: sales, password },
      })
    ).ok(),
  ).toBeTruthy()
  const location = await resolveFixtureLocation(request, origin)
  const provision = await request.post(
    '/api/v1/staff/commercial/organizations',
    {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        ...location,
        organizationName: `Scope ${suffix}`,
        slug: `scope-${suffix}`,
        venueName: `Scope ${suffix}`,
        timezone: 'Europe/Madrid',
        ownerName: 'Owner',
        ownerUsername: owner,
        ownerPassword: password,
        services: names.map(service),
      },
    },
  )
  expect(provision.ok(), await provision.text()).toBeTruthy()
  const { venueId } = (await provision.json()) as { venueId: string }
  expect(
    (
      await page.request.post('/api/v1/auth/sign-in/username', {
        headers,
        data: { username: owner, password },
      })
    ).ok(),
  ).toBeTruthy()
  const queues = (await (
    await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)
  ).json()) as { id: string; name: string }[]
  const reception = queues.find((row) => row.name === names[0])!,
    snack = queues.find((row) => row.name === names[1])!
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/staff')
  await page.getByRole('button', { name: 'Accesos', exact: true }).click()
  await page.getByRole('button', { name: 'Añadir usuario' }).click()
  const create = page.getByRole('dialog', {
    name: 'Crear usuario',
    exact: true,
  })
  await create.getByLabel('Nombre', { exact: true }).fill('Personal E2E')
  await create.getByLabel('Usuario', { exact: true }).fill(username)
  await create
    .getByLabel('Contraseña inicial (mínimo 15 caracteres)')
    .fill(password)
  await create.getByRole('button', { name: 'Crear acceso' }).click()
  await expect(
    create.getByText('Selecciona al menos un servicio', { exact: true }),
  ).toBeVisible()
  await create.getByRole('combobox', { name: 'Servicios a gestionar' }).click()
  const search = page.getByRole('combobox', { name: 'Buscar servicios' })
  await search.fill('Servicio inexistente')
  await expect(
    page.getByText('No se encontraron servicios.', { exact: true }),
  ).toBeVisible()
  await search.fill('Snack')
  await expect(
    page.getByRole('option', { name: names[0], exact: true }),
  ).toHaveCount(0)
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(search).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Seleccionar todos', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('option', { name: names[1], exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page
      .getByRole('option', { name: names[1], exact: true })
      .locator('[data-slot=combobox-item-indicator] svg'),
  ).toBeVisible()
  await search.fill('')
  for (const name of [names[0], names[2]]) {
    const option = page.getByRole('option', { name, exact: true })
    await expect(
      option.locator('[data-slot=combobox-item-indicator]'),
    ).toHaveCount(0)
    await option.click()
    await expect(option).toHaveAttribute('aria-selected', 'true')
    await expect(
      option.locator('[data-slot=combobox-item-indicator] svg'),
    ).toBeVisible()
  }
  const picker = create.locator('[data-slot=member-queue-picker]')
  const expectCenteredChips = async () => {
    const frame = await picker.boundingBox()
    const chips = await picker
      .locator('[data-slot=combobox-chips]')
      .boundingBox()
    expect(frame).not.toBeNull()
    expect(chips).not.toBeNull()
    expect(
      Math.abs(
        chips!.y -
          frame!.y -
          (frame!.y + frame!.height - chips!.y - chips!.height),
      ),
    ).toBeLessThanOrEqual(1)
  }
  await expectCenteredChips()
  await page.screenshot({ path: info.outputPath('member-search-multiple.png') })
  const popup = page.locator('[data-slot=combobox-content]')
  await expect(popup.locator('[data-slot=combobox-empty]')).toBeEmpty()
  expect(
    (await popup.locator('[data-slot=combobox-empty]').boundingBox())!.height,
  ).toBe(0)
  const bounds = await popup.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
  await search.press('Escape')
  await expect(create).toBeVisible()
  await create
    .getByRole('button', { name: `Quitar ${names[0]}`, exact: true })
    .click()
  await create
    .getByRole('button', { name: `Quitar ${names[2]}`, exact: true })
    .click()
  await expect(
    create.getByRole('button', { name: 'Quitar Snack Bar' }),
  ).toBeVisible()
  await expectCenteredChips()
  await page.screenshot({
    path: info.outputPath('member-selected-mobile.png'),
    fullPage: true,
  })
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/venues/${venueId}/members`) &&
      response.request().method() === 'POST',
  )
  await create
    .getByRole('button', { name: 'Crear acceso', exact: true })
    .click()
  const created = await saved
  expect(created.status()).toBe(201)
  expect(created.request().postDataJSON().queueIds).toEqual([snack.id])
  await expect(create).toHaveCount(0)
  const staffContext = await newClientContext(browser, info, 'staff-scope', {
    baseURL: origin,
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
  })
  try {
    expect(
      (
        await staffContext.request.post('/api/v1/auth/sign-in/username', {
          headers,
          data: { username, password },
        })
      ).ok(),
    ).toBeTruthy()
    const staff = await staffContext.newPage()
    await staff.goto('/staff')
    await expect(
      staff.getByRole('article', { name: 'Servicio Snack Bar', exact: true }),
    ).toBeVisible()
    await expect(
      staff.getByRole('article', { name: `Servicio ${names[0]}`, exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await staffContext.request.get(
          `/api/v1/staff/queues/${reception.id}/entries`,
        )
      ).status(),
    ).toBe(404)
    expect(
      (
        await staffContext.request.post(
          `/api/v1/staff/queues/${reception.id}/commands`,
          { headers, data: {} },
        )
      ).status(),
    ).toBe(404)
    await staff.getByRole('button', { name: 'Ver lista', exact: true }).click()
    await expect(staff.getByRole('dialog')).toBeVisible()
    await page.bringToFront()
    await page
      .getByRole('button', { name: 'Acciones de Personal E2E', exact: true })
      .click()
    await page
      .getByRole('menuitem', { name: 'Editar usuario', exact: true })
      .click()
    const edit = page.getByRole('dialog', {
      name: 'Editar usuario',
      exact: true,
    })
    await expect(
      edit.getByRole('button', { name: 'Quitar Snack Bar' }),
    ).toBeVisible()
    await edit.getByRole('button', { name: 'Quitar Snack Bar' }).click()
    await edit.getByRole('combobox', { name: 'Servicios a gestionar' }).click()
    await page.getByRole('option', { name: names[0], exact: true }).click()
    await page
      .getByRole('combobox', { name: 'Buscar servicios' })
      .press('Escape')
    await edit
      .getByRole('button', { name: 'Guardar cambios', exact: true })
      .click()
    await expect(edit).toHaveCount(0)
    await staff.bringToFront()
    await expect(
      staff.getByRole('article', { name: `Servicio ${names[0]}`, exact: true }),
    ).toBeVisible()
    await expect(
      staff.getByRole('article', { name: 'Servicio Snack Bar', exact: true }),
    ).toHaveCount(0)
    await expect(staff.getByRole('dialog')).toHaveCount(0)
    expect(
      (
        await staffContext.request.get(
          `/api/v1/staff/queues/${snack.id}/entries`,
        )
      ).status(),
    ).toBe(404)
    const future = await page.request.post(
      `/api/v1/staff/venues/${venueId}/queues`,
      {
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        data: service('Servicio futuro'),
      },
    )
    expect(future.ok(), await future.text()).toBeTruthy()
    const visible = (await (
      await staffContext.request.get(`/api/v1/staff/venues/${venueId}/queues`)
    ).json()) as { id: string }[]
    expect(visible.map((row) => row.id)).toEqual([reception.id])
    await staff.screenshot({
      path: info.outputPath('staff-assigned-only.png'),
      fullPage: true,
    })
  } finally {
    await staffContext.close()
  }
})
