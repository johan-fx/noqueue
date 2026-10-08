import { resolveFixtureLocation } from '../helpers/location.js'
import { test, expect } from '../fixtures.js'
test('mobile full declaration, quick release, pause, nested advanced keyboard tabs and desktop layout', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  test.setTimeout(90000)
  const serviceName =
    'Restaurante EH Hotel Madrid · Terraza e interior para familias y grupos de visitantes'
  await page.setViewportSize({ width: 360, height: 844 })
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  const password = 'test-opening-password-long',
    sales = `sales_${suffix}`,
    owner = `owner_${suffix}`
  const pilot = {
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
  const headers = { Origin: baseURL! }
  expect(
    (
      await request.post('/api/v1/auth/sign-in/username', {
        headers,
        data: { username: sales, password },
      })
    ).ok(),
  ).toBeTruthy()
  const created = await request.post('/api/v1/staff/commercial/organizations', {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      ...(await resolveFixtureLocation(request, baseURL!)),
      organizationName: 'Opening test',
      slug: `opening-${suffix}`,
      venueName: 'Hotel Opening',
      timezone: 'Europe/Madrid',
      ownerName: 'Owner',
      ownerUsername: owner,
      ownerPassword: password,
      services: [
        {
          name: serviceName,
          type: 'restaurant',
          capacity: 30,
          averageMinutes: 30,
          graceMinutes: 5,
          cutoffMinutes: 0,
          twentyFourHours: true,
          schedules: [],
          receptionServices: [],
          spaces: [
            {
              id: 'terrace',
              name: 'Terraza',
              tables: 2,
              tableTypes: [{ seats: 4, count: 2, averageMinutes: 50 }],
            },
            {
              id: 'salon',
              name: 'Salón',
              tables: 1,
              tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
            },
          ],
        },
      ],
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { venueId } = (await created.json()) as { venueId: string }
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const card = page.getByRole('article', {
    name: `Servicio ${serviceName}`,
    exact: true,
  })
  const activate = card.getByRole('switch', {
    name: 'Activar lista',
    exact: true,
  })
  await expect(activate).toBeInViewport()
  await expect(
    card.getByText('Servicio abierto', { exact: true }),
  ).toBeVisible()
  await expect(card.getByText('Lista inactiva', { exact: true })).toBeVisible()
  await expect(
    card.getByText('Actívala cuando el restaurante esté lleno.'),
  ).toBeVisible()
  await expect(page.getByRole('spinbutton')).toHaveCount(0)
  await expect(card.locator('dd').first()).toHaveText('0')
  await expect(card.locator('img')).toHaveCount(2)
  for (const asset of await card.locator('img').all()) {
    expect(
      await asset.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return [box.width, box.height]
      }),
    ).toEqual([16, 16])
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('service-card-mobile.png'),
  })
  await activate.click()
  await expect(card.getByText('Lista activa', { exact: true })).toBeVisible()
  const gear = card.getByRole('button', {
    name: 'Opciones del servicio',
    exact: true,
  })
  await gear.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Mesa libre', exact: true }).click()
  let sheet = page.getByRole('dialog', {
    name: `Mesa libre · ${serviceName}`,
    exact: true,
  })
  const queues = (await (
    await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)
  ).json()) as { id: string }[]
  const queueId = queues[0]!.id
  const context = async () =>
    (await (
      await page.request.get(`/api/v1/staff/queues/${queueId}/opening-context`)
    ).json()) as { groups: { spaceId: string; occupied: number }[] }
  expect((await context()).groups.map((g) => g.occupied)).toEqual([2, 1])
  await sheet.getByRole('combobox', { name: 'Grupo de mesas' }).click()
  await page.getByRole('option', { name: 'Terraza · 4 plazas' }).click()
  await expect(sheet).toBeVisible()
  const releaseResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/v1/staff/queues/${queueId}/lifecycle`),
  )
  await sheet
    .getByRole('button', { name: 'Liberar una mesa', exact: true })
    .click()
  expect((await releaseResponse).ok()).toBeTruthy()
  await expect
    .poll(async () => (await context()).groups.map((g) => g.occupied))
    .toEqual([1, 1])
  await expect(gear).toBeFocused()
  const added = await page.request.post(
    `/api/v1/public/services/${queueId}/entries`,
    {
      headers: { Origin: baseURL!, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        displayName: 'Card guest',
        partySize: 4,
        preferredSpaceId: 'fastest',
        locale: 'es',
        whatsapp: {
          consent: true,
          phone: '+34600000000',
          version: 'whatsapp-public-service-updates-v1',
        },
      },
    },
  )
  expect(added.status(), await added.text()).toBe(201)
  const pending = (await added.json()) as { recoveryToken: string }
  const close = card.getByRole('switch', { name: 'Cerrar lista', exact: true })
  let closingRequests = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith(`/${queueId}/lifecycle`))
      closingRequests++
  })
  await close.click()
  const confirmation = page.getByRole('alertdialog', {
    name: 'Vas a cerrar la lista',
    exact: true,
  })
  await expect(
    confirmation.getByText(
      'Se deshabilitará la opción de añadir nuevos turnos y los clientes no podrán inscribirse. Los turnos existentes se conservarán y podrán seguir atendiéndose.',
    ),
  ).toBeVisible()
  await expect(
    confirmation.getByText('Esta acción no se puede deshacer'),
  ).toHaveCount(0)
  await expect(
    confirmation.getByRole('button', { name: 'Cerrar lista', exact: true }),
  ).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect
    .poll(() =>
      confirmation.locator('img').evaluate((element) => {
        const box = element.getBoundingClientRect()
        return [box.width, box.height]
      }),
    )
    .toEqual([16, 16])
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('service-card-confirm-mobile.png'),
  })
  await confirmation
    .getByRole('button', { name: 'Cancelar', exact: true })
    .click()
  await expect(close).toBeFocused()
  expect(closingRequests).toBe(0)
  await expect(close).toBeChecked()
  await close.click()
  await confirmation
    .getByRole('button', { name: 'Cerrar lista', exact: true })
    .click()
  await expect(card.getByText('Lista pausada', { exact: true })).toBeVisible()
  expect((await context()).groups.map((g) => g.occupied)).toEqual([1, 1])
  const retained = await page.request.get(
    `/api/v1/public/entries/${pending.recoveryToken}`,
  )
  expect((await retained.json()).status).toBe('waiting')
  await expect(card.locator('dd').first()).toHaveText('1')
  await card
    .getByRole('switch', { name: 'Reanudar lista', exact: true })
    .click()
  await expect(card.getByText('Lista activa', { exact: true })).toBeVisible()
  expect((await context()).groups.map((g) => g.occupied)).toEqual([1, 1])
  const advancedTrigger = gear
  await advancedTrigger.click()
  await page
    .getByRole('menuitem', { name: 'Configuración avanzada', exact: true })
    .click()
  const advanced = page.getByRole('dialog', {
    name: 'Configuración avanzada',
    exact: true,
  })
  await expect(advanced).toHaveAttribute('data-swipe-direction', 'right')
  const policy = advanced.getByRole('button', {
    name: 'Desactivar gestión inteligente',
    exact: true,
  })
  await policy.click()
  sheet = page.getByRole('dialog', {
    name: `Desactivar gestión inteligente · ${serviceName}`,
    exact: true,
  })
  await page.keyboard.press('Escape')
  await expect(policy).toBeFocused()
  await policy.click()
  await page
    .getByRole('dialog', {
      name: `Desactivar gestión inteligente · ${serviceName}`,
      exact: true,
    })
    .getByRole('button', {
      name: 'Desactivar gestión inteligente',
      exact: true,
    })
    .click()
  await expect(
    advanced.getByText('Desactivada manualmente', { exact: true }),
  ).toBeVisible()
  await advanced
    .getByRole('button', { name: 'Volver a gestión automática', exact: true })
    .click()
  await page
    .getByRole('dialog', {
      name: `Volver a gestión automática · ${serviceName}`,
      exact: true,
    })
    .getByRole('button', { name: 'Volver a gestión automática', exact: true })
    .click()
  await advanced
    .getByRole('button', {
      name: 'Desglose y correcciones de ocupación',
      exact: true,
    })
    .click()
  sheet = page.getByRole('dialog', {
    name: `Actualizar ocupación · ${serviceName}`,
    exact: true,
  })
  const terrace = sheet.getByRole('tab', { name: 'Terraza' })
  await terrace.focus()
  await page.keyboard.press('ArrowRight')
  await expect(sheet.getByRole('tab', { name: 'Salón' })).toBeFocused()
  await page.keyboard.press('Enter')
  await sheet
    .getByRole('tabpanel', { name: 'Salón', exact: true })
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(
    sheet.getByLabel('Salón · 4 plazas ocupadas fuera de la lista'),
  ).toHaveValue('1')
  await sheet
    .getByRole('tabpanel', { name: 'Salón', exact: true })
    .getByRole('button', { name: 'Liberar uno', exact: true })
    .click()
  await sheet
    .getByRole('button', { name: 'Guardar cambio', exact: true })
    .click()
  await expect(sheet).toHaveCount(0)
  await expect(
    advanced.getByRole('button', {
      name: 'Desglose y correcciones de ocupación',
      exact: true,
    }),
  ).toBeFocused()
  await advanced.getByRole('button', { name: 'Atrás', exact: true }).click()
  await expect(advancedTrigger).toBeFocused()
  expect((await context()).groups.map((g) => g.occupied)).toEqual([1, 0])
  await expect(card.getByRole('button', { name: 'Ver lista' })).toBeEnabled()
  await page.setViewportSize({ width: 1280, height: 900 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('service-card-desktop.png'),
  })
  await card.getByRole('switch', { name: 'Cerrar lista', exact: true }).click()
  await expect(confirmation).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('service-card-confirm-desktop.png'),
  })
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancelar', exact: true })
    .click()
})
