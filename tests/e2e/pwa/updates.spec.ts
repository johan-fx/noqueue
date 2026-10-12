import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test'

const serviceFixture = {
  serviceOpen: true,
  queueState: 'active',
  canJoin: true,
  blockReason: null,
  waitingPeople: 0,
  initialWaitingMarker: false,
  id: 'pwa-test-queue',
  name: 'PWA Test Queue',
  venueName: 'PWA Test Venue',
  open: 1,
  type: 'reception',
  receptionServices: ['check_in'],
  spaces: [],
}

async function markReloads(page: Page) {
  await page.addInitScript(() => {
    const key = '__noqueuePwaBoots'
    const boots = Number(sessionStorage.getItem(key) ?? '0') + 1
    sessionStorage.setItem(key, String(boots))
  })
}

async function bootCount(page: Page) {
  return page.evaluate(() => Number(sessionStorage.getItem('__noqueuePwaBoots') ?? '0'))
}

async function waitForActiveWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
}

async function switchBuild(context: BrowserContext, build: 'a' | 'b') {
  const response = await context.request.post('/__pwa_test__/switch', {
    data: { build },
  })
  expect(response.ok()).toBeTruthy()
}

async function stubPublicQueue(page: Page) {
  await page.route('**/api/v1/public/services/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(serviceFixture),
    }),
  )
}

async function evictPublicQueueChunk(page: Page) {
  await page.evaluate(async () => {
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName)
      for (const request of await cache.keys()) {
        if (/\/assets\/PublicQueue-[^/]+\.js$/.test(new URL(request.url).pathname)) {
          await cache.delete(request)
        }
      }
    }
  })
}

async function requestWorkerUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    await registration.update()
  })
}

test.beforeEach(async ({ request }) => {
  const response = await request.post('/__pwa_test__/reset')
  expect(response.ok()).toBeTruthy()
})

test('waits for consent, leaves the old tab stable, then reloads into the new build', async ({
  page,
  context,
  request,
}, testInfo: TestInfo) => {
  await markReloads(page)
  await stubPublicQueue(page)
  await page.goto('/')
  await waitForActiveWorker(page)
  await expect(page.locator('html')).toHaveAttribute('data-pwa-e2e-build', 'a')
  await expect.poll(() => bootCount(page)).toBe(1)

  await switchBuild(context, 'b')
  await requestWorkerUpdate(page)
  const apply = page.getByTestId('pwa-update-apply')
  await expect(apply).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('pwa-update-banner.png') })

  // A waiting worker must not replace the currently open app on its own.
  await expect(page.locator('html')).toHaveAttribute('data-pwa-e2e-build', 'a')
  await expect.poll(() => bootCount(page)).toBe(1)
  await page.waitForTimeout(700)
  await expect.poll(() => bootCount(page)).toBe(1)

  // Deferring is a local UI choice; the worker stays waiting and the prompt
  // can be seen again when the app is reopened.
  await page.getByTestId('pwa-update-later').click()
  await expect(apply).toBeHidden()
  await expect.poll(() => bootCount(page)).toBe(1)
  await expect
    .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)))
    .toBe(true)
  // The open A runtime must still be able to import its own stale-hashed
  // public route after B is deployed; A's precached chunk remains available.
  await page.goto('/q/pwa-test-queue?lang=es')
  await expect(page.getByText('PWA Test Queue', { exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-pwa-e2e-build', 'a')
  await expect(page.getByTestId('pwa-update-apply')).toBeVisible()
  await expect.poll(() => bootCount(page)).toBe(2)
  const loadedChunk = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname.split('/').at(-1))
      .find((name) => name && /^PublicQueue-[^/]+\.js$/.test(name)),
  )
  expect(loadedChunk).toBeTruthy()
  const bundleResponse = await request.get('/__pwa_test__/assets?build=b')
  const bBundles = (await bundleResponse.json()) as string[]
  expect(bBundles).not.toContain(loadedChunk)

  await page.getByTestId('pwa-update-apply').click()
  await expect(page.locator('html')).toHaveAttribute('data-pwa-e2e-build', 'b')
  await expect.poll(() => bootCount(page)).toBe(3)
})

test('refuses activation while another app tab is open and permits it after that tab closes', async ({
  page,
  context,
}) => {
  await markReloads(page)
  await page.goto('/')
  await waitForActiveWorker(page)

  const otherTab = await context.newPage()
  await markReloads(otherTab)
  await otherTab.route('**/api/v1/public/search', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], page: 1, hasMore: false }),
    }),
  )
  await otherTab.goto('/search?lang=en')
  await waitForActiveWorker(otherTab)
  await expect(otherTab.locator('html')).toHaveAttribute('data-pwa-e2e-build', 'a')
  const unsavedSearch = otherTab.getByRole('textbox', {
    name: 'Hotel, restaurant or venue',
  })
  await unsavedSearch.fill('Unsaved visitor query')
  await expect(unsavedSearch).toHaveValue('Unsaved visitor query')

  await switchBuild(context, 'b')
  await requestWorkerUpdate(page)
  await expect(page.getByTestId('pwa-update-apply')).toBeVisible()
  await page.getByTestId('pwa-update-apply').click()
  await expect(page.getByTestId('pwa-update-blocked')).toContainText(
    'Cierra las otras pestañas de No Queue y vuelve a intentarlo.',
  )

  await expect(page.locator('html')).toHaveAttribute('data-pwa-e2e-build', 'a')
  await expect(otherTab.locator('html')).toHaveAttribute('data-pwa-e2e-build', 'a')
  await expect(unsavedSearch).toHaveValue('Unsaved visitor query')
  await expect.poll(() => bootCount(page)).toBe(1)
  await expect.poll(() => bootCount(otherTab)).toBe(1)

  await otherTab.close()
  await page.getByTestId('pwa-update-apply').click()
  await expect(page.locator('html')).toHaveAttribute('data-pwa-e2e-build', 'b')
  await expect.poll(() => bootCount(page)).toBe(2)
})

test('shows offline recovery for a missing lazy chunk and retries only after a user action', async ({
  page,
  context,
  request,
}) => {
  await markReloads(page)
  await page.route('**/api/v1/public/services/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(serviceFixture) }),
  )
  await page.goto('/')
  await waitForActiveWorker(page)

  // The production worker precaches lazy modules, so evict just this chunk to
  // deterministically simulate a stale deployment with an unavailable bundle.
  await evictPublicQueueChunk(page)
  const missingResponse = await request.post('/__pwa_test__/missing-public-queue')
  expect(missingResponse.ok()).toBeTruthy()
  await context.setOffline(true)
  await page.goto('/q/pwa-test-queue?lang=es')

  await expect(
    page.getByRole('heading', { name: 'No se ha podido cargar esta pantalla' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(
    'No tienes conexión. Conéctate a internet y vuelve a intentarlo.',
  )
  const reload = page.getByRole('button', { name: 'Volver a cargar' })
  await expect(reload).toBeDisabled()
  await expect.poll(() => bootCount(page)).toBe(2)

  await context.setOffline(false)
  // Restore the asset before the explicit retry. The harness returns a genuine
  // 404 for the missing chunk and never hides it behind the SPA index fallback.
  await request.post('/__pwa_test__/reset')
  await reload.click()
  await expect(page.getByText('PWA Test Queue', { exact: true })).toBeVisible()
  await expect.poll(() => bootCount(page)).toBe(3)
})

test('keeps a missing-chunk error stable until the user retries, without a reload loop', async ({
  page,
  request,
}, testInfo: TestInfo) => {
  await markReloads(page)
  await stubPublicQueue(page)
  await page.goto('/')
  await waitForActiveWorker(page)
  await evictPublicQueueChunk(page)

  const missingResponse = await request.post('/__pwa_test__/missing-public-queue')
  expect(missingResponse.ok()).toBeTruthy()
  await page.goto('/q/pwa-test-queue?lang=es')

  const heading = page.getByRole('heading', {
    name: 'No se ha podido cargar esta pantalla',
  })
  await expect(heading).toBeVisible()
  await expect(page.getByText('Unexpected Application Error!')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('pwa-recovery-screen.png') })
  await expect.poll(() => bootCount(page)).toBe(2)

  await page.waitForTimeout(700)
  await expect.poll(() => bootCount(page)).toBe(2)
  await page.getByRole('button', { name: 'Volver a cargar' }).click()
  await expect(heading).toBeVisible()
  await expect.poll(() => bootCount(page)).toBe(3)
  await page.waitForTimeout(700)
  await expect.poll(() => bootCount(page)).toBe(3)

  // Once the missing asset is available again, the same explicit recovery
  // action reopens the route; no storage or recovery data was cleared.
  const resetResponse = await request.post('/__pwa_test__/reset')
  expect(resetResponse.ok()).toBeTruthy()
  await page.getByRole('button', { name: 'Volver a cargar' }).click()
  await expect(page.getByText('PWA Test Queue', { exact: true })).toBeVisible()
  await expect.poll(() => bootCount(page)).toBe(4)
})
