import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'


// Real Capacitor WebView and native Keystore; not a mocked browser runtime.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const evidenceDir = path.join(root, 'reports/android-local')
const ca = await readFile(path.join(evidenceDir, 'tls/res/raw/noqueue_local_ca.pem'))
const origin = 'https://127.0.0.1:8788'
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554'
if (!/^emulator-\d+$/.test(serial)) throw new Error('This smoke is emulator-only')
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
function api(route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(origin + route, { ca, ...options }, response => {
      let body = ''
      response.setEncoding('utf8').on('data', part => { body += part })
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }))
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Local API timeout')))
    if (options.body) req.write(options.body)
    req.end()
  })
}
let browser
async function launch() {
  await browser?.close()
  adb('shell', 'am', 'force-stop', 'com.noqueue.app')
  adb('shell', 'am', 'start', '-n', 'com.noqueue.app/.MainActivity')
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const pid = adb('shell', 'pidof', 'com.noqueue.app')
      if (!/^\d+$/.test(pid)) throw new Error('App not started')
      adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`)
      // Android WebView does not implement Browser.setDownloadBehavior.
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults: true })
      const page = browser.contexts()[0]?.pages()[0]
      if (!page) throw new Error('No WebView')
      page.setDefaultTimeout(15000)
      await page.goto('https://localhost/turns?lang=es')
      await expect(page.getByRole('button', { name: /Escanear QR/ })).toBeVisible()
      return page
    } catch {
      await browser?.close().catch(() => {})
      browser = undefined
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw new Error('Cannot attach to the Debug WebView; check adb and API TLS')
}
const resultFile = path.join(evidenceDir, 'discovery-result.json')
const report = { status: 'running', at: new Date().toISOString(), serial }
const save = () => writeFile(resultFile, JSON.stringify(report, null, 2))
try {
  await mkdir(evidenceDir, { recursive: true })
  await save()
  assert.equal(adb('emu', 'avd', 'name').split('\n')[0].trim(), 'noqueue-api36', 'Use the dedicated test emulator')
  const initial = (await api('/__local/evidence')).body
  assert.equal(initial.counts.queue_entry, 0, 'Restart ephemeral local API before discovery smoke')
  adb('reverse', 'tcp:8788', 'tcp:8788')
  const page = await launch()
  const source = await readFile(path.join(root, 'apps/mobile/ios/App/AppLocalTests/discovery-scenarios.js'), 'utf8')
  await page.exposeFunction('__noqueueCapture', async name => {
    assert.match(name, /^0[1-6]-[a-z]+$/)
    if (name === '06-turn') {
      const entry = await page.evaluate(async () => {
        const secret = JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value).secret
        return (await fetch('https://127.0.0.1:8788/api/v1/mobile/entries/' + location.pathname.split('/')[2], { headers: { Authorization: `Bearer ${secret}` }, credentials: 'omit' })).json()
      })
      await writeFile(path.join(evidenceDir, 'parity-turn-fixture.json'), JSON.stringify(entry))
    }
    await page.screenshot({ path: path.join(evidenceDir, `parity-${name}.png`) })
  })
  const result = await page.evaluate(async ({ source, args }) => await (0, eval)(source)(args), { source, args: { services: initial.services, venue: initial.venue } })
  assert.equal(result.status, 'passed')
  await page.screenshot({ path: path.join(evidenceDir, 'discovery-home.png') })
  await page.getByRole('button', { name: 'Busca un establecimiento', exact: true }).click()
  await page.getByRole('textbox').fill('Establecimiento local')
  await expect(page.locator('a[href^="/q/"]').first()).toBeVisible()
  await page.screenshot({ path: path.join(evidenceDir, 'discovery-search.png') })
  await page.goto(`https://localhost/v/${initial.venue}?lang=es`)
  await expect(page.getByRole('heading', { name: /Te damos la bienvenida/ })).toBeVisible()
  await page.screenshot({ path: path.join(evidenceDir, 'discovery-venue.png') })
  const final = (await api('/__local/evidence')).body
  assert.equal(final.counts.queue_entry, 1)
  assert.equal(final.counts.mobile_entry_installation, 1)
  for (const table of ['queue_entry_contact', 'consent', 'notification_outbox', 'mobile_push_registration', 'mobile_push_outbox']) assert.equal(final.counts[table], 0)
  assert.deepEqual(final.statuses, [{ status: 'cancelled', n: 1 }])
  Object.assign(report, result, { database: final.counts, statuses: final.statuses })
  await save()
  console.log('PASS native discovery: home/search/filter/venue/back/anonymous admission/recovery/cancel; push OFF')
} catch (error) {
  report.status = 'failed'; await save()
  console.error(String(error.message).split('Call log:')[0].replace(/[a-f0-9]{64}/g, '[redacted]'))
  process.exitCode = 1
} finally {
  await browser?.close()
  try { adb('shell', 'am', 'force-stop', 'com.noqueue.app'); adb('forward', '--remove', 'tcp:9223'); adb('reverse', '--remove', 'tcp:8788') } catch { /* Local cleanup only. */ }
}
