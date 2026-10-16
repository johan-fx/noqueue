import { expect, test, type BrowserContext, type Page } from '@playwright/test'
const app = 'https://app.noqueue-app.com', landing = 'https://noqueue-app.com'
const token = 'a'.repeat(64)
const stub = `const layer=window.dataLayer;const push=layer.push.bind(layer);layer.push=function(args){push(args);if(args[0]==='config')document.cookie='_ga=fake; Path=/; Secure; SameSite=Lax';if(args[0]==='event')fetch('https://www.google-analytics.com/g/collect',{method:'POST',body:JSON.stringify(Array.from(args)),credentials:'omit',referrerPolicy:'no-referrer'})};`
async function setup(context: BrowserContext, options: { environment?: string; receiptStatus?: number; delayGoogle?: boolean } = {}) {
  const google: string[] = [], events: unknown[] = [], receipts: Record<string, unknown>[] = []
  let release: (() => void) | undefined
  const releaseGoogle = new Promise<void>((resolve) => { release = resolve })
  // No network may leave this test. Production hostnames are fulfilled locally.
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url())
    if (url.hostname === 'www.googletagmanager.com') {
      google.push(req.url())
      if (options.delayGoogle) await releaseGoogle
      await route.fulfill({ contentType: 'text/javascript', body: stub }); return
    }
    if (url.hostname === 'www.google-analytics.com') {
      google.push(req.url()); events.push(JSON.parse(req.postData()!)); await route.fulfill({ status: 204 }); return
    }
    if (url.pathname === '/api/v1/privacy/consents') {
      expect(req.headers()['cookie']).toBeUndefined()
      expect(req.headers()['referer']).toBeUndefined()
      receipts.push(req.postDataJSON()); await route.fulfill({ status: options.receiptStatus ?? 204, headers: { 'Access-Control-Allow-Origin': req.headers()['origin'] ?? app } }); return
    }
    if ([new URL(app).hostname, new URL(landing).hostname, 'staging.noqueue-app.com'].includes(url.hostname)) {
      if (url.hostname === new URL(landing).hostname) {
        const filename = url.pathname === '/' ? '/index.html' : url.pathname
        const res = await context.request.get(`http://127.0.0.1:${process.env.NOQUEUE_PRIVACY_PORT}/landing${filename}`)
        await route.fulfill({ response: res }); return
      }
      if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        const res = await context.request.get(`http://127.0.0.1:${process.env.NOQUEUE_PRIVACY_PORT}/${options.environment ?? 'production'}${url.pathname}`)
        await route.fulfill({ response: res }); return
      }
      await route.fulfill({ contentType: 'text/html', headers: { 'Referrer-Policy': 'no-referrer' }, body: '<html lang="es"><head><meta name="referrer" content="no-referrer"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>' }); return
    }
    await route.abort()
  })
  return { google, events, receipts, release: () => release!() }
}
async function accept(page: Page) { await page.getByRole('button', { name: 'Aceptar analítica', exact: true }).first().click() }
async function settle(page: Page) { await page.waitForTimeout(350) }
test('no choice/rejection never contacts Google, including reload', async ({ context, page }) => {
  const net = await setup(context); await page.goto(app); await settle(page)
  expect(net.google).toEqual([])
  await page.getByRole('button', { name: 'Rechazar', exact: true }).first().click()
  await expect.poll(() => net.receipts.length).toBe(1); expect(net.receipts[0]!.analytics).toBe(false)
  await page.reload(); await settle(page); expect(net.google).toEqual([])
  expect((await context.cookies()).filter((c) => c.name.startsWith('_ga'))).toEqual([])
})
test('acknowledged grant sends one sanitized view; search/hash/locale do not duplicate it', async ({ context, page }) => {
  const net = await setup(context); await page.goto(app + '/q/private-venue?notice=SECRET&utm_source=SECRET#SECRET'); await accept(page)
  await expect.poll(() => net.events.length).toBe(1)
  expect(net.events[0]).toEqual(['event', 'page_view', { page_location: app + '/q/queue', page_title: 'Queue', page_referrer: '' }])
  await page.getByRole('link', { name: 'Search', exact: true }).click(); await expect.poll(() => net.events.length).toBe(2)
  await page.getByRole('link', { name: 'Search', exact: true }).click(); await settle(page)
  expect(net.events).toHaveLength(2); expect(net.google.filter((s) => s.includes('gtag/js'))).toHaveLength(1)
  expect(JSON.stringify([net.events, net.receipts])).not.toMatch(/SECRET|private-venue|PRIVATE-SEARCH|PRIVATE-HASH/)
})
test('hard document barrier preserves join notice without storing token, also back/forward and direct restored tickets', async ({ context, page }) => {
  const net = await setup(context); await page.goto(app + '/q/example-queue'); await accept(page)
  await expect.poll(() => net.events.length).toBe(1)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ticket' })).toBeVisible(); await expect(page.getByText('Turn created')).toBeVisible()
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0)
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(token)
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Public' })).toBeVisible()
  await page.goForward(); await expect(page.getByRole('heading', { name: 'Ticket' })).toBeVisible()
  await page.reload(); await settle(page)
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0)
  const restored = await context.newPage(); await restored.goto(app + '/t/' + token + '?notice=PRIVATE-NOTICE'); await settle(restored)
  expect(await restored.locator('script[src*="googletagmanager"]').count()).toBe(0)
  expect(JSON.stringify([net.google, net.events, net.receipts])).not.toMatch(new RegExp(`${token}|PRIVATE-NOTICE|notice`))
})
test('withdrawal synchronizes tabs and deletes only GA cookies; host preferences stay separate', async ({ context, page }) => {
  const net = await setup(context); await page.goto(app); await accept(page); await expect.poll(() => net.events.length).toBe(1)
  const other = await context.newPage(); await other.goto(app); await expect.poll(() => net.events.length).toBe(2)
  await context.addCookies([{ name: 'functional', value: 'preserve', url: app }])
  await page.getByRole('button', { name: 'Privacy', exact: true }).click()
  await page.getByRole('button', { name: 'Rechazar', exact: true }).click(); await expect.poll(() => net.receipts.length).toBe(2)
  await other.getByRole('link', { name: 'Search', exact: true }).click(); await settle(other)
  expect(net.events).toHaveLength(2)
  expect(await other.evaluate(() => document.cookie)).not.toMatch(/(?:^|;\s*)_ga(?:_|=)/)
  expect((await context.cookies(app)).some((c) => c.name === 'functional')).toBe(true)
  await page.goto(landing); await expect(page.getByRole('button', { name: 'Aceptar analítica', exact: true }).first()).toBeVisible()
  await accept(page); await expect.poll(() => net.events.length).toBe(3)
  await other.reload(); await settle(other); expect(net.events).toHaveLength(3)
  expect(await other.evaluate(() => document.cookie)).not.toMatch(/(?:^|;\s*)_ga(?:_|=)/)
})
test('failed receipt and unavailable localStorage never enable analytics', async ({ context, page }) => {
  const net = await setup(context, { receiptStatus: 503 }); await page.goto(app); await accept(page); await settle(page)
  expect(net.google).toEqual([])
  await context.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Blocked') } })
  await page.reload(); await page.getByRole('button', { name: 'Privacy', exact: true }).click(); await settle(page)
  expect(net.google).toEqual([])
})
test('withdrawal during delayed download cancels the pending view', async ({ context, page }) => {
  const net = await setup(context, { delayGoogle: true }); await page.goto(app); await accept(page)
  await expect.poll(() => net.google.length).toBe(1)
  await page.getByRole('button', { name: 'Privacy', exact: true }).click(); await page.getByRole('button', { name: 'Rechazar', exact: true }).click()
  net.release(); await settle(page); expect(net.events).toEqual([])
})
test('staging host/build remain off with a valid copied grant and configured ID', async ({ context, page }) => {
  const net = await setup(context, { environment: 'staging' })
  await context.addInitScript(() => localStorage.setItem('noqueue.privacy.v1', JSON.stringify({ consentId: crypto.randomUUID(), decisionId: crypto.randomUUID(), revision: 1, locale: 'es', analytics: true, acknowledged: true, attempts: 1, expiresAt: Date.now() + 86400000 })))
  await page.goto(app); await settle(page); await page.goto('https://staging.noqueue-app.com'); await settle(page); expect(net.google).toEqual([])
})
test('Capacitor runtime never initializes CMP or GA', async ({ context, page }) => {
  const net = await setup(context)
  await context.addInitScript(() => { Object.assign(window, { androidBridge: {} }) })
  await page.goto(app); await settle(page)
  expect(net.google).toEqual([]); expect(await page.locator('#cc-main').count()).toBe(0)
})
test('stale revision invalidates previous acceptance and allows a fresh rejection', async ({ context, page }) => {
  const net = await setup(context); await page.goto(app); await accept(page); await expect.poll(() => net.events.length).toBe(1)
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('noqueue.privacy.v1')!)
    localStorage.setItem('noqueue.privacy.v1', JSON.stringify({ ...state, revision: 0 }))
  })
  await page.reload(); await page.getByRole('button', { name: 'Rechazar', exact: true }).first().click(); await settle(page)
  expect(net.events).toHaveLength(1); expect(net.google.filter((s) => s.includes('gtag/js'))).toHaveLength(1)
  expect(net.receipts.at(-1)?.analytics).toBe(false)
})
test('read-only storage cannot reuse a previously acknowledged grant', async ({ context, page }) => {
  const net = await setup(context)
  await context.addInitScript(() => {
    localStorage.setItem('noqueue.privacy.v1', JSON.stringify({ consentId: crypto.randomUUID(), decisionId: crypto.randomUUID(), revision: 1, locale: 'es', analytics: true, acknowledged: true, attempts: 1, expiresAt: Date.now() + 86400000 }))
    Storage.prototype.setItem = () => { throw Error('read-only') }
  })
  await page.goto(app); await settle(page); expect(net.google).toEqual([])
})
test('error screens stay excluded with prior consent, and BFCache lifecycle pauses the tag', async ({ context, page }) => {
  const net = await setup(context); await page.goto(app); await accept(page); await expect.poll(() => net.events.length).toBe(1)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  expect(await page.evaluate(() => Reflect.get(window, 'ga-disable-G-TEST12345'))).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await page.goto(app + '/q/missing'); await settle(page)
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0)
  await page.getByRole('button', { name: 'Privacy', exact: true }).click(); await settle(page)
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0)
})
test('landing consent preserves English/dark mode, equal choices and keyboard-accessible withdrawal', async ({ context, page }, info) => {
  const net = await setup(context); await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(landing); await page.locator('#language').selectOption('en')
  await page.emulateMedia({ colorScheme: 'dark' })
  const acceptButton = page.getByRole('button', { name: 'Accept analytics', exact: true }).first()
  const reject = page.getByRole('button', { name: 'Reject', exact: true }).first()
  await expect(acceptButton).toBeVisible(); await expect(reject).toBeVisible()
  expect(await acceptButton.getAttribute('class')).toBe(await reject.getAttribute('class'))
  await reject.focus(); await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Privacy and analytics', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Privacy and analytics' })).toBeVisible()
  expect(await page.locator('html').getAttribute('data-theme')).toBe('dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(net.google).toEqual([])
  await expect.poll(() => page.locator('#cc-main .pm').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  expect(await page.locator('#cc-main').evaluate((element) => getComputedStyle(element).getPropertyValue('--cc-cookie-category-block-bg').trim())).toBe('#242c31')
  await page.screenshot({ path: info.outputPath('consent-en-dark-mobile.png') })
})
