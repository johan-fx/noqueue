import { resolveFixtureLocation } from '../helpers/location.js'
import { fillPublicWhatsAppConsent } from '../helpers/queue-actions.js'
import { test, expect, type Page, type Locator } from '../fixtures.js'
type QueueSummary = { id: string; config: { type: string } }
type StaffEntry = { id: string; code: string }

async function swipe(page: Page, row: Locator, direction: 'left' | 'right') {
  const box = await row.boundingBox()
  const y = box!.y + box!.height * 0.75,
    start = box!.x + (direction === 'left' ? box!.width - 35 : 35),
    end = box!.x + (direction === 'left' ? 35 : box!.width - 35)
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start, y }],
  })
  for (let i = 1; i <= 8; i++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start + ((end - start) * i) / 8, y }],
    })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await session.detach()
}

test('service-specific public/manual joins, filters, swipe sheets and real queue commands on mobile', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 390, height: 844 })
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    sales = `sales_${suffix}`,
    owner = `owner_${suffix}`,
    password = 'queue-services-password-long'
  const headers = { Origin: baseURL! },
    pilot = {
      'X-NoQueue-Pilot-Token': 'test-pilot-access-at-least-32-characters',
    }
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
        headers,
        data: { username: sales, password },
      })
    ).ok(),
  ).toBeTruthy()
  const common = {
    capacity: 40,
    averageMinutes: 20,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [],
    receptionServices: [],
  }
  const created = await request.post('/api/v1/staff/commercial/organizations', {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      ...(await resolveFixtureLocation(request, baseURL!)),
      organizationName: 'Queue services',
      slug: `services-${suffix}`,
      venueName: 'Hotel Services',
      timezone: 'Europe/Madrid',
      ownerName: 'Owner',
      ownerUsername: owner,
      ownerPassword: password,
      services: [
        {
          ...common,
          name: 'Restaurante',
          type: 'restaurant',
          spaces: [
            {
              id: 'interior',
              name: 'Interior',
              tables: 2,
              tableTypes: [{ seats: 4, count: 2 }],
            },
            {
              id: 'terrace',
              name: 'Terraza',
              tables: 1,
              tableTypes: [{ seats: 6, count: 1 }],
            },
          ],
        },
        {
          ...common,
          name: 'Recepción',
          type: 'reception',
          stations: 2,
          receptionServices: ['check_in', 'check_out', 'other'],
        },
        { ...common, name: 'Bar piscina', type: 'pool' },
      ],
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { venueId } = (await created.json()) as { venueId: string }
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Hotel Services', exact: true }),
  ).toBeVisible()
  let queues = (await (
    await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)
  ).json()) as QueueSummary[]
  for (const q of queues) {
    if (q.config.type !== 'restaurant') continue
    const context = (await (
      await page.request.get(`/api/v1/staff/queues/${q.id}/opening-context`)
    ).json()) as {
      contextToken: string
      groups: { spaceId: string; seats: number }[]
    }
    const response = await page.request.post(
      `/api/v1/staff/queues/${q.id}/lifecycle`,
      {
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          action: 'declare_full',
          contextToken: context.contextToken,
        },
      },
    )
    expect(response.ok(), await response.text()).toBeTruthy()
    for (const group of context.groups) {
      const current = (await (
        await page.request.get(`/api/v1/staff/queues/${q.id}/opening-context`)
      ).json()) as { contextToken: string }
      const freed = await page.request.post(
        `/api/v1/staff/queues/${q.id}/lifecycle`,
        {
          headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            action: 'occupancy',
            contextToken: current.contextToken,
            group: { ...group, occupied: 0 },
            reason: 'Fixture physical capacity update',
          },
        },
      )
      expect(freed.ok(), await freed.text()).toBeTruthy()
    }
  }
  await page.reload()
  const restaurant = queues.find((q) => q.config.type === 'restaurant')!,
    reception = queues.find((q) => q.config.type === 'reception')!,
    pool = queues.find((q) => q.config.type === 'pool')!
  for (const quick of [reception, pool]) {
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/v1/staff/queues/${quick.id}/opening-context`,
          )
          if (!response.ok()) return `http-${response.status()}`
          const context = (await response.json()) as { queueState?: string }
          return context.queueState
        },
        { timeout: 15_000 },
      )
      .toBe('active')
  }
  const guest = await page.context().newPage()
  await guest.goto(`/q/${restaurant.id}`)
  await guest.getByLabel('Nombre', { exact: true }).fill('María López')
  await fillPublicWhatsAppConsent(guest)
  for (let i = 0; i < 3; i++)
    await guest.getByRole('button', { name: 'Más comensales' }).click()
  await guest.getByRole('radio', { name: 'Terraza' }).click()
  await guest.getByRole('button', { name: 'Ponerme en lista' }).click()
  await expect(guest).toHaveURL(/\/t\//)
  await page
    .getByRole('article', { name: 'Servicio Restaurante', exact: true })
    .getByRole('button', { name: 'Ver lista' })
    .click()
  const drawer = page.getByRole('dialog', {
    name: 'Gestionar lista',
    exact: true,
  })
  await expect(drawer.getByText('María López')).toBeVisible()
  await expect(
    drawer.getByText('Terraza · Preferido', { exact: true }),
  ).toBeVisible()
  await drawer.getByRole('button', { name: 'Añadir', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Restaurante', exact: true })
  await add.getByLabel('Nombre', { exact: true }).fill('Daniel García')
  await expect(add).toHaveAttribute('data-swipe-axis', 'x')
  await expect(add.getByRole('switch')).not.toBeChecked()
  await expect(add.getByLabel('Número de comensales')).toHaveValue('1')
  await add.getByRole('button', { name: 'Más comensales' }).click()
  const country = add.getByRole('combobox', { name: 'País' })
  await expect(country).toHaveAttribute('aria-valuetext', 'España, +34')
  await country.click()
  const countrySearch = page.getByRole('combobox', { name: 'Buscar país' })
  await countrySearch.fill('Francia')
  await expect(page.getByRole('option', { name: /Francia/ })).toBeVisible()
  await countrySearch.press('Escape')
  await expect(add).toBeVisible()
  await expect(country).toBeFocused()
  await add.getByLabel('Nº de teléfono', { exact: true }).fill('600000000')
  await add.getByRole('switch').click()
  await expect(add).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: testInfo.outputPath('manual-restaurant-mobile.png'),
    fullPage: false,
    animations: 'disabled',
  })
  // Simulate a lost response AFTER the actual server-side creation; retry must replay it.
  let firstKey = ''
  await page.route(
    `**/api/v1/staff/queues/${restaurant.id}/entries`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const key = route.request().headers()['idempotency-key']!
      if (!firstKey) {
        firstKey = key
        await route.fetch()
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'temporarily_unavailable' }),
        })
      }
      expect(key).toBe(firstKey)
      await route.continue()
    },
  )
  await add.getByRole('button', { name: 'Añadir turno' }).click()
  await expect(add.getByRole('alert')).toBeVisible()
  await add.getByRole('button', { name: 'Añadir turno' }).click()
  const result = add
  await expect(
    result.getByRole('heading', { name: 'Turno añadido' }),
  ).toBeVisible()
  await expect(result.getByLabel('Enlace del turno')).toHaveValue(
    /\/t\/[a-f0-9]{64}/,
  )
  await result.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(
    drawer.getByRole('button', { name: 'Añadir', exact: true }),
  ).toBeFocused()
  const list = (await (
    await page.request.get(`/api/v1/staff/queues/${restaurant.id}/entries`)
  ).json()) as StaffEntry[]
  expect(list).toHaveLength(2)
  await drawer.getByRole('button', { name: 'Filtrar 2 personas' }).click()
  await expect(drawer.getByText('Daniel García')).toBeVisible()
  await expect(drawer.getByText('María López')).toHaveCount(0)
  await expect(drawer.getByLabel('Posición 2')).toBeVisible()
  await drawer.getByRole('button', { name: 'Filtrar Todos' }).click()
  await page.screenshot({
    path: testInfo.outputPath('restaurant-mobile.png'),
    fullPage: false,
    animations: 'disabled',
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy()
  const maria = drawer.locator('li').filter({ hasText: 'María López' })
  await swipe(page, maria, 'left')
  await expect(
    maria.getByRole('button', { name: 'Cancelar turno', exact: true }),
  ).toBeVisible()
  await expect(drawer).toBeVisible()
  await maria
    .getByRole('button', { name: 'Cancelar turno', exact: true })
    .click()
  const cancel = page.getByRole('dialog', {
    name: '¿Estás seguro de que quieres cancelar el turno?',
  })
  await expect(cancel).toHaveAttribute('data-side', 'bottom')
  await expect(cancel).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: testInfo.outputPath('cancel-sheet-mobile.png'),
    fullPage: false,
    animations: 'disabled',
  })
  await cancel.getByRole('button', { name: 'No cancelar' }).click()
  await expect(
    maria.getByRole('button', { name: /Acciones del turno/ }),
  ).toBeFocused()
  // Calling uses the binding preferred space; confirmation is only available once called.
  await swipe(page, maria, 'right')
  await maria.getByRole('button', { name: /Acciones del turno/ }).click()
  await maria
    .getByRole('button', { name: 'Asignar turno', exact: true })
    .click()
  await page
    .getByRole('dialog', { name: 'Asignar turno', exact: true })
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click()
  await expect(
    maria.getByText('Pendiente de llegada', { exact: true }),
  ).toBeVisible()
  await maria.getByRole('button', { name: /Acciones del turno/ }).click()
  await swipe(page, maria, 'right')
  await expect(drawer).toBeVisible()
  await maria
    .getByRole('button', { name: 'Confirmar llegada', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Confirmar llegada', exact: true }),
  ).toHaveCount(0)
  await expect(drawer.getByText('María López')).toHaveCount(0)
  await drawer.getByRole('tab', { name: 'Completados' }).click()
  await expect(drawer.getByText('Terraza · Asignado')).toBeVisible()
  await drawer
    .getByRole('tabpanel', { name: 'Completados' })
    .getByRole('button', { name: /Acciones del turno/ })
    .click()
  await drawer.getByRole('button', { name: 'Liberar recurso' }).click()
  await page
    .getByRole('dialog', { name: 'Liberar recurso' })
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click()
  await drawer.getByRole('button', { name: 'Volver', exact: true }).click()
  // Reception public form captures enabled subtypes; no restaurant fields leak across services.
  await guest.goto(`/q/${reception.id}`)
  await guest.getByLabel('Nombre', { exact: true }).fill('Ana Recepción')
  await fillPublicWhatsAppConsent(guest)
  await guest.getByRole('radio', { name: 'Check-out', exact: true }).click()
  await expect(guest.getByLabel('Espacio', { exact: true })).toHaveCount(0)
  await guest.getByRole('button', { name: 'Ponerme en lista' }).click()
  await expect(guest).toHaveURL(/\/t\//)
  await page
    .getByRole('article', { name: 'Servicio Recepción', exact: true })
    .getByRole('button', { name: 'Ver lista' })
    .click()
  await expect(drawer.getByText('Ana Recepción')).toBeVisible()
  await drawer.getByRole('button', { name: 'Añadir', exact: true }).click()
  const receptionAdd = page.getByRole('dialog', {
    name: 'Recepción',
    exact: true,
  })
  await expect(receptionAdd.getByRole('spinbutton')).toHaveCount(0)
  await expect(
    receptionAdd.getByRole('button', { name: 'Check-in', exact: true }),
  ).toBeVisible()
  await expect(receptionAdd).toHaveCSS('opacity', '1')
  await page.screenshot({
    path: testInfo.outputPath('manual-reception-mobile.png'),
    fullPage: false,
    animations: 'disabled',
  })
  await receptionAdd
    .getByRole('button', { name: 'Volver', exact: true })
    .click()
  await expect(drawer).toBeVisible()
  await expect(
    drawer.getByRole('button', { name: 'Añadir', exact: true }),
  ).toBeFocused()
  await drawer.getByRole('button', { name: 'Añadir', exact: true }).click()
  await receptionAdd
    .getByLabel('Nombre', { exact: true })
    .fill('Recepción Manual')
  await receptionAdd
    .getByRole('button', { name: 'Check-out', exact: true })
    .click()
  await receptionAdd.getByRole('button', { name: 'Añadir turno' }).click()
  await expect(
    receptionAdd.getByRole('heading', { name: 'Turno añadido' }),
  ).toBeVisible()
  await receptionAdd
    .getByRole('button', { name: 'Cerrar', exact: true })
    .click()
  await drawer.getByRole('button', { name: 'Filtrar Check-in' }).click()
  await expect(drawer.getByText('Ana Recepción')).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Filtrar Check-out' }).click()
  await expect(drawer.getByText('Ana Recepción')).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('reception-mobile.png'),
    fullPage: false,
    animations: 'disabled',
  })
  await drawer.getByRole('button', { name: 'Volver', exact: true }).click()
  await guest.goto(`/q/${pool.id}`)
  await guest.getByLabel('Nombre', { exact: true }).fill('Piscina Cliente')
  await fillPublicWhatsAppConsent(guest)
  await guest.getByRole('button', { name: 'Ponerme en lista' }).click()
  await expect(guest).toHaveURL(/\/t\//)
  await page
    .getByRole('article', { name: 'Servicio Bar piscina', exact: true })
    .getByRole('button', { name: 'Ver lista' })
    .click()
  await expect(drawer.getByText('Piscina Cliente')).toBeVisible()
  await drawer.getByRole('button', { name: 'Añadir', exact: true }).click()
  const poolAdd = page.getByRole('dialog', {
    name: 'Bar piscina',
    exact: true,
  })
  await expect(poolAdd.getByRole('spinbutton')).toHaveCount(0)
  await expect(
    poolAdd.getByRole('group', { name: 'Tipo de gestión' }),
  ).toHaveCount(0)
  await expect(poolAdd).toHaveCSS('opacity', '1')
  const manualPoolSubmit = poolAdd.getByRole('button', {
    name: 'Añadir turno',
  })
  await expect(manualPoolSubmit).toBeVisible()
  await expect
    .poll(async () => {
      const bounds = await manualPoolSubmit.boundingBox()
      return (
        !!bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 390 &&
        bounds.y + bounds.height <= 844
      )
    })
    .toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('manual-pool-mobile.png'),
    fullPage: false,
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  await expect(drawer).toBeVisible()
  await expect(
    drawer.getByRole('button', { name: 'Añadir', exact: true }),
  ).toBeFocused()
  await drawer.getByRole('button', { name: 'Añadir', exact: true }).click()
  await poolAdd.getByLabel('Nombre', { exact: true }).fill('Piscina Manual')
  await poolAdd.getByRole('button', { name: 'Añadir turno' }).click()
  await expect(
    poolAdd.getByRole('heading', { name: 'Turno añadido' }),
  ).toBeVisible()
  await poolAdd.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(
    drawer.getByRole('group', { name: 'Filtros de la lista' }),
  ).toHaveCount(0)
  const poolRow = drawer.locator('li').filter({ hasText: 'Piscina Cliente' })
  await expect(drawer.getByRole('tab', { name: 'Lista' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const poolAdvance = drawer.getByRole('button', {
    name: 'Asignar próximo turno',
  })
  await expect(poolAdvance).toBeVisible()
  await expect(drawer).toHaveCSS('opacity', '1')
  await expect
    .poll(async () => {
      const bounds = await poolAdvance.boundingBox()
      return (
        !!bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 390 &&
        bounds.y + bounds.height <= 844
      )
    })
    .toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('pool-mobile.png'),
    fullPage: false,
    animations: 'disabled',
  })
  await swipe(page, poolRow, 'right')
  await expect(
    poolRow.getByRole('button', { name: 'Confirmar llegada' }),
  ).toHaveCount(0)
  await poolAdvance.click()
  await expect(poolRow.getByText('Pendiente de llegada')).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Asignar turno', exact: true }),
  ).toHaveCount(0)
  await swipe(page, poolRow, 'left')
  await poolRow
    .getByRole('button', { name: 'Cancelar turno', exact: true })
    .click()
  await cancel
    .getByRole('button', { name: 'Cancelar turno', exact: true })
    .click()
  await drawer.getByRole('tab', { name: 'Cancelados' }).click()
  await expect(drawer.getByText('Piscina Cliente')).toBeVisible()
  queues = (await (
    await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)
  ).json()) as QueueSummary[]
  expect(queues).toHaveLength(3)
  await guest.close()
})
