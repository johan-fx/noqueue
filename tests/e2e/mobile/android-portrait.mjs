import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'

// Dedicated emulator + real Capacitor/Keystore + ephemeral API. No browser mocks.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'reports/android-local/portrait')
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554'
assert.match(serial, /^emulator-\d+$/)
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 }).trim()
assert.equal(adb('emu', 'avd', 'name').split('\n')[0].trim(), 'noqueue-api36')
const previousRotation = adb('shell', 'wm', 'user-rotation').split(/\s+/)
assert.ok(previousRotation[0] === 'free' || (previousRotation[0] === 'lock' && /^[0-3]$/.test(previousRotation[1])))
const ca = await readFile(path.join(root, 'reports/android-local/tls/res/raw/noqueue_local_ca.pem'))
const origin = 'https://127.0.0.1:8788'
const evidence = () => new Promise((resolve, reject) => {
  const req = request(`${origin}/__local/evidence`, { ca }, response => {
    let body = ''
    response.setEncoding('utf8').on('data', part => { body += part })
    response.on('end', () => {
      try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)) } catch (error) { reject(error) }
    })
  })
  req.on('error', reject)
  req.setTimeout(15000, () => req.destroy(new Error('Local evidence timeout')))
  req.end()
})
const rotation = () => {
  const dump = adb('shell', 'dumpsys', 'window', 'displays')
  return {
    requested: Number(dump.match(/mUserRotation=ROTATION_(\d+)/)?.[1]),
    actual: Number(dump.match(/mRotation=(\d+) mDeferredRotationPauseCount/)?.[1]),
    app: dump.match(/mCurrentAppOrientation=(\S+)/)?.[1],
  }
}
let browser, page
const report = { status: 'running', at: new Date().toISOString(), serial, phases: [], rotations: [], externalRequests: 0, pushRequests: 0 }
const save = () => writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
async function launch() {
  await browser?.close()
  adb('shell', 'am', 'force-stop', 'com.noqueueapp.android')
  adb('shell', 'am', 'start', '-n', 'com.noqueueapp.android/.MainActivity')
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      // Process visibility and its DevTools socket settle asynchronously after start.
      const pid = adb('shell', 'pidof', 'com.noqueueapp.android')
      assert.match(pid, /^\d+$/)
      adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`)
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults: true })
      page = browser.contexts()[0]?.pages()[0]
      assert.ok(page)
      page.setDefaultTimeout(20000)
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (!['https://localhost', origin].includes(url.origin)) { report.externalRequests++; return route.abort() }
        if (url.pathname.includes('/mobile/push')) { report.pushRequests++; return route.abort() }
        return route.continue()
      })
      await expect.poll(() => page.evaluate(() => Boolean(window.Capacitor?.isNativePlatform()))).toBe(true)
      return pid
    } catch {
      await browser?.close().catch(() => {})
      browser = undefined
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }
  throw new Error('Cannot attach to the dedicated native WebView')
}
// Return only a digest, never the identity or recoverable links, in diagnostics.
const identityDigest = () => page.evaluate(async () => {
  const { secret, pending } = JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value)
  if (!/^[a-f0-9]{64}$/.test(secret) || pending.length) throw new Error('Invalid identity or unfinished admission')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
})
async function portrait(phase) {
  for (const requested of [1, 3, 2, 0]) {
    adb('shell', 'wm', 'user-rotation', 'lock', String(requested))
    await expect.poll(() => rotation().requested).toBe(requested * 90)
    await expect.poll(() => rotation().actual).toBe(0)
    assert.equal(rotation().app, 'SCREEN_ORIENTATION_PORTRAIT')
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, portrait: matchMedia('(orientation: portrait)').matches }))
    assert.ok(viewport.portrait && viewport.height > viewport.width)
    report.rotations.push({ phase, requested: requested * 90, actual: 0, viewport })
  }
  await page.screenshot({ path: path.join(output, `${phase}.png`) })
}
try {
  await mkdir(output, { recursive: true }); await save()
  const initial = await evidence()
  assert.equal(initial.counts.queue_entry, 0, 'Start a fresh ephemeral API before this test')
  adb('reverse', 'tcp:8788', 'tcp:8788')
  adb('shell', 'wm', 'dismiss-keyguard')
  // Positive control: the emulator really can rotate before NoQueue constrains it.
  adb('shell', 'am', 'force-stop', 'com.noqueueapp.android')
  adb('shell', 'am', 'start', '-a', 'android.settings.SETTINGS')
  adb('shell', 'wm', 'user-rotation', 'lock', '1')
  await expect.poll(() => rotation().actual).toBe(1)
  report.rotationControl = 'Settings rotated to 90 degrees'
  await launch()
  await expect(page.getByRole('button', { name: /Escanear QR/ })).toBeVisible()
  const identity = await identityDigest()
  await portrait('01-home')
  let count = 0
  for (const type of ['restaurant', 'pool', 'reception']) {
    await page.goto(`https://localhost/q/${initial.services[type]}?lang=es`)
    const name = page.getByRole('textbox', { name: 'Nombre', exact: true })
    await expect(name).toBeVisible()
    assert.equal(await page.locator('input[type=tel]').count(), 0)
    assert.equal(await page.getByText(/WhatsApp/).count(), 0)
    await name.fill(`Portrait ${type}`)
    await portrait(`${type}-form`)
    const joined = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/entries'))
    await page.locator('button[type=submit]').click()
    const response = await joined
    assert.equal(response.status(), 201)
    const payload = response.request().postDataJSON()
    assert.ok(!('phone' in payload) && !('whatsapp' in payload))
    await expect(page.getByRole('button', { name: 'Abandonar la lista', exact: true })).toBeVisible()
    const turnPath = new URL(page.url()).pathname // RAM only: owner capability.
    await portrait(`${type}-active`)
    const oldPid = adb('shell', 'pidof', 'com.noqueueapp.android')
    assert.notEqual(await launch(), oldPid, 'Recovery must run in a fresh process')
    // No goto after launch: the native recovery gate must find the active turn itself.
    await expect.poll(() => new URL(page.url()).pathname).toBe(turnPath)
    await expect(page.getByRole('button', { name: 'Abandonar la lista', exact: true })).toBeVisible()
    assert.equal(await identityDigest(), identity, 'Keystore identity changed')
    await portrait(`${type}-recovered`)
    await page.getByRole('button', { name: 'Abandonar la lista', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sí, abandonar la lista de espera', exact: true })).toBeVisible()
    await portrait(`${type}-confirmation`)
    const cancelled = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/commands'))
    await page.getByRole('button', { name: 'Sí, abandonar la lista de espera', exact: true }).click()
    assert.equal((await cancelled).status(), 200)
    await expect(page.getByText('Ya no estás en la lista de espera', { exact: true })).toBeVisible()
    await portrait(`${type}-cancelled`)
    const db = await evidence()
    count++
    assert.equal(db.counts.queue_entry, count)
    assert.equal(db.counts.mobile_entry_installation, count)
    assert.deepEqual(db.statuses, [{ status: 'cancelled', n: count }])
    for (const table of ['queue_entry_contact', 'consent', 'notification_outbox', 'mobile_push_registration', 'mobile_push_outbox']) assert.equal(db.counts[table], 0)
    await launch()
    await expect(page.getByRole('button', { name: /Escanear QR/ })).toBeVisible()
    assert.equal(await identityDigest(), identity)
    report.phases.push({ service: type, admission: true, coldRecovery: true, identityPreserved: true, cancellation: true, homeAfterCancel: true })
    await save()
    console.log(`PASS portrait + anonymous admission/cold recovery/cancellation: ${type}`)
  }
  const final = await evidence()
  assert.equal(report.externalRequests, 0)
  assert.equal(report.pushRequests, 0)
  Object.assign(report, { status: 'passed', database: final.counts, statuses: final.statuses, byService: final.byService })
  await save()
} catch (error) {
  report.status = 'failed'; await save()
  console.error(String(error.stack ?? error.message).split('Call log:')[0].replace(/[a-f0-9]{64}/g, '[redacted]'))
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  try { adb('shell', 'am', 'force-stop', 'com.noqueueapp.android') } catch { /* Local cleanup only. */ }
  try { adb('shell', 'wm', 'user-rotation', ...previousRotation) } catch { process.exitCode = 1 }
  for (const args of [['forward', '--remove', 'tcp:9223'], ['reverse', '--remove', 'tcp:8788']]) {
    try { adb(...args) } catch { /* Mapping may not have been created. */ }
  }
}
