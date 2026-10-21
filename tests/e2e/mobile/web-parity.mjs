import { chromium, expect } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../../', import.meta.url)), dir = path.join(root, 'reports/mobile-parity')
await mkdir(dir, { recursive: true })
const fixture = await (await fetch('http://127.0.0.1:4173/__local/evidence')).json()
const turn = JSON.parse(await readFile(path.join(root, 'reports/android-local/parity-turn-fixture.json'), 'utf8'))
const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of [{ name: 'android', width: 412, height: 839, deviceScaleFactor: 2.625 }, { name: 'ios', width: 402, height: 874, deviceScaleFactor: 3 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor, isMobile: true, hasTouch: true, locale: 'es-ES' })
    // Match the simulator's empty recent-services state after an ephemeral DB reset.
    await context.addInitScript(() => localStorage.setItem('noqueue.recent-services', '["previous-local-fixture"]'))
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    const shot = async name => { await page.evaluate(async () => { await document.fonts.ready; if (document.activeElement instanceof HTMLElement) document.activeElement.blur() }); await page.screenshot({ path: path.join(dir, `web-${viewport.name}-${name}.png`) }) }
    await page.goto('http://127.0.0.1:4173/?lang=es')
    await expect(page.getByRole('button', { name: /Escanear QR/ })).toBeVisible()
    await shot('01-home')
    await page.getByRole('button', { name: 'Busca un establecimiento', exact: true }).click()
    await page.getByRole('textbox').fill('Establecimiento local')
    await expect(page.locator('a[href^="/q/"]')).toHaveCount(3)
    await shot('02-search')
    await page.getByRole('button', { name: 'Restaurantes', exact: true }).click()
    await expect(page.locator('a[href^="/q/"]')).toHaveCount(1)
    await shot('03-filter')
    await page.goto(`http://127.0.0.1:4173/v/${fixture.venue}?lang=es`)
    await expect(page.getByRole('heading', { name: /Te damos la bienvenida/ })).toBeVisible()
    await shot('04-venue')
    await page.locator(`a[href^="/q/${fixture.services.reception}"]`).click()
    await page.getByLabel('Nombre', { exact: true }).fill('Prueba discovery local')
    await shot('05-form')
    // Read-only render of a synthetic local entry captured from the native smoke.
    // This is visual comparison, not a web admission or delivery test.
    await page.route('**/api/v1/public/entries/' + '00'.repeat(32), route => route.fulfill({ json: turn }))
    await page.goto('http://127.0.0.1:4173/t/' + '00'.repeat(32) + '?lang=es')
    await expect(page.getByRole('button', { name: 'Abandonar la lista' })).toBeVisible()
    await page.evaluate(() => { history.replaceState({ ...history.state, usr: { joined: true } }, ''); dispatchEvent(new PopStateEvent('popstate')) })
    await expect(page.getByText('¡Ya estás en lista de espera!', { exact: true })).toBeVisible()
    await shot('06-turn')
    await context.close()
  }
  await writeFile(path.join(dir, 'web-result.json'), JSON.stringify({ status: 'passed', at: new Date().toISOString(), viewports: ['412x839@2.625','402x874@3'], sharedCatalog: true, turn: 'read-only synthetic fixture, no web admission' }, null, 2))
} finally { await browser.close() }
