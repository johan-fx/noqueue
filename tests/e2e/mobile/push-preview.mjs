// Production React components rendered with fake data/permissions. No native bridge, API or FCM calls.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const web = path.join(root, 'apps/web')
const requireWeb = createRequire(path.join(web, 'package.json'))
const { createServer } = await import(requireWeb.resolve('vite'))
const { default: react } = await import(requireWeb.resolve('@vitejs/plugin-react'))
const { default: tailwind } = await import(requireWeb.resolve('@tailwindcss/vite'))
const output = path.join(root, 'reports/push-activation')
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: false, root: web,
  cacheDir: path.join(output, 'vite-cache'),
  define: { 'import.meta.env.VITE_MOBILE_PUSH_ENABLED': '"true"' },
  resolve: { alias: { '@': path.join(web, 'src') }, dedupe: ['react', 'react-dom'] },
  plugins: [{ name: 'isolated-push-preview', enforce: 'pre', load(id) {
    if (id === path.join(web, 'src/app/bootstrap/runtime.ts')) return `export const detectRuntime = () => 'native'`
    if (id === path.join(web, 'src/platform/capacitor/push-registration.ts')) return `
      export const initialPushState = { permission: 'unknown', registration: 'checking', settingsError: false };
      export function createNativePush({status}) {
        let disposed = false;
        const publish = (permission, registration = 'off', settingsError = false) => {
          if (!disposed) status({ permission, registration, settingsError });
        };
        window.__pushPreview = publish;
        return { start: async () => publish('denied'), reconcile: async () => {},
          enable: async () => publish('granted', 'enabled'), requestAfterJoin: async () => {},
          dispose: async () => { disposed = true } };
      }`
  } }, react(), tailwind()],
  server: { host: '127.0.0.1', port: 0 },
})
let browser
const failures = []
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  page.on('pageerror', error => failures.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin || url.pathname.startsWith('/api/')) {
      failures.push(`Unexpected network request: ${url.origin}${url.pathname}`)
      return route.abort()
    }
    return route.continue()
  })
  await page.goto(origin + '/test/push-preview/index.html')
  const card = page.getByRole('region', { name: 'Notificaciones del turno' })
  await expect(card).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const icon = card.locator('img')
  await expect.poll(() => icon.evaluate(img => img.complete && img.naturalWidth === 24 && img.naturalHeight === 24)).toBe(true)
  const geometry = await icon.boundingBox()
  assert.equal(geometry.width, 24); assert.equal(geometry.height, 24)
  await expect(page.getByRole('button', { name: /Desactivar/ })).toHaveCount(0)
  const button = card.getByRole('button', { name: 'Activar', exact: true })
  const text = card.locator('p')
  const buttonBox = await button.boundingBox(), textBox = await text.boundingBox()
  assert.equal(buttonBox.x, textBox.x); assert.ok(buttonBox.y >= textBox.y + textBox.height)
  assert.ok(buttonBox.height >= 44)
  await page.screenshot({ path: path.join(output, 'turn-notifications-390.png'), fullPage: true })
  await page.setViewportSize({ width: 320, height: 740 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(button).toBeInViewport()
  const narrowButton = await button.boundingBox(), footer = await page.locator('footer').boundingBox()
  assert.ok(narrowButton.y + narrowButton.height <= footer.y, 'CTA remains reachable above the sticky footer after scrolling')
  await page.screenshot({ path: path.join(output, 'turn-notifications-320.png'), fullPage: true })
  await button.click()
  await expect(card).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Desactivar/ })).toHaveCount(0)
  await page.evaluate(() => window.__pushPreview('prompt', 'busy'))
  await expect(page.getByRole('button', { name: 'Activar' })).toBeDisabled()
  await page.evaluate(() => window.__pushPreview('granted', 'error'))
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activar' })).toHaveCount(0)
  await page.evaluate(() => window.__pushPreview('blocked', 'off', true))
  await expect(page.getByRole('status')).toContainText('Ajustes del dispositivo')
  await page.goto(origin + '/test/push-preview/index.html?lang=en')
  await expect(page.getByRole('button', { name: 'Enable', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 768, height: 1024 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(failures, [])
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, simulatedPermissions: true, noNativeOrNetworkPush: true, icon: geometry, viewportWidths: [390, 320, 768] }, null, 2))
  console.log(`PASS isolated push preview; screenshots in ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
