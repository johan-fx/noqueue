import { lifecycleControl } from '../../../apps/mobile/scripts/lifecycle-control.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'

const lifecycleMode = process.argv.includes('--lifecycle')
assert.ok(process.argv.slice(2).every(a => a === '--lifecycle'), 'Unknown test option')
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
const source = await readFile(path.join(root, 'apps/mobile/ios/App/AppLocalTests/service-scenarios.js'), 'utf8')
const lifecycleSource = lifecycleMode ? await readFile(path.join(root, 'apps/mobile/ios/App/AppLocalTests/lifecycle-scenarios.js'), 'utf8') : null
const resultFile = path.join(evidenceDir, lifecycleMode ? 'lifecycle-result.json' : 'services-result.json')
const report = { status: 'running', at: new Date().toISOString(), serial, phases: [] }
const save = () => writeFile(resultFile, JSON.stringify(report, null, 2))
try {
  await mkdir(evidenceDir, { recursive: true })
  await save()
  assert.equal(adb('emu', 'avd', 'name').split('\n')[0].trim(), 'noqueue-api36', 'Use the dedicated test emulator')
  const initial = (await api('/__local/evidence')).body
  assert.equal(initial.counts.queue_entry, 0, 'Restart ephemeral API before service smoke')
  assert.ok(initial.services.restaurant && initial.services.pool, 'Missing service fixtures')
  adb('reverse', 'tcp:8788', 'tcp:8788')
  let expected, lastPID, knownLinks
  for (const phase of lifecycleMode ? ['seed', 'called', 'terminal', 'recovered'] : ['seed', 'restaurant', 'pool', 'empty']) {
    if (phase === 'called') await lifecycleControl('call')
    if (phase === 'terminal') {
      await lifecycleControl('complete')
      await lifecycleControl('expire')
    }
    const page = await launch()
    const pid = adb('shell', 'pidof', 'com.noqueueapp.android')
    assert.notEqual(pid, lastPID, 'Each phase requires a new app process')
    lastPID = pid
    const result = await page.evaluate(async ({ source, args }) => await (0, eval)(source)(args), {
      source: lifecycleMode && phase !== 'seed' ? lifecycleSource : source, args: { phase, services: initial.services, expected, links: knownLinks }
    })
    if (phase === 'seed') {
      expected = result
      if (lifecycleMode) knownLinks = await page.evaluate(async expected => {
        const secret = JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value).secret
        const r = await fetch('https://127.0.0.1:8788/api/v1/mobile/entries', { headers: { Authorization: 'Bearer ' + secret } })
        return await Promise.all((await r.json()).entries.map(async e => {
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e.recoveryToken))), b => b.toString(16).padStart(2, '0')).join('')
          const ticket = expected.tickets.find(t => t.digest === hash)
          return { token: e.recoveryToken, type: ticket.type, index: ticket.index }
        }))
      }, expected) // RAM only; never include knownLinks in the report.
    }
    const counts = (await api('/__local/evidence')).body.counts
    assert.equal(counts.queue_entry, 4)
    assert.equal(counts.mobile_entry_installation, 4)
    for (const table of ['queue_entry_contact', 'consent', 'notification_outbox']) assert.equal(counts[table], 0)
    const native = await vault(page)
    const ciphertext = execFileSync('adb', ['-s', serial, 'exec-out', 'run-as', 'com.noqueueapp.android', 'cat', 'no_backup/noqueue-installation.v1'])
    assert.ok(ciphertext.length > 28 && !ciphertext.includes(Buffer.from(native.secret)), 'Vault must stay encrypted')
    await page.screenshot({ path: path.join(evidenceDir, `${lifecycleMode ? 'lifecycle' : 'services'}-${phase}.png`) })
    report.phases.push({ name: phase, pid: Number(pid), ...result })
    await save()
    console.log(`PASS ${lifecycleMode ? 'lifecycle' : 'services'} ${phase}`)
  }
  const final = (await api('/__local/evidence')).body
  assert.deepEqual(final.statuses, lifecycleMode ? [{ status: 'completed', n: 2 }, { status: 'expired', n: 2 }] : [{ status: 'cancelled', n: 4 }])
  if (!lifecycleMode) assert.deepEqual(final.byService, [{ type: 'pool', status: 'cancelled', n: 2 }, { type: 'restaurant', status: 'cancelled', n: 2 }])
  if (lifecycleMode) assert.deepEqual(final.byService, ['pool', 'restaurant'].flatMap(type =>
    [{ type, status: 'completed', n: 1 }, { type, status: 'expired', n: 1 }]))
  Object.assign(report, { status: 'passed', database: final.counts, byService: final.byService })
  await save()
  console.log('PASS four terminal mobile tickets; zero phone/consent/WhatsApp')
} catch (error) {
  console.error(`FAIL ${String(error.message).split('Call log:')[0].replace(/[a-f0-9]{64}/g, '[redacted]')}`)
  report.status = 'failed'
  await save()
  process.exitCode = 1
} finally {
  await browser?.close()
  try { adb('forward', '--remove', 'tcp:9223') } catch { /* Not attached */ }
}
