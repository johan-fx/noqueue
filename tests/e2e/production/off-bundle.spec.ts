import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
for (const [surface, origin, directory] of [
  ['landing', 'https://noqueue-app.com', 'apps/landing/dist'],
  ['app', 'https://app.noqueue-app.com', 'apps/web/dist'],
] as const) {
  test(`${surface} actual production bundle stays OFF even with a copied grant`, async ({ context, page }) => {
    const manifest = JSON.parse(await readFile(resolve(root, 'queue-reports/production/manifest.json'), 'utf8')) as { id?: string; analytics: boolean; buildEnv: Record<string, string> }
    expect(manifest.analytics).toBe(false)
    expect(manifest.buildEnv[surface === 'app' ? 'VITE_ANALYTICS_ENABLED' : 'LANDING_ANALYTICS_ENABLED']).toBe('false')
    expect(manifest.buildEnv.VITE_PUBLIC_APP_ORIGIN).toBe('https://app.noqueue-app.com')
    const external: string[] = [], receipts: string[] = []
    // Every request is intercepted. These production-looking hosts NEVER hit DNS/network.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) { external.push(url.origin); await route.abort(); return }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/v1/privacy/consents') receipts.push(url.pathname)
        // This is an OFF-bundle smoke, not a replacement for real API/product regressions.
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_unavailable"}' }); return
      }
      // Read the archived release, not mutable dist overwritten by other test builds.
      if (manifest.id) expect(manifest.id).toMatch(/^[a-z0-9][a-z0-9-]{5,95}$/)
      const base = manifest.id
        ? resolve(root, 'queue-reports/production/releases', manifest.id, surface === 'app' ? 'web' : 'landing')
        : resolve(root, directory)
      const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      let file = resolve(base, path)
      if (!file.startsWith(base + '/')) { await route.abort(); return }
      let body: Buffer
      try { body = await readFile(file) }
      catch {
        if (surface !== 'app' || extname(file)) { await route.fulfill({ status: 404, body: '' }); return }
        file = resolve(base, 'index.html'); body = await readFile(file)
      }
      await route.fulfill({ contentType: mime[extname(file)] ?? 'application/octet-stream', headers: { 'Referrer-Policy': 'no-referrer' }, body })
    })
    await context.addInitScript(() => {
      if (localStorage.getItem('noqueue.privacy.v1')) return
      localStorage.setItem('noqueue.privacy.v1', JSON.stringify({
        consentId: crypto.randomUUID(), decisionId: crypto.randomUUID(), revision: 1,
        locale: 'es', analytics: true, acknowledged: true, attempts: 1, expiresAt: Date.now() + 86400000,
      }))
    })
    await page.goto(origin + '/?notice=SYNTHETIC_NOTICE#SYNTHETIC_HASH')
    await expect(page.getByRole('dialog', { name: 'Analítica opcional', exact: true })).toBeHidden()
    await page.getByRole('button', { name: 'Privacidad y analítica', exact: true }).click()
    await page.getByRole('button', { name: 'Google Analytics', exact: true }).click()
    await expect(page.getByText('La analítica está desactivada en este entorno. No se envían datos a Google.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Rechazar', exact: true }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('noqueue.privacy.v1')!).analytics)).toBe(false)
    await page.reload()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('noqueue.privacy.v1')!).analytics)).toBe(false)
    await page.getByRole('button', { name: 'Privacidad y analítica', exact: true }).click()
    await page.getByRole('button', { name: 'Aceptar analítica', exact: true }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('noqueue.privacy.v1')!).analytics)).toBe(true)
    // Allow timers/late imports to run: an OFF artifact must not schedule a receipt or tag.
    await page.waitForTimeout(500)
    expect(external).toEqual([])
    expect(receipts).toEqual([])
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith('_ga'))).toEqual([])
    expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0)
  })
}
