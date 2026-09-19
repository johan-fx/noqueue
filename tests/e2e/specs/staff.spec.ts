import { test, expect } from '@playwright/test'
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
  await page
    .getByRole('button', { name: 'Crear establecimiento', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: '1. Cliente y administrador',
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
  await page
    .getByLabel('Identificador único (sin espacios)')
    .fill(`hotel-${suffix}`)
  await page
    .getByLabel('Hotel / establecimiento', { exact: true })
    .fill('Hotel Madrid E2E')
  await page.getByLabel('Nombre del administrador').fill('Owner E2E')
  await page.getByLabel('Usuario del administrador').fill(owner)
  await page.getByLabel('Contraseña inicial').fill(password)
  await page
    .getByRole('button', { name: 'Crear establecimiento', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: '2. Configuración de servicios',
      exact: true,
    }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Añadir servicio', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('Nombre del servicio').fill('Restaurante E2E')
  await page.getByRole('button', { name: 'Atrás', exact: true }).click()
  await expect(page.getByLabel('Usuario del administrador')).toHaveValue(owner)
  await page
    .getByRole('button', { name: 'Crear establecimiento', exact: true })
    .click()
  await expect(page.getByLabel('Nombre del servicio')).toHaveValue(
    'Restaurante E2E',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  const save = page.getByRole('button', {
    name: 'Añadir servicio',
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
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Servicio temporalmente no disponible',
  )
  await expect(page.getByLabel('Nombre del servicio')).toHaveValue(
    'Restaurante E2E',
  )
  await page
    .getByRole('button', { name: 'Añadir servicio', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(
    page.getByRole('cell', { name: 'Hotel Madrid E2E', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Establecimiento creado')
  await page.getByRole('button', { name: 'Gestionar accesos' }).click()
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
    page.getByRole('button', { name: 'Gestionar accesos' }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Gestionar accesos' }).click()
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
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Hotel Madrid E2E', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Configurar servicio' }),
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
      .getByRole('button', { name: 'Gestionar cola' }),
  ).toBeInViewport()
  await page.screenshot({
    path: testInfo.outputPath('service-cards-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page
    .getByRole('button', { name: 'Gestionar accesos', exact: true })
    .click()
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
    name: 'Añadir servicio',
    exact: true,
  })
  await newService.getByLabel('Nombre del servicio').fill('Borrador')
  await newService
    .getByRole('button', { name: 'Cancelar', exact: true })
    .click()
  await expect(newService).toHaveCount(0)
  await expect(services.getByRole('article')).toHaveCount(1)
  await addService.click()
  await expect(newService.getByLabel('Nombre del servicio')).toHaveValue('')
  await newService
    .getByRole('button', { name: 'Añadir servicio', exact: true })
    .click()
  await expect(newService).toBeVisible()
  await newService.getByLabel('Nombre del servicio').fill('Segundo restaurante')
  await newService
    .getByRole('button', { name: 'Añadir servicio', exact: true })
    .click()
  await expect(newService).toHaveCount(0)
  await expect(services.getByRole('article')).toHaveCount(2)
  await expect(
    services.getByRole('article', { name: 'Servicio Segundo restaurante' }),
  ).toBeVisible()
  const restaurant = services.getByRole('article', {
    name: 'Servicio Restaurante E2E',
  })
  await restaurant.getByRole('button', { name: 'Configurar servicio' }).click()
  const configDrawer = page.getByRole('dialog', { name: 'Configurar servicio' })
  await expect(configDrawer.getByLabel('Nombre del servicio')).toHaveValue(
    'Restaurante E2E',
  )
  await configDrawer
    .getByLabel('Nombre del servicio')
    .fill('Borrador cancelado')
  await configDrawer.getByRole('button', { name: 'Cancelar' }).click()
  await expect(configDrawer).toHaveCount(0)
  await restaurant.getByRole('button', { name: 'Configurar servicio' }).click()
  await expect(configDrawer.getByLabel('Nombre del servicio')).toHaveValue(
    'Restaurante E2E',
  )

  await page.getByRole('button', { name: 'Abrir cola', exact: true }).click()
  await expect(configDrawer.getByText('Abierto', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: testInfo.outputPath('staff-mobile.png'),
    fullPage: true,
  })
  await page.getByRole('combobox', { name: 'Horario', exact: true }).click()
  await page.getByRole('option', { name: '24 horas, todos los días' }).click()
  await expect(
    configDrawer.getByRole('button', { name: 'Guardar configuración' }),
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
  await page.getByRole('button', { name: 'Guardar configuración' }).click()
  await expect(configDrawer.getByRole('alert')).toBeVisible()
  await expect(
    configDrawer.getByRole('combobox', { name: 'Horario', exact: true }),
  ).toContainText('24 horas')
  await page.getByRole('button', { name: 'Guardar configuración' }).click()
  await expect(
    page.getByRole('button', { name: 'Guardar configuración' }),
  ).toHaveCount(0)
  await restaurant.getByRole('button', { name: 'Gestionar cola' }).click()
  const queueDrawer = page.getByRole('dialog', { name: 'Gestionar cola' })
  await expect(queueDrawer).toBeVisible()
  await expect(
    queueDrawer.getByRole('link', { name: 'Abrir enlace público de la cola' }),
  ).toBeVisible()
  const publicURL = await queueDrawer
    .getByRole('link', { name: 'Abrir enlace público de la cola' })
    .getAttribute('href')
  const guest = await page.context().newPage()
  await guest.goto(publicURL!)
  await guest.getByRole('button', { name: 'Unirme a la cola' }).click()
  await expect(guest).toHaveURL(/\/t\//)
  await queueDrawer
    .getByRole('button', { name: 'Actualizar', exact: true })
    .click()
  await queueDrawer.getByRole('button', { name: 'Llamar', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(
    queueDrawer.getByRole('cell', { name: 'called', exact: true }),
  ).toBeVisible()
  await guest.reload()
  await expect(
    guest.getByText('Estado: Es tu turno. Acude al servicio.', { exact: true }),
  ).toBeVisible()
  await guest.close()
  await queueDrawer.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(queueDrawer).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('link', { name: 'Ajustes', exact: true }).click()
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
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
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
