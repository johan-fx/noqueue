import {
  resolveFixtureLocation,
  confirmFixtureLocation,
} from '../helpers/location.js'
import { fillPublicWhatsAppConsent } from '../helpers/queue-actions.js'
import { test, expect } from '@playwright/test'

// This journey intercepts a failed save; service workers bypass page.route.
test.use({ serviceWorkers: 'block' })
const pilot = 'test-pilot-access-at-least-32-characters'
test('sales provisioning, direct owner access and staff console use passwords and D1', async ({
  page,
  request,
}, testInfo) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 18),
    sales = `sales_${suffix}`,
    owner = `owner_${suffix}`,
    password = 'e2e-only-password-12345'
  const seed = await request.post('/api/v1/experiments/local/staff/identity', {
    headers: { 'X-NoQueue-Pilot-Token': pilot },
    data: { username: sales, password },
  })
  expect(seed.ok(), await seed.text()).toBeTruthy()
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(sales)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Establecimientos', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Crear nuevo' }).click()
  await expect(
    page.getByRole('heading', {
      name: 'Cliente y administrador',
      exact: true,
    }),
  ).toBeVisible()
  await page.getByLabel('Empresa / organización').fill('Borrador cancelado')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('cell', { name: 'Borrador cancelado' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Crear nuevo' }).click()
  await expect(page.getByLabel('Empresa / organización')).toHaveValue('')
  await page.getByLabel('Empresa / organización').fill('Hotel E2E')
  await expect(
    page.getByLabel('Identificador único (sin espacios)'),
  ).toHaveCount(0)
  await expect(page.getByLabel('Zona horaria IANA')).toHaveCount(0)
  await page
    .getByLabel('Hotel / establecimiento', { exact: true })
    .fill('Hotel Madrid E2E')
  await page.getByLabel('Nombre del administrador').fill('Owner E2E')
  await page.getByLabel('Usuario del administrador').fill(owner)
  await page
    .getByLabel('Contraseña inicial (mínimo 15 caracteres)')
    .fill(password)
  await page.getByLabel('Confirmar contraseña').fill(password)
  await confirmFixtureLocation(page)
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  const creationService = page.getByRole('dialog', {
    name: 'Configuración restaurante',
  })
  await expect(creationService).toBeVisible()
  await page.getByLabel('Nombre del servicio').fill('Restaurante E2E')
  await creationService
    .getByRole('button', { name: 'Volver', exact: true })
    .click()
  await expect(page.getByLabel('Usuario del administrador')).toHaveValue(owner)
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await creationService
    .getByLabel('Nombre del servicio')
    .fill('Restaurante E2E')
  for (let step = 0; step < 4; step++)
    await creationService.getByRole('button', { name: 'Siguiente' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  const save = creationService.getByRole('button', {
    name: 'Confirmar',
    exact: true,
  })
  await expect(save).toBeInViewport()
  await page.screenshot({
    path: testInfo.outputPath('commercial-drawer-mobile.png'),
    fullPage: true,
  })
  let firstKey = ''
  await page.route(
    '**/api/v1/staff/commercial/organizations',
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      if (!firstKey) {
        firstKey = route.request().headers()['idempotency-key']!
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'temporarily_unavailable' }),
        })
      }
      expect(route.request().headers()['idempotency-key']).toBe(firstKey)
      await route.continue()
    },
  )
  await save.click()
  await expect(creationService.getByRole('alert')).toContainText(
    'Servicio temporalmente no disponible',
  )
  await expect(creationService).toBeVisible()
  await save.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(
    page.getByRole('link', { name: /Hotel Madrid E2E/ }),
  ).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Establecimiento creado')
  await expect(page.getByRole('button', { name: /Acciones de/ })).toHaveCount(0)
  await expect(
    page.getByRole('navigation', { name: 'Paginación de establecimientos' }),
  ).toHaveCount(0)
  await page.getByRole('link', { name: /Hotel Madrid E2E/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Hotel Madrid E2E', exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Opciones del servicio' }).click()
  await page.getByRole('menuitem', { name: 'Configurar servicio' }).click()
  const initialConfigDrawer = page.getByRole('dialog', {
    name: 'Configuración restaurante',
  })
  await expect(initialConfigDrawer).toBeVisible()
  await expect(
    initialConfigDrawer.getByLabel('Nombre del servicio'),
  ).toHaveValue('Restaurante E2E')
  await initialConfigDrawer
    .getByRole('button', { name: 'Volver', exact: true })
    .click()
  await expect(initialConfigDrawer).toHaveCount(0)
  await page.getByRole('button', { name: 'Accesos', exact: true }).click()
  const accessDrawer = page.getByRole('dialog', { name: 'Gestionar accesos' })
  await expect(accessDrawer).toBeVisible()
  await expect(accessDrawer.getByText(owner, { exact: true })).toBeVisible()
  await accessDrawer.getByLabel('Nombre', { exact: true }).fill('Personal E2E')
  await accessDrawer
    .getByLabel('Usuario', { exact: true })
    .fill(`staff_${suffix}`)
  await accessDrawer
    .getByLabel('Contraseña inicial (15 caracteres)')
    .fill(password)
  await accessDrawer
    .getByRole('button', { name: 'Crear acceso', exact: true })
    .click()
  const memberRow = accessDrawer
    .getByRole('row')
    .filter({ hasText: 'Personal E2E' })
  await expect(memberRow).toBeVisible()
  await memberRow.getByRole('button', { name: 'Revocar acceso' }).click()
  await expect(
    memberRow.getByRole('button', { name: 'Restaurar acceso' }),
  ).toBeVisible()
  await memberRow.getByRole('button', { name: 'Restaurar acceso' }).click()
  await expect(
    memberRow.getByRole('button', { name: 'Revocar acceso' }),
  ).toBeVisible()
  await memberRow
    .getByRole('button', { name: 'Restablecer contraseña' })
    .click()
  const resetDialog = page.getByRole('dialog', {
    name: 'Restablecer acceso de Personal E2E',
  })
  await expect(resetDialog).toBeVisible()
  await resetDialog
    .getByLabel('Nueva contraseña (mínimo 15 caracteres)')
    .fill('reset-staff-e2e-password-12345')
  await resetDialog
    .getByRole('button', { name: 'Confirmar restablecimiento' })
    .click()
  await expect(resetDialog).toHaveCount(0)
  await expect(accessDrawer).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    accessDrawer.getByRole('button', { name: 'Cerrar', exact: true }),
  ).toBeInViewport()
  await page.screenshot({
    path: testInfo.outputPath('access-drawer-mobile.png'),
    fullPage: true,
  })
  await accessDrawer
    .getByRole('button', { name: 'Cerrar', exact: true })
    .click()
  await expect(accessDrawer).toHaveCount(0)
  await expect(page.getByLabel('Usuario', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Accesos', exact: true }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Accesos', exact: true }).click()
  await expect(accessDrawer.getByLabel('Usuario', { exact: true })).toHaveValue(
    '',
  )
  await expect(
    accessDrawer.getByText(`staff_${suffix}`, { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(accessDrawer).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    path: testInfo.outputPath('commercial.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Hotel Madrid E2E', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Opciones del servicio' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Establecimientos', exact: true }),
  ).toHaveCount(0)
  await page.screenshot({
    path: testInfo.outputPath('staff.png'),
    fullPage: true,
  })
  const services = page.getByRole('region', { name: 'Listado de servicios' })
  await expect(services.getByRole('article')).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    services
      .getByRole('article', { name: 'Servicio Restaurante E2E' })
      .getByRole('button', { name: 'Ver lista' }),
  ).toBeInViewport()
  await page.screenshot({
    path: testInfo.outputPath('service-cards-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Accesos', exact: true }).click()
  const ownerAccess = page.getByRole('dialog', { name: 'Gestionar accesos' })
  await expect(ownerAccess.getByText(owner, { exact: true })).toBeVisible()
  await ownerAccess.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(ownerAccess).toHaveCount(0)

  const addService = page.getByRole('button', {
    name: 'Añadir servicio',
    exact: true,
  })
  await addService.click()
  const newService = page.getByRole('dialog', {
    name: 'Configuración restaurante',
    exact: true,
  })
  await newService.getByLabel('Nombre del servicio').fill('Borrador')
  await newService.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(newService).toHaveCount(0)
  await expect(services.getByRole('article')).toHaveCount(1)
  await addService.click()
  await expect(newService.getByLabel('Nombre del servicio')).toHaveValue('')
  await newService
    .getByRole('button', { name: 'Siguiente', exact: true })
    .click()
  await expect(newService).toBeVisible()
  await newService.getByLabel('Nombre del servicio').fill('Segundo restaurante')
  for (let step = 0; step < 4; step++)
    await newService
      .getByRole('button', { name: 'Siguiente', exact: true })
      .click()
  await newService
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click()
  await expect(newService).toHaveCount(0)
  await expect(services.getByRole('article')).toHaveCount(2)
  await expect(
    services.getByRole('article', { name: 'Servicio Segundo restaurante' }),
  ).toBeVisible()
  const restaurant = services.getByRole('article', {
    name: 'Servicio Restaurante E2E',
  })
  await restaurant
    .getByRole('button', { name: 'Opciones del servicio' })
    .click()
  await page.getByRole('menuitem', { name: 'Configurar servicio' }).click()
  const configDrawer = page.getByRole('dialog', {
    name: 'Configuración restaurante',
  })
  await expect(configDrawer.getByLabel('Nombre del servicio')).toHaveValue(
    'Restaurante E2E',
  )
  await configDrawer
    .getByLabel('Nombre del servicio')
    .fill('Borrador cancelado')
  await configDrawer.getByRole('button', { name: 'Volver' }).click()
  await expect(configDrawer).toHaveCount(0)
  await restaurant.getByRole('switch', { name: 'Activar lista' }).click()
  await expect(
    restaurant.getByRole('switch', { name: 'Cerrar lista' }),
  ).toBeChecked()
  await restaurant
    .getByRole('button', { name: 'Opciones del servicio' })
    .click()
  await page.getByRole('menuitem', { name: 'Configurar servicio' }).click()
  await expect(configDrawer.getByLabel('Nombre del servicio')).toHaveValue(
    'Restaurante E2E',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: testInfo.outputPath('staff-mobile.png'),
    fullPage: true,
  })
  await configDrawer
    .getByRole('switch', { name: '24 horas, todos los días' })
    .click()
  for (let step = 0; step < 4; step++)
    await configDrawer.getByRole('button', { name: 'Siguiente' }).click()
  await expect(
    configDrawer.getByRole('button', { name: 'Confirmar' }),
  ).toBeInViewport()
  await page.route('**/api/v1/staff/queues/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'temporary_failure' }),
      })
      await page.unroute('**/api/v1/staff/queues/*')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(configDrawer.getByRole('alert')).toBeVisible()
  await expect(configDrawer.getByText('24 horas, todos los días')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByRole('button', { name: 'Confirmar' })).toHaveCount(0)
  await restaurant.getByRole('button', { name: 'Ver lista' }).click()
  const queueDrawer = page.getByRole('dialog', { name: 'Gestionar lista' })
  await expect(queueDrawer).toBeVisible()
  await expect(
    queueDrawer.getByRole('link', {
      name: 'Abrir enlace público de la lista',
    }),
  ).toBeVisible()
  const publicURL = await queueDrawer
    .getByRole('link', { name: 'Abrir enlace público de la lista' })
    .getAttribute('href')
  const guest = await page.context().newPage()
  await guest.goto(publicURL!)
  await guest.getByLabel('Nombre', { exact: true }).fill('Cliente E2E')
  await fillPublicWhatsAppConsent(guest)
  await guest.getByRole('button', { name: 'Ponerme en lista' }).click()
  await expect(guest).toHaveURL(/\/t\//)
  await queueDrawer
    .getByRole('button', { name: 'Actualizar', exact: true })
    .click()
  await expect(
    queueDrawer.getByRole('button', { name: 'Avanzar un turno' }),
  ).toBeEnabled()
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('queue-list-mobile.png'),
    fullPage: true,
  })
  await queueDrawer
    .getByRole('button', { name: 'Avanzar un turno', exact: true })
    .click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(queueDrawer.getByText('Llamado', { exact: true })).toBeVisible()
  await guest.reload()
  await expect(
    guest.getByText('Estado: Es tu turno. Acude al servicio.', {
      exact: true,
    }),
  ).toBeVisible()
  await queueDrawer.getByRole('button', { name: /^Acciones del turno/ }).click()
  await queueDrawer
    .getByRole('button', { name: 'Confirmar llegada', exact: true })
    .click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await queueDrawer
    .getByRole('tab', { name: 'Completados', exact: true })
    .click()
  await expect(
    queueDrawer.getByRole('tab', { name: 'Completados', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    queueDrawer.getByText('En servicio', { exact: true }),
  ).toBeVisible()
  await queueDrawer.getByRole('button', { name: /^Acciones del turno/ }).click()
  await queueDrawer
    .getByRole('button', { name: 'Liberar recurso', exact: true })
    .click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(
    queueDrawer.getByText('Completado', { exact: true }),
  ).toBeVisible()
  await guest.reload()
  await expect(
    guest.getByText('Estado: Servicio finalizado', { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('queue-completed-mobile.png'),
    fullPage: true,
  })
  await queueDrawer
    .getByRole('tab', { name: 'Cancelados', exact: true })
    .click()
  await expect(
    queueDrawer.getByText('No hay turnos cancelados ni ausentes.'),
  ).toBeVisible()
  await queueDrawer.getByRole('tab', { name: 'Lista', exact: true }).click()
  await expect(
    queueDrawer.getByRole('button', { name: 'Avanzar un turno' }),
  ).toBeDisabled()
  await guest.close()
  await queueDrawer.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(queueDrawer).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ajustes', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Cambiar email', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Nombre', { exact: true }).fill('Owner Updated')
  await page.getByRole('button', { name: 'Guardar cambios' }).first().click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Cambios guardados.' }),
  ).toBeVisible()
  await page
    .getByLabel('Email', { exact: true })
    .fill(`real-${suffix}@example.com`)
  await page.getByRole('button', { name: 'Guardar cambios' }).last().click()
  await expect(
    page.getByText('Revisa el nuevo email', { exact: false }),
  ).toBeVisible()
  const mail = await request.get(
    `/api/v1/experiments/local/staff/mail?email=real-${suffix}@example.com`,
    { headers: { 'X-NoQueue-Pilot-Token': pilot } },
  )
  const verificationURL = (await mail.json()).text.match(/http:\/\/[^\s]+/)[0]
  expect(new URL(verificationURL).pathname).toBe('/api/v1/auth/verify-email')
  await page.goto(verificationURL)
  await expect(page).toHaveURL(/\/settings\/account/)
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    `real-${suffix}@example.com`,
  )
  await page.getByRole('tab', { name: /seguridad/i }).click()
  await page.getByLabel('Contraseña actual', { exact: true }).fill(password)
  await page
    .getByLabel('Nueva contraseña', { exact: true })
    .fill('changed-e2e-password-12345')
  await page
    .getByLabel('Confirmar contraseña', { exact: true })
    .fill('changed-e2e-password-12345')
  await page
    .getByRole('tabpanel', { name: 'Seguridad' })
    .getByRole('button', { name: 'Guardar cambios' })
    .click()
  await expect(
    page.getByText('Cambios guardados.', { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('settings.png'),
    fullPage: true,
  })
})

test('settings requires authentication', async ({ page }) => {
  await page.goto('/settings/account')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByLabel('Usuario o email')).toBeVisible()
})

test('space-specific durations and an availability delay survive browser save and reload', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16),
    sales = `sales_${suffix}`,
    owner = `owner_${suffix}`,
    password = 'e2e-only-password-12345'
  const origin = baseURL!
  const seed = await request.post('/api/v1/experiments/local/staff/identity', {
    headers: { 'X-NoQueue-Pilot-Token': pilot },
    data: { username: sales, password },
  })
  expect(seed.ok(), await seed.text()).toBeTruthy()
  const login = await request.post('/api/v1/auth/sign-in/username', {
    headers: { Origin: origin },
    data: { username: sales, password },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const provision = await request.post(
    '/api/v1/staff/commercial/organizations',
    {
      headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        ...(await resolveFixtureLocation(request, origin)),
        organizationName: 'Timing Test',
        slug: `timing-${suffix}`,
        venueName: 'Timing Venue',
        timezone: 'Europe/Madrid',
        ownerName: 'Timing Owner',
        ownerUsername: owner,
        ownerPassword: password,
        services: [
          {
            name: 'Timing Restaurant',
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
                tableTypes: [{ seats: 4, count: 1, averageMinutes: 35 }],
              },
              {
                id: 'salon',
                name: 'Salon',
                tables: 1,
                tableTypes: [{ seats: 4, count: 1, averageMinutes: 25 }],
              },
              {
                id: 'patio',
                name: 'Patio exterior junto a la piscina',
                tables: 1,
                tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }],
              },
              {
                id: 'events',
                name: 'Sala para eventos privados',
                tables: 1,
                tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }],
              },
            ],
          },
        ],
      },
    },
  )
  expect(provision.ok(), await provision.text()).toBeTruthy()
  const { venueId } = (await provision.json()) as { venueId: string }
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Timing Venue', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Opciones del servicio' }).click()
  await page
    .getByRole('menuitem', { name: 'Configurar servicio', exact: true })
    .click()
  const drawer = page.getByRole('dialog', {
    name: 'Configuración restaurante',
    exact: true,
  })
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer
    .getByRole('button', { name: 'Configuración avanzada', exact: true })
    .click()
  const advanced = page.getByRole('dialog', {
    name: 'Configuración avanzada',
    exact: true,
  })
  await expect(advanced.getByLabel('Plazo de llegada (minutos)')).toHaveValue(
    '5',
  )
  await expect(advanced.getByLabel('Turnos por delante')).toHaveValue('2')
  await expect(
    advanced.getByLabel('Cambio mínimo de estimación (min)'),
  ).toHaveValue('5')
  await expect(
    advanced.getByLabel('Intervalo mínimo entre cambios (min)'),
  ).toHaveValue('10')
  await page.setViewportSize({ width: 390, height: 844 })
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await advanced.getByLabel('Terrace · 4 plazas (min)').fill('99')
  await advanced.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(advanced).toHaveCount(0)
  await expect(
    drawer.getByRole('button', {
      name: 'Configuración avanzada',
      exact: true,
    }),
  ).toBeFocused()
  await drawer
    .getByRole('button', { name: 'Configuración avanzada', exact: true })
    .click()
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(advanced.getByLabel('Terrace · 4 plazas (min)')).toHaveValue(
    '35',
  )
  await advanced.getByLabel('Terrace · 4 plazas (min)').fill('70')
  await advanced.getByRole('tab', { name: 'Terrace', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(
    advanced.getByRole('tab', { name: 'Salon', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    advanced.getByRole('tab', { name: 'Salon', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    advanced.getByRole('tabpanel', { name: 'Salon', exact: true }),
  ).toBeVisible()
  await expect(
    advanced.getByRole('tabpanel', { name: 'Terrace', exact: true }),
  ).toBeHidden()
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(advanced.getByLabel('Terrace · 4 plazas (min)')).toHaveCount(0)
  await advanced.getByLabel('Salon · 4 plazas (min)').fill('20')
  await advanced.getByRole('tab', { name: 'Terrace', exact: true }).click()
  await expect(
    advanced.getByRole('tabpanel', { name: 'Salon', exact: true }),
  ).toBeHidden()
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(advanced.getByLabel('Terrace · 4 plazas (min)')).toHaveValue(
    '70',
  )
  await expect(
    advanced
      .getByRole('button', { name: 'Mesas de 4', exact: true })
      .locator('span'),
  ).toHaveCSS('font-size', '18px')
  await advanced
    .getByRole('heading', { name: 'Configuración avanzada', exact: true })
    .hover()
  await advanced.getByRole('tab', { name: 'Terrace', exact: true }).focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(
    advanced.getByRole('tab', {
      name: 'Sala para eventos privados',
      exact: true,
    }),
  ).toBeInViewport()
  await expect(
    advanced.getByRole('tabpanel', {
      name: 'Sala para eventos privados',
      exact: true,
    }),
  ).toBeVisible()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect(
    advanced.getByRole('tabpanel', {
      name: 'Sala para eventos privados',
      exact: true,
    }),
  ).toBeHidden()
  await expect(
    advanced.getByRole('tab', { name: 'Terrace', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await page.screenshot({
    path: testInfo.outputPath('queue-advanced-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await advanced
    .getByRole('button', { name: 'Opciones de operación', exact: true })
    .click()
  const adjustment = advanced.getByRole('group', {
    name: 'Ajuste Terrace · 4 plazas',
    exact: true,
  })
  await adjustment
    .getByRole('button', { name: 'Añadir ajuste', exact: true })
    .click()
  await adjustment.getByRole('combobox', { name: 'Tipo de ajuste' }).click()
  await page
    .getByRole('option', { name: 'Bloquear disponibilidad hasta caducidad' })
    .click()
  await adjustment
    .getByLabel('Motivo', { exact: true })
    .fill('Terrace cleaning')
  await expect(adjustment.getByLabel('Duración temporal (min)')).toHaveCount(0)
  await expect(advanced.getByLabel('Motor de estimación')).toHaveCount(0)
  await expect(
    advanced.getByLabel(
      'Confirmo que todos los recursos están vacíos al inicializar',
    ),
  ).toHaveCount(0)
  await advanced.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(advanced).toHaveCount(0)
  await expect(drawer.getByRole('spinbutton')).toHaveCount(2)
  await expect(
    drawer.getByRole('button', {
      name: 'Configuración avanzada',
      exact: true,
    }),
  ).toBeFocused()
  await page.screenshot({
    path: testInfo.outputPath('queue-basic-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Terrace', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(drawer).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Opciones del servicio' }).click()
  await page
    .getByRole('menuitem', { name: 'Configurar servicio', exact: true })
    .click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer
    .getByRole('button', { name: 'Configuración avanzada', exact: true })
    .click()
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(advanced.getByLabel('Terrace · 4 plazas (min)')).toHaveValue(
    '70',
  )
  await advanced.getByRole('tab', { name: 'Salon', exact: true }).click()
  await expect(
    advanced.getByRole('tabpanel', { name: 'Terrace', exact: true }),
  ).toBeHidden()
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(advanced.getByLabel('Salon · 4 plazas (min)')).toHaveValue('20')
  await advanced.getByRole('tab', { name: 'Terrace', exact: true }).click()
  await expect(
    advanced.getByRole('tabpanel', { name: 'Salon', exact: true }),
  ).toBeHidden()
  await advanced
    .getByRole('button', { name: 'Opciones de operación', exact: true })
    .click()
  await expect(
    adjustment.getByRole('combobox', { name: 'Tipo de ajuste' }),
  ).toContainText('Bloquear disponibilidad hasta caducidad')
  await expect(adjustment.getByLabel('Motivo', { exact: true })).toHaveValue(
    'Terrace cleaning',
  )
  await page.keyboard.press('Escape')
  await expect(advanced).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await page.getByRole('switch', { name: 'Activar lista' }).click()
  await expect(page.getByRole('switch', { name: 'Cerrar lista' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Cerrar lista' })).toBeEnabled()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const queue = page.getByRole('dialog', {
    name: 'Gestionar lista',
    exact: true,
  })
  const publicURL = await queue
    .getByRole('link', { name: 'Abrir enlace público de la lista' })
    .getAttribute('href')
  const guest = await page.context().newPage()
  await guest.goto(publicURL!)
  await guest.getByLabel('Nombre', { exact: true }).fill('Cliente E2E')
  await fillPublicWhatsAppConsent(guest)
  await guest.getByRole('radio', { name: 'Terrace', exact: true }).check()
  await guest.getByRole('button', { name: 'Ponerme en lista' }).click()
  await expect(guest).toHaveURL(/\/t\//)
  await expect(guest.getByText('Sin estimación', { exact: true })).toBeVisible()
  await queue.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await queue
    .getByRole('button', { name: /^Acciones del turno/ })
    .click()
  await queue.getByRole('button', { name: 'Asignar turno', exact: true }).click()
  const assignment = page.getByRole('dialog', {
    name: 'Asignar turno',
    exact: true,
  })
  await expect(
    assignment.getByText('No hay una mesa compatible disponible.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    assignment.getByRole('button', { name: 'Confirmar', exact: true }),
  ).toBeDisabled()
  await guest.close()
})
