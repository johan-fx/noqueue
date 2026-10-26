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
    if (options.body) req.write(options.body)
    req.end()
  })
}
let browser
async function launch() {
  await browser?.close()
  adb('shell', 'am', 'force-stop', 'com.noqueueapp.android')
  adb('shell', 'am', 'start', '-n', 'com.noqueueapp.android/.MainActivity')
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const pid = adb('shell', 'pidof', 'com.noqueueapp.android')
      if (!/^\d+$/.test(pid)) throw new Error('App not started')
      adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`)
      // Android WebView does not implement Browser.setDownloadBehavior.
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults: true })
      const page = browser.contexts()[0]?.pages()[0]
      if (!page) throw new Error('No WebView')
      page.setDefaultTimeout(15000)
      await page.goto('https://localhost/turns?lang=es')
      await expect(page.getByText('Tus turnos', { exact: true })).toBeVisible()
      return page
    } catch {
      await browser?.close().catch(() => {})
      browser = undefined
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw new Error('Cannot attach to the Debug WebView; check adb and API TLS')
}
const vault = page => page.evaluate(async () => JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value))
const results = []
const pass = name => { results.push(name); console.log(`PASS ${name}`) }
try {
  await mkdir(evidenceDir, { recursive: true })
  // Never leave a previous successful result looking like this run's evidence.
  await writeFile(path.join(evidenceDir, 'smoke-result.json'), JSON.stringify({ status: 'running', at: new Date().toISOString(), serial }))
  const initial = (await api('/__local/evidence')).body
  assert.equal(initial.counts.queue_entry, 0, 'Restart dev-mobile.mjs before each smoke')
  adb('reverse', 'tcp:8788', 'tcp:8788')
  let page = await launch()
  await expect(page.getByText(/No tienes turnos activos/)).toBeVisible()
  const identity = (await vault(page)).secret
  assert.ok(/^[a-f0-9]{64}$/.test(identity), 'Missing native anonymous identity')
  pass('Native vault initializes without registration')
  const servicePath = `/q/${initial.service}?lang=es`
  await page.goto(`https://localhost${servicePath}`)
  await expect(page.getByRole('textbox', { name: 'Nombre', exact: true })).toBeVisible()
  assert.equal(await page.locator('input[type=tel]').count(), 0)
  assert.equal(await page.getByText(/WhatsApp/).count(), 0)
  await page.screenshot({ path: path.join(evidenceDir, '01-mobile-form.png') })
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Prueba Android local')
  const joined = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/entries'))
  await page.locator('button[type=submit]').click()
  const response = await joined
  assert.equal(response.status(), 201)
  const payload = response.request().postDataJSON()
  assert.ok(!('whatsapp' in payload) && !('phone' in payload), 'Mobile payload contains phone/WhatsApp')
  const token = (await response.json()).recoveryToken
  await expect(page.getByRole('button', { name: 'Abandonar la lista', exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(evidenceDir, '02-active-turn.png') })
  pass('Real UI admission has no phone/WhatsApp, API returns 201')
  const unauthorized = await page.evaluate(async ({ origin, token }) => {
    const other = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
    const read = await fetch(`${origin}/api/v1/mobile/entries/${token}`, { headers: { Authorization: `Bearer ${other}` } })
    const cancel = await fetch(`${origin}/api/v1/mobile/entries/${token}/commands`, { method: 'POST', headers: { Authorization: `Bearer ${other}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ action: 'cancel', version: 0 }) })
    const missing = await fetch(`${origin}/api/v1/mobile/entries`)
    return [read.status, cancel.status, missing.status]
  }, { origin, token })
  assert.deepEqual(unauthorized, [404, 404, 401])
  pass('Another installation cannot read/cancel; missing identity returns 401')
  const ciphertext = execFileSync('adb', ['-s', serial, 'exec-out', 'run-as', 'com.noqueueapp.android', 'cat', 'no_backup/noqueue-installation.v1'])
  assert.ok(ciphertext.length > 28 && !ciphertext.includes(Buffer.from(identity)), 'Vault is plaintext')
  page = await launch()
  await expect(page.getByRole('link', { name: 'Abrir turno 1', exact: true })).toBeVisible()
  assert.ok((await vault(page)).secret === identity, 'Identity changed after force-stop')
  await page.screenshot({ path: path.join(evidenceDir, '03-recovered-turn.png') })
  await page.getByRole('link', { name: 'Abrir turno 1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Abandonar la lista', exact: true })).toBeVisible()
  pass('Encrypted no-backup vault and active ticket survive process death')
  adb('install', '-r', path.join(root, 'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk'))
  page = await launch()
  assert.ok((await vault(page)).secret === identity, 'Identity changed after APK replacement')
  await page.getByRole('link', { name: 'Abrir turno 1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Abandonar la lista', exact: true })).toBeVisible()
  pass('Replacing the Debug APK with adb install -r preserves identity and active ticket')
  async function cancel() {
    await page.getByRole('button', { name: 'Abandonar la lista', exact: true }).click()
    const confirmed = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/commands'))
    await page.getByRole('button', { name: 'Sí, abandonar la lista de espera', exact: true }).click()
    assert.equal((await confirmed).status(), 200)
    await page.goto('https://localhost/turns?lang=es')
    await expect(page.getByText(/No tienes turnos activos/)).toBeVisible()
  }
  await cancel()
  pass('Owner cancels via UI and active list becomes empty')
  // Commit exactly one real request, then drop its response: no mocked API result.
  await page.goto(`https://localhost${servicePath}`)
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Respuesta perdida')
  let committed = false
  await page.route(`${origin}/api/v1/mobile/services/${initial.service}/entries`, async route => {
    const req = route.request()
    const headers = await req.allHeaders()
    const result = await api(`/api/v1/mobile/services/${initial.service}/entries`, { method: 'POST', headers: {
      Origin: 'https://localhost', Authorization: headers.authorization,
      'Content-Type': 'application/json', 'Idempotency-Key': headers['idempotency-key'],
    }, body: req.postData() })
    committed = result.status === 201
    await route.abort('failed')
  }, { times: 1 })
  await page.locator('button[type=submit]').click()
  await expect.poll(() => committed).toBe(true)
  const pending = (await vault(page)).pending
  assert.equal(pending.length, 1)
  page = await launch()
  await expect(page.getByRole('link', { name: 'Abrir turno 1', exact: true })).toBeVisible()
  assert.ok((await vault(page)).pending[0].key === pending[0].key, 'Pending key did not survive process death')
  await page.goto(`https://localhost${servicePath}`)
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Respuesta perdida')
  const replay = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/entries'))
  await page.locator('button[type=submit]').click()
  const replayResponse = await replay
  assert.equal(replayResponse.status(), 200)
  assert.ok(replayResponse.request().headers()['idempotency-key'] === pending[0].key, 'Replay did not reuse persisted key')
  await expect(page.getByRole('button', { name: 'Abandonar la lista', exact: true })).toBeVisible()
  assert.equal((await vault(page)).pending.length, 0)
  assert.equal((await api('/__local/evidence')).body.counts.queue_entry, 2)
  pass('Lost committed response survives restart and replays idempotently without duplication')
  await cancel()
  const final = (await api('/__local/evidence')).body
  assert.equal(final.counts.queue_entry, 2)
  assert.equal(final.counts.mobile_entry_installation, 2)
  for (const table of ['queue_entry_contact', 'consent', 'notification_outbox']) assert.equal(final.counts[table], 0)
  assert.deepEqual(final.statuses, [{ status: 'cancelled', n: 2 }])
  pass('D1 evidence: two cancelled mobile tickets, zero phone contacts/consents/WhatsApp outbox')
  const logs = adb('logcat', '-d', '--pid', adb('shell', 'pidof', 'com.noqueueapp.android'))
  assert.ok(!logs.includes(identity) && !logs.includes(token), 'Credential leaked into native logcat')
  pass('Current process native logs contain no installation secret or ticket capability')
  const vaultFile = 'no_backup/noqueue-installation.v1'
  adb('shell', 'run-as', 'com.noqueueapp.android', 'cp', vaultFile, `${vaultFile}.smoke-copy`)
  try {
    adb('shell', `run-as com.noqueueapp.android sh -c 'printf corrupt > ${vaultFile}'`)
    page = await launch()
    await expect(page.getByRole('alert')).toContainText('No se pueden actualizar los datos')
    await assert.rejects(() => vault(page))
    assert.equal(adb('shell', 'run-as', 'com.noqueueapp.android', 'cat', vaultFile), 'corrupt')
  } finally {
    adb('shell', 'run-as', 'com.noqueueapp.android', 'mv', `${vaultFile}.smoke-copy`, vaultFile)
  }
  page = await launch()
  await expect(page.getByText(/No tienes turnos activos/)).toBeVisible()
  assert.ok((await vault(page)).secret === identity, 'Corruption silently replaced identity')
  pass('Corrupt native vault fails closed, never replaces identity; restoration recovers access')
  await writeFile(path.join(evidenceDir, 'smoke-result.json'), JSON.stringify({ status: 'passed', at: new Date().toISOString(), serial, api: Number(adb('shell', 'getprop', 'ro.build.version.sdk')), results, database: final.counts, statuses: final.statuses }, null, 2))
} catch (error) {
  // Do not print Playwright call logs: their URLs may contain ticket capabilities.
  console.error(`FAIL ${(error instanceof Error ? error.message : String(error)).split('Call log:')[0].replace(/[a-f0-9]{64}/g, '[redacted]')}`)
  await writeFile(path.join(evidenceDir, 'smoke-result.json'), JSON.stringify({ status: 'failed', at: new Date().toISOString(), serial, completedChecks: results }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  try { adb('forward', '--remove', 'tcp:9223') } catch { /* May not have attached. */ }
}
