import { resolveFixtureLocation } from '../helpers/location.js'
import { test, expect } from '@playwright/test'
test('mobile opening inventory, keyboard tabs, occupied release, and closing confirmation', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  test.setTimeout(60000)
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
          name: 'Restaurante',
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
  expect(
    (
      await request.post('/api/v1/experiments/local/staff/legacy-open', {
        headers: pilot,
        data: { venueId },
      })
    ).ok(),
  ).toBeTruthy()
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const toggle = page.getByRole('switch', { name: 'Abrir cola' })
  await expect(toggle).toBeVisible()
  await expect(toggle).toBeChecked()
  const initialCTA = page
    .getByRole('alert')
    .getByRole('button', { name: 'Confirmar ocupación', exact: true })
  await expect(initialCTA).toBeInViewport()
  const ctaBox = await initialCTA.boundingBox()
  expect(ctaBox!.x).toBeGreaterThanOrEqual(0)
  expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(360)
  await page.screenshot({
    path: testInfo.outputPath('queue-card-mobile.png'),
  })
  await initialCTA.click()
  const initial = page.getByRole('dialog', {
    name: 'Confirmar ocupación · Restaurante',
  })
  await expect(initial).toHaveAttribute('data-side', 'bottom')
  await expect(
    initial.getByRole('button', { name: 'Confirmar ocupación', exact: true }),
  ).toBeDisabled()
  await initial
    .getByRole('button', { name: 'Todas las mesas restantes están libres' })
    .click()
  await initial
    .getByRole('button', { name: 'Confirmar ocupación', exact: true })
    .click()
  await expect(toggle).toBeChecked()
  await expect(page.getByText('Gestión inteligente activa')).toBeVisible()
  const queueDrawer = page.getByRole('dialog', {
    name: 'Gestionar cola',
    exact: true,
  })
  const menuTrigger = queueDrawer.getByRole('button', {
    name: 'Opciones de la cola',
  })
  async function operation(label: string) {
    if (!(await queueDrawer.isVisible()))
      await page
        .getByRole('button', { name: 'Gestionar cola', exact: true })
        .click()
    await menuTrigger.click()
    await expect(page.getByRole('menu')).toBeInViewport()
    const menuBox = await page.getByRole('menu').boundingBox()
    expect(menuBox!.x).toBeGreaterThanOrEqual(0)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(360)
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    return page.getByRole('dialog', {
      name: label + ' · Restaurante',
      exact: true,
    })
  }
  let policy = await operation('Desactivar gestión inteligente')
  await expect(policy).toHaveAttribute('data-side', 'bottom')
  await page.keyboard.press('Escape')
  await expect(queueDrawer).toBeVisible()
  await expect(menuTrigger).toBeFocused()
  policy = await operation('Desactivar gestión inteligente')
  await policy
    .getByRole('button', {
      name: 'Desactivar gestión inteligente',
      exact: true,
    })
    .click()
  await expect(menuTrigger).toBeFocused()
  await queueDrawer.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(toggle).toBeChecked()
  await expect(page.getByText('Desactivada manualmente')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Desactivada manualmente')).toBeVisible()
  policy = await operation('Volver a gestión automática')
  await policy
    .getByRole('button', { name: 'Volver a gestión automática', exact: true })
    .click()
  await expect(menuTrigger).toBeFocused()
  await queueDrawer.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(page.getByText('Gestión inteligente activa')).toBeVisible()

  await toggle.click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cerrar cola', exact: true })
    .click()
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  let sheet = page.getByRole('dialog', { name: 'Abrir cola · Restaurante' })
  await expect(sheet).toHaveAttribute('data-side', 'bottom')
  await sheet.getByRole('button', { name: 'Cancelar' }).click()
  await expect(toggle).not.toBeChecked()
  await expect(toggle).toBeFocused()
  await toggle.click()
  sheet = page.getByRole('dialog', { name: 'Abrir cola · Restaurante' })
  await sheet.getByRole('button', { name: 'Mesas de 4', exact: true }).click()
  await sheet
    .getByLabel('Terraza · 4 plazas ocupadas fuera de la cola')
    .fill('1')
  await expect(
    sheet.getByRole('button', { name: 'Abrir cola', exact: true }),
  ).toBeDisabled()
  const terraceTab = sheet.getByRole('tab', { name: 'Terraza' })
  await terraceTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(sheet.getByRole('tab', { name: 'Salón' })).toBeFocused()
  await page.keyboard.press('Enter')
  await sheet.getByRole('button', { name: 'Mesas de 4', exact: true }).focus()
  await page.keyboard.press('Enter')
  await sheet.getByLabel('Salón · 4 plazas ocupadas fuera de la cola').fill('0')
  await expect(
    sheet.getByRole('button', { name: 'Abrir cola', exact: true }),
  ).toBeInViewport()
  await page.screenshot({
    path: testInfo.outputPath('queue-opening-mobile.png'),
  })
  await sheet.getByRole('button', { name: 'Abrir cola', exact: true }).click()
  await expect(toggle).toBeChecked()
  await expect(page.getByText('Gestión inteligente activa')).toBeVisible()
  sheet = await operation('Actualizar ocupación')
  await sheet.getByRole('button', { name: 'Mesas de 4', exact: true }).click()
  await expect(
    sheet.getByLabel('Terraza · 4 plazas ocupadas fuera de la cola'),
  ).toHaveValue('1')
  await sheet.getByRole('button', { name: 'Liberar uno' }).click()
  await sheet.getByRole('button', { name: 'Guardar cambio' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(queueDrawer).toBeVisible()
  await expect(menuTrigger).toBeFocused()
  await queueDrawer.getByRole('button', { name: 'Volver', exact: true }).click()
  await toggle.click()
  sheet = page.getByRole('dialog', { name: 'Cerrar cola · Restaurante' })
  await expect(
    sheet.getByText(/Los turnos existentes permanecen/),
  ).toBeVisible()
  await sheet.getByRole('button', { name: 'Cancelar' }).click()
  await expect(toggle).toBeChecked()
  await toggle.click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cerrar cola', exact: true })
    .click()
  await expect(toggle).not.toBeChecked()
})
