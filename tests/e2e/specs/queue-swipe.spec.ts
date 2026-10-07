import { test, expect, type Page, type Locator } from '@playwright/test'

// Browser-level interaction test: local API fixtures isolate gestures from business mutations.
async function openQueue(
  page: Page,
  options: { viewer?: boolean; blocked?: boolean; quick?: boolean } = {},
) {
  let commands = 0
  const queue = {
    id: 'swipe',
    venueId: 'venue',
    name: 'Swipe queue',
    open: 1,
    version: 1,
    capacity: 40,
    averageMinutes: 10,
    readiness: {
      state: options.blocked ? 'pending' : 'ready',
      reasons: options.blocked ? ['inventory_refresh_required'] : [],
    },
    config: {
      name: 'Swipe queue',
      type: options.quick ? 'pool' : 'restaurant',
      capacity: 40,
      averageMinutes: 10,
      graceMinutes: 5,
      cutoffMinutes: 0,
      twentyFourHours: true,
      schedules: [],
      spaces: [],
      receptionServices: [],
    },
  }
  await page.route('**/api/v1/staff/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/commands')) commands++
    const body = path.endsWith('/me')
      ? {
          user: { id: 'u', username: 'swipe', email: 'swipe@example.test' },
          commercial: false,
          platformAdmin: false,
          venues: [
            {
              id: 'venue',
              name: 'Swipe venue',
              role: options.viewer ? 'viewer' : 'owner',
            },
          ],
        }
      : path.endsWith('/queues')
      ? [queue]
      : path.endsWith('/entries')
      ? Array.from({ length: 20 }, (_, i) => ({
          id: `e${i}`,
          code: `T${i}`,
          displayName: `Guest ${i}`,
          status: i === 1 ? 'called' : 'waiting',
          partySize: 1,
          sequence: i + 1,
          version: 0,
          calledAt: i === 1 ? Date.now() : null,
        }))
      : {}
    await route.fulfill({ json: body })
  })
  await page.goto('/staff')
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const drawer = page.getByRole('dialog', {
    name: 'Gestionar lista',
    exact: true,
  })
  await expect(drawer.locator('[data-entry-code="T0"]')).toBeVisible()
  await drawer.evaluate(async (el) => {
    await Promise.all(
      el
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    )
  })
  return { drawer, commands: () => commands }
}
const surface = (row: Locator) => row.locator('[data-swipe-surface]')
const offset = (row: Locator) =>
  surface(row).evaluate(
    (el) => new DOMMatrix(getComputedStyle(el).transform).m41,
  )
async function mouseStart(page: Page, row: Locator) {
  const box = await surface(row).boundingBox()
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height - 18 }
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  return point
}
async function mouseSwipe(page: Page, row: Locator, delta: number) {
  const p = await mouseStart(page, row)
  await page.mouse.move(p.x + delta, p.y, { steps: 12 })
  await page.mouse.up()
}

test('desktop progressive swipe, limits, thresholds, exclusivity and accessible actions', async ({
  page,
}) => {
  const { drawer, commands } = await openQueue(page)
  const row = drawer.locator('[data-entry-code="T0"]')
  const called = drawer.locator('[data-entry-code="T1"]')
  await expect(row.getByRole('button', { name: 'Asignar turno' })).toHaveCount(
    0,
  )
  await expect(row).toHaveCSS('user-select', 'none')
  await expect(surface(row)).toHaveCSS('touch-action', 'pan-y')
  const p = await mouseStart(page, row)
  await page.mouse.move(p.x + 45, p.y, { steps: 8 })
  await expect.poll(() => offset(row)).toBeGreaterThan(20)
  await expect.poll(() => offset(row)).toBeLessThan(60)
  // Polling replaces entry objects without snapping an active drag.
  await page.waitForResponse((response) => response.url().endsWith('/entries'))
  await expect.poll(() => offset(row)).toBeGreaterThan(20)
  await page.mouse.up()
  await expect.poll(() => offset(row)).toBe(0)
  const button = row.getByRole('button', { name: /Acciones del turno/ })
  const buttonBox = await button.boundingBox()
  await page.mouse.move(buttonBox!.x + 8, buttonBox!.y + 8)
  await page.mouse.down()
  await page.mouse.move(buttonBox!.x + 90, buttonBox!.y + 8, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => offset(row)).toBe(0)
  await mouseSwipe(page, row, 180)
  await expect.poll(() => offset(row)).toBe(144)
  await expect(row.getByRole('button', { name: 'Asignar turno' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Asignar turno' })).toHaveClass(
    /bg-yellow-400/,
  )
  await mouseSwipe(page, row, -110)
  await expect.poll(() => offset(row)).toBe(0)
  await mouseSwipe(page, row, -280)
  await expect.poll(() => offset(row)).toBe(-112)
  await expect(
    row.getByRole('button', { name: 'Cancelar turno' }),
  ).toBeVisible()
  await mouseSwipe(page, called, 120)
  await expect.poll(() => offset(called)).toBe(144)
  await expect.poll(() => offset(row)).toBe(0)
  await expect(
    called.getByRole('button', { name: 'Confirmar llegada' }),
  ).toHaveClass(/bg-green-600/)
  await expect(drawer).toBeVisible()
  expect(commands()).toBe(0)
  await called.getByRole('button', { name: /Acciones del turno/ }).click()
  await expect.poll(() => offset(called)).toBe(0)
  await expect(
    called.getByRole('button', { name: 'Confirmar llegada' }),
  ).toBeVisible()
  await row.getByRole('button', { name: /Acciones del turno/ }).focus()
  await page.keyboard.press('Enter')
  await expect(row.getByRole('button', { name: 'Asignar turno' })).toBeVisible()
  await expect(
    called.getByRole('button', { name: 'Confirmar llegada' }),
  ).toHaveCount(0)
  await mouseSwipe(page, called, 120)
  await called.getByRole('button', { name: 'Confirmar llegada' }).click()
  await expect.poll(commands).toBe(1)
  await expect(
    page.getByRole('dialog', { name: 'Confirmar llegada', exact: true }),
  ).toHaveCount(0)
})

test('swipe call respects inventory and viewer cannot drag', async ({
  page,
}) => {
  let setup = await openQueue(page, { blocked: true })
  let row = setup.drawer.locator('[data-entry-code="T0"]')
  await mouseSwipe(page, row, 120)
  await expect(
    row.getByRole('button', { name: 'Asignar turno' }),
  ).toBeDisabled()
  await page.unrouteAll()
  setup = await openQueue(page, { viewer: true })
  row = setup.drawer.locator('[data-entry-code="T0"]')
  await mouseSwipe(page, row, 120)
  await expect.poll(() => offset(row)).toBe(0)
  await expect(row.getByRole('button')).toHaveCount(0)
})

test('native mobile touch progressively reveals, cancels and preserves vertical scroll and Drawer', async ({
  browser,
  browserName,
  baseURL,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Native touch injection uses Chromium CDP; desktop runs in all engines.',
  )
  const context = await browser.newContext({
    baseURL: baseURL!,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  const { drawer, commands } = await openQueue(page)
  const row = drawer.locator('[data-entry-code="T0"]')
  const session = await context.newCDPSession(page)
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    x = 0,
    y = 0,
  ) => {
    await session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }],
    })
  }
  const box = await surface(row).boundingBox(),
    x = box!.x + 45,
    y = box!.y + box!.height - 18
  await touch('touchStart', x, y)
  for (let n = 1; n <= 6; n++) await touch('touchMove', x + n * 10, y)
  await expect.poll(() => offset(row)).toBeGreaterThan(20)
  await expect.poll(() => offset(row)).toBeLessThan(100)
  await touch('touchCancel')
  await expect.poll(() => offset(row)).toBe(0)
  await touch('touchStart', x, y)
  for (let n = 1; n <= 12; n++) await touch('touchMove', x + n * 10, y)
  await touch('touchEnd')
  await expect.poll(() => offset(row)).toBe(144)
  await expect(drawer).toBeVisible()
  // Touch swipes may not emit a compatibility click; keyboard activation must still work.
  const actions = row.getByRole('button', { name: /Acciones del turno/ })
  await actions.focus()
  await page.keyboard.press('Enter')
  await expect(actions).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Enter')
  await expect(actions).toHaveAttribute('aria-expanded', 'false')
  // A real vertical touch must scroll the drawer instead of dragging the card.
  const lower = drawer.locator('[data-entry-code="T3"]')
  const lowerBox = await surface(lower).boundingBox()
  const before = lowerBox!.y
  await touch('touchStart', lowerBox!.x + 100, before + 50)
  for (let n = 1; n <= 10; n++)
    await touch('touchMove', lowerBox!.x + 100, before + 50 - n * 20)
  await touch('touchEnd')
  await expect
    .poll(async () => (await lower.boundingBox())!.y)
    .toBeLessThan(before - 30)
  await expect(drawer).toBeVisible()
  expect(commands()).toBe(0)
  await context.close()
})

test('quick waiting swipes and keyboard expose only cancellation; footer assigns directly', async ({
  page,
}) => {
  const { drawer, commands } = await openQueue(page, { quick: true })
  const row = drawer.locator('[data-entry-code="T0"]')
  await mouseSwipe(page, row, 160)
  await expect.poll(() => offset(row)).toBe(0)
  await expect(row.getByRole('button', { name: 'Asignar turno' })).toHaveCount(
    0,
  )
  await row.getByRole('button', { name: /Acciones del turno/ }).click()
  await expect(
    row.getByRole('button', { name: 'Cancelar turno' }),
  ).toBeVisible()
  expect(commands()).toBe(0)
  await drawer.getByRole('button', { name: 'Asignar próximo turno' }).click()
  await expect.poll(commands).toBe(1)
  await expect(
    page.getByRole('dialog', { name: 'Asignar turno', exact: true }),
  ).toHaveCount(0)
})
