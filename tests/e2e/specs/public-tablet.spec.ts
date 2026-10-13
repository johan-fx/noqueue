import { test, expect, type Page, type Locator } from '../fixtures.js'
import { setup } from '../helpers/queue-actions.js'

// This suite tests the UI and admissions, not PWA caching. A worker can bypass
// Playwright routing (notably in WebKit), hiding the layout fixtures on reload.
test.use({ serviceWorkers: 'block' })

async function fillKiosk(page: Page, name: string) {
  await page.getByLabel('Nombre', { exact: true }).fill(name)
  await page.getByLabel('Teléfono', { exact: true }).fill('600000000')
  await page.getByRole('switch').check()
}

async function expectCentered(page: Page, locator: Locator, maxWidth: number) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  const width = page.viewportSize()!.width
  expect(Math.abs(box!.x - (width - box!.width) / 2)).toBeLessThanOrEqual(1)
  expect(box!.width).toBeLessThanOrEqual(maxWidth)
  expect(box!.x).toBeGreaterThanOrEqual(16)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width)
}

test('drawer offers only tablet registration and QR; two guests register without exposing their turns', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  const { queue } = await setup(page, request, baseURL!)
  const staffUrl = page.url()
  const drawer = page.getByRole('dialog', {
    name: 'Gestionar lista',
    exact: true,
  })
  const trigger = drawer.getByRole('button', { name: 'Abrir enlace público' })
  await expect(trigger).not.toHaveAttribute('href')
  await expect(
    drawer.getByRole('link', { name: 'Abrir enlace público' }),
  ).toHaveCount(0)
  const pagesBefore = page.context().pages().length
  await trigger.click()
  await expect(page.getByRole('menuitem')).toHaveCount(2)
  expect(page.context().pages()).toHaveLength(pagesBefore)
  await expect(page).toHaveURL(staffUrl)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.locator('img').last().click()
  const kioskOpened = page.waitForEvent('popup')
  await page.getByRole('menuitem', { name: 'Inscripción', exact: true }).click()
  const kiosk = await kioskOpened
  await expect(kiosk).toHaveURL(`${baseURL}/q/${queue}/kiosk`)
  await expect(kiosk.getByLabel('Nombre', { exact: true })).toBeVisible()
  const turnRequests: string[] = []
  kiosk.on('request', (req) => {
    if (/\/(?:t|turns)\//.test(req.url())) turnRequests.push(req.url())
  })
  const admissionTokens: string[] = []
  // Capture the real server token before passing the response through. Kiosk
  // intentionally cancels its response body, so response.json() is unavailable
  // from browser network events in both Chromium and WebKit.
  await kiosk.route(
    `**/api/v1/public/services/${queue}/entries`,
    async (route) => {
      const upstream = await route.fetch()
      admissionTokens.push((await upstream.json()).recoveryToken)
      await route.fulfill({ response: upstream })
    },
  )
  await fillKiosk(kiosk, 'Primer comensal')
  const admitted = kiosk.waitForResponse(
    (response) =>
      response.url().endsWith(`/services/${queue}/entries`) &&
      response.request().method() === 'POST',
  )
  await kiosk.getByRole('button', { name: 'Ponerme en lista' }).click()
  const response = await admitted
  expect(response.ok()).toBeTruthy()
  expect((await response.request().allHeaders()).cookie).toBeUndefined()
  const recoveryToken = admissionTokens[0]!
  expect(recoveryToken).toBeTruthy()
  await expect(
    kiosk.getByRole('heading', { name: '¡Ya estás en la lista de espera!' }),
  ).toBeVisible()
  await expect(kiosk.getByLabel('Nombre', { exact: true })).toHaveCount(0)
  await expect(kiosk.locator('body')).not.toContainText('Primer comensal')
  expect(
    await kiosk.evaluate(
      () =>
        location.href +
        document.body.textContent +
        JSON.stringify(localStorage) +
        JSON.stringify(sessionStorage),
    ),
  ).not.toContain(recoveryToken)
  // Exact 9,999/10,000ms boundaries and cancellation of a previous timer are
  // covered with fake timers in PublicKiosk.test.tsx; here exercise the real timer.
  await expect(kiosk.getByLabel('Nombre', { exact: true })).toHaveValue('', {
    timeout: 15_000,
  })
  await expect(kiosk.getByLabel('Teléfono', { exact: true })).toHaveValue('')
  await expect(kiosk.getByRole('switch')).not.toBeChecked()
  await fillKiosk(kiosk, 'Segundo comensal')
  const secondAdmission = kiosk.waitForResponse(
    (r) =>
      r.url().endsWith(`/services/${queue}/entries`) &&
      r.request().method() === 'POST',
  )
  await kiosk.getByRole('button', { name: 'Ponerme en lista' }).click()
  const second = await secondAdmission
  expect(second.ok()).toBeTruthy()
  expect(second.request().headers()['idempotency-key']).not.toBe(
    response.request().headers()['idempotency-key'],
  )
  await expect(
    kiosk.getByRole('heading', { name: '¡Ya estás en la lista de espera!' }),
  ).toBeVisible()
  await kiosk.getByRole('button', { name: 'Ponerme en lista' }).click()
  await expect(kiosk.getByLabel('Nombre', { exact: true })).toHaveValue('')
  await expect(kiosk).toHaveURL(`${baseURL}/q/${queue}/kiosk`)
  expect(turnRequests).toEqual([])
  await kiosk.close()

  await trigger.click()
  const qrOpened = page.waitForEvent('popup')
  await page.getByRole('menuitem', { name: 'QR', exact: true }).click()
  const qr = await qrOpened
  await expect(qr).toHaveURL(`${baseURL}/q/${queue}/qr`)
  await expect(
    qr.getByRole('img', { name: 'QR para inscribirte en la lista' }),
  ).toBeVisible()
  await expect(qr.getByRole('link')).toHaveCount(0)
  await qr.close()
})

const viewports = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 1366 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]

for (const viewport of viewports) {
  test(`shared displays stay centered and usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    let type = 'restaurant'
    await page.route('**/api/v1/public/services/tablet-layout', (route) =>
      route.fulfill({
        json: {
          id: 'tablet-layout',
          venueName: 'Hotel de prueba',
          name: 'Servicio de prueba',
          type,
          open: 1,
          serviceOpen: true,
          canJoin: true,
          queueState: 'active',
          spaces: [
            { id: 'inside', name: 'Interior', maxPartySize: 4 },
            {
              id: 'terrace',
              name: 'Terraza exterior junto a la piscina',
              maxPartySize: 4,
            },
          ],
          receptionServices: ['check_in', 'check_out', 'other'],
        },
      }),
    )
    await page.route(
      '**/api/v1/public/services/tablet-layout/entries',
      (route) => route.fulfill({ json: { recoveryToken: 'MUST-NOT-APPEAR' } }),
    )
    for (type of ['restaurant', 'reception', 'pool']) {
      await page.goto('/q/tablet-layout/kiosk?lang=es')
      await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible()
      await expectCentered(page, page.locator('form'), 960)
      const geometry = await page.evaluate(() => {
        const header = document.querySelector('header')!
        const content = document.querySelector('main > div')!
        const form = document.querySelector('form')!
        const rect = header.getBoundingClientRect()
        const padding = parseFloat(getComputedStyle(header).paddingLeft)
        return {
          left: rect.x + padding,
          formLeft: form.getBoundingClientRect().x,
          headerWidth: rect.width,
          contentWidth: content.getBoundingClientRect().width,
          padding,
        }
      })
      expect(geometry.headerWidth).toBe(Math.min(viewport.width, 960))
      expect(geometry.contentWidth).toBe(geometry.headerWidth)
      expect(geometry.padding).toBe(
        viewport.width >= 1024 ? 32 : viewport.width >= 640 ? 24 : 16,
      )
      expect(geometry.left).toBe(geometry.formLeft)
      await fillKiosk(page, 'Comensal de prueba')
      const submit = page.getByRole('button', { name: 'Ponerme en lista' })
      await submit.scrollIntoViewIfNeeded()
      await expect(submit).toBeInViewport()
      if (type === 'restaurant')
        await testInfo.attach('registration', {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
      await submit.click()
      await expect(
        page.getByRole('heading', { name: '¡Ya estás en la lista de espera!' }),
      ).toBeVisible()
      await expectCentered(page, page.locator('section'), 500)
      await expect(page.locator('body')).not.toContainText('MUST-NOT-APPEAR')
      if (type === 'restaurant')
        await testInfo.attach('thanks', {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
    }
    await page.goto('/q/tablet-layout/qr?lang=es')
    const qr = page.getByRole('img', {
      name: 'QR para inscribirte en la lista',
    })
    await expect(qr).toBeVisible()
    await expectCentered(page, page.locator('section'), 576)
    await expectCentered(page, qr, 320)
    const box = (await qr.boundingBox())!
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1)
    await expect(page.getByRole('link')).toHaveCount(0)
    await testInfo.attach('qr', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
}
