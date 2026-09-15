import { expect, test } from '@playwright/test'
test.describe.configure({ mode: 'serial' })

// Same deployable UI + DO/D1/outbox. Only WhatsApp transport and customer callback
// are substituted by the local e2e entrypoint; these controls are never deployed.
test('real experiment page drives queue, confirmation, position updates and BAJA', async ({
  page,
  request,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Single shared dedicated experiment queue',
  )
  const mutationRequests: string[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/experiments/confirmation')
    )
      mutationRequests.push(request.url())
  })
  await page.goto('/api/v1/experiments/confirmation')
  await expect(
    page.getByRole('heading', { name: 'Prueba la cola, de principio a fin.' }),
  ).toBeVisible()
  await expect(page.locator('#panel')).toBeHidden()
  expect(mutationRequests).toHaveLength(0)
  await page.getByLabel('Acceso al piloto').fill('incorrect-private-access')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('El acceso no es válido')
  await expect(page.locator('#panel')).toBeHidden()
  await page
    .getByLabel('Acceso al piloto')
    .fill('test-pilot-access-at-least-32-characters')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  let releaseSeed!: () => void
  let seedArrived!: () => void
  const seedAtBoundary = new Promise<void>((resolve) => {
    seedArrived = resolve
  })
  const seedGate = new Promise<void>((resolve) => {
    releaseSeed = resolve
  })
  await page.route('**/experiments/confirmation/seed', async (route) => {
    const response = await route.fetch()
    seedArrived()
    await seedGate
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Preparar tres turnos' }).click()
  await seedAtBoundary
  await expect(page.locator('#seed')).toBeDisabled()
  expect(mutationRequests).toHaveLength(1)
  releaseSeed()
  await expect(page.locator('#entries li')).toHaveCount(3)
  await page.unroute('**/experiments/confirmation/seed')
  await page.getByLabel('Tu teléfono', { exact: true }).fill('+34600000004')
  await page.getByLabel('Personas', { exact: true }).fill('3')
  await page.getByRole('checkbox').check()
  await page.getByLabel('Tu teléfono', { exact: true }).fill('+34611111111')
  await page
    .getByRole('button', { name: 'Crear turno y solicitar CONFIRMO' })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Este entorno todavía restringe',
  )
  await page.getByLabel('Tu teléfono', { exact: true }).fill('+34600000004')
  const joined = page.waitForResponse(
    (r) =>
      r.url().includes('/queues/confirmation-experiment/entries') &&
      r.request().method() === 'POST',
  )
  await page
    .getByRole('button', { name: 'Crear turno y solicitar CONFIRMO' })
    .click()
  const entry = (await (await joined).json()) as {
    recoveryToken: string
    code: string
  }
  const tester = page.locator('#entries li').filter({ hasText: entry.code })
  await expect(page.locator('#guest-position')).toHaveText('4')
  await expect(page.locator('#consent-badge')).toHaveText('Por confirmar')
  await expect(page.locator('#delivery-badge')).toHaveText(
    'Aceptado por WhatsApp',
    { timeout: 30000 },
  )
  async function reply(action: string) {
    const r = await request.post('/api/v1/experiments/local/reply', {
      headers: {
        'X-NoQueue-Pilot-Token': 'test-pilot-access-at-least-32-characters',
      },
      data: { token: entry.recoveryToken, action },
    })
    expect(r.status()).toBe(200)
  }
  await reply('button')
  await expect(tester).toContainText('Avisos activados', { timeout: 30000 })
  const advanceKeys: string[] = []
  await page.route('**/experiments/confirmation/advance', async (route) => {
    advanceKeys.push(route.request().headers()['idempotency-key']!)
    if (advanceKeys.length === 1) {
      await route.fetch()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Avanzar un turno' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'No pudimos comprobar el resultado',
  )
  await page.getByRole('button', { name: 'Avanzar un turno' }).click()
  expect(advanceKeys).toHaveLength(2)
  expect(advanceKeys[1]).toBe(advanceKeys[0])
  await page.unroute('**/experiments/confirmation/advance')
  await expect(page.locator('#guest-position')).toHaveText('3')
  await expect(page.locator('#delivery-badge')).toHaveText(
    'Aceptado por WhatsApp',
    { timeout: 30000 },
  )
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.screenshot({
    path: '../../apps/api/.wrangler/ui-evidence/after-desktop.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
  const mobileSteps = await page.locator('.workspace section .step-number').evaluateAll(elements=>elements.map(element=>({step:Number(element.textContent),top:element.getBoundingClientRect().top})).sort((a,b)=>a.top-b.top).map(value=>value.step))
  expect(mobileSteps).toEqual([1,2,3,4])
  await page.screenshot({
    path: '../../apps/api/.wrangler/ui-evidence/after-mobile.png',
    fullPage: true,
  })
  await reply('BAJA')
  await expect(tester).toContainText('Baja registrada', { timeout: 30000 })
  await page.getByRole('button', { name: 'Avanzar un turno' }).click()
  await expect(page.locator('#guest-position')).toHaveText('2')
  await reply('button')
  await expect(tester).toContainText('Baja registrada')
  await page
    .getByRole('button', { name: 'Reiniciar la prueba', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Conservar la prueba' }).click()
  await expect(page.locator('#guest-position')).toHaveText('2')
  await page
    .getByRole('button', { name: 'Reiniciar la prueba', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Reiniciar prueba', exact: true })
    .click()
  await expect(page.locator('#entries li')).toHaveCount(3)
  await expect(page.locator('#withdrawal')).toContainText('BAJA registrada')
  expect(page.url()).not.toContain('test-pilot')
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0])
})

test('uncertain provider delivery is explained without offering a resend', async ({
  page,
  request,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Single shared dedicated experiment queue',
  )
  await page.goto('/api/v1/experiments/confirmation')
  await page
    .getByLabel('Acceso al piloto')
    .fill('test-pilot-access-at-least-32-characters')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.locator('#panel')).toBeVisible()
  await page.locator('#seed').click()
  if (await page.getByRole('dialog').isVisible())
    await page
      .getByRole('button', { name: 'Reiniciar prueba', exact: true })
      .click()
  await expect(page.locator('#entries li')).toHaveCount(3)
  await page.getByLabel('Tu teléfono', { exact: true }).fill('+34600000005')
  await page.getByRole('checkbox').check()
  const joined = page.waitForResponse(
    (r) =>
      r.url().includes('/queues/confirmation-experiment/entries') &&
      r.request().method() === 'POST',
  )
  await page
    .getByRole('button', { name: 'Crear turno y solicitar CONFIRMO' })
    .click()
  const entry = (await (await joined).json()) as { recoveryToken: string }
  await expect(page.locator('#delivery-badge')).toHaveText(
    'Aceptado por WhatsApp',
    { timeout: 30000 },
  )
  expect(
    (
      await request.post('/api/v1/experiments/local/reply', {
        headers: {
          'X-NoQueue-Pilot-Token': 'test-pilot-access-at-least-32-characters',
        },
        data: { token: entry.recoveryToken, action: 'button' },
      })
    ).status(),
  ).toBe(200)
  await expect(page.locator('#consent-badge')).toHaveText('Avisos activados', {
    timeout: 30000,
  })
  await page.locator('#advance').click()
  await expect(page.locator('#delivery-badge')).toHaveText(
    'Resultado incierto',
    { timeout: 30000 },
  )
  await expect(page.locator('#delivery-detail')).toContainText(
    'No se reintentará automáticamente',
  )
  await expect(page.getByRole('button', { name: /reenviar/i })).toHaveCount(0)
  await page.locator('#advance').click()
  await expect(page.locator('#guest-position')).toHaveText('2')
  await page.locator('#advance').click()
  await expect(page.locator('#guest-position')).toHaveText('1')
  await expect(page.locator('#guest-ahead')).toHaveText('Eres el siguiente')
  await expect(page.locator('#next-warning')).toContainText(
    'No significa que tu mesa esté lista',
  )
})
