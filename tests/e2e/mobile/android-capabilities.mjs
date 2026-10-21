import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../../', import.meta.url)), output = path.join(root, 'reports/android-local')
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554'
assert.match(serial, /^emulator-\d+$/)
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
assert.equal(adb('emu', 'avd', 'name').split('\n')[0].trim(), 'noqueue-api36')
let browser, locationTimer
const report = { status: 'running', at: new Date().toISOString() }
try {
  await mkdir(output, { recursive: true })
  adb('reverse', 'tcp:8788', 'tcp:8788')
  adb('shell', 'pm', 'grant', 'com.noqueue.app', 'android.permission.CAMERA')
  adb('shell', 'pm', 'grant', 'com.noqueue.app', 'android.permission.ACCESS_COARSE_LOCATION')
  adb('emu', 'geo', 'fix', '-3.7038', '40.4168')
  adb('shell', 'am', 'start', '-n', 'com.noqueue.app/.MainActivity')
  for (let i = 0; i < 30; i++) {
    try {
      const pid = adb('shell', 'pidof', 'com.noqueue.app')
      assert.match(pid, /^\d+$/)
      adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`)
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults: true }); break
    } catch { await new Promise(r => setTimeout(r, 500)) }
  }
  assert.ok(browser)
  const page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(20000)
  await page.goto('https://localhost/?lang=es')
  await expect(page.getByRole('button', { name: /Escanear QR/ })).toBeVisible()
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }))
  await page.getByRole('button', { name: /Escanear QR/ }).click()
  await expect.poll(() => page.locator('video').evaluate(v => Boolean(v.srcObject?.active))).toBe(true)
  await page.evaluate(() => { window.__testTracks = document.querySelector('video').srcObject.getTracks() })
  await page.screenshot({ path: path.join(output, 'parity-camera.png') })
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__testTracks.every(t => t.readyState === 'ended'))).toBe(true)
  report.cameraStream = 'passed'; report.cameraClosed = 'passed'
  adb('shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', 'allow')
  adb('shell', 'cmd', 'location', 'providers', 'add-test-provider', 'network', '--requiresNetwork')
  adb('shell', 'cmd', 'location', 'providers', 'set-test-provider-enabled', 'network', 'true')
  const inject = () => adb('shell', 'cmd', 'location', 'providers', 'set-test-provider-location', 'network', '--location', '40.4168,-3.7038', '--accuracy', '50')
  inject(); locationTimer = setInterval(inject, 500)
  report.locationSource = 'Android test network provider'
  const requestPromise = page.waitForRequest(r => r.url().endsWith('/mobile/search') && r.postDataJSON()?.coordinates, { timeout: 20000 })
  await page.getByRole('button', { name: /Usar mi ubicación/ }).click()
  const request = await requestPromise.catch(async error => {
    report.locationDiagnostic = await page.evaluate(async () => {
      const plugin = window.Capacitor.Plugins.Geolocation
      try { const permission = await plugin.checkPermissions(); const position = await plugin.getCurrentPosition({ enableHighAccuracy: false, timeout: 2000 }); return { permission, positionAvailable: !!position.coords } }
      catch (error) { return { code: error.code, message: error.message } }
    })
    throw error
  })
  const coordinates = request.postDataJSON().coordinates
  assert.ok(Math.abs(coordinates.latitude - 40.4168) < 0.1 && Math.abs(coordinates.longitude + 3.7038) < 0.1)
  await expect(page.locator('a[href^="/q/"]').first()).toBeVisible()
  await page.screenshot({ path: path.join(output, 'parity-location.png') })
  report.location = 'passed'; report.status = 'passed'
} catch (error) { report.status = 'failed'; report.error = String(error.message).split('Call log:')[0].replace(/[a-f0-9]{64}/g, '[redacted]'); process.exitCode = 1 }
finally {
  clearInterval(locationTimer)
  try { adb('shell', 'cmd', 'location', 'providers', 'remove-test-provider', 'network'); adb('shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', 'default') } catch { /* no provider if setup failed */ }
  await writeFile(path.join(output, 'capabilities-result.json'), JSON.stringify(report, null, 2))
  await browser?.close()
  try { adb('shell', 'am', 'force-stop', 'com.noqueue.app'); adb('forward', '--remove', 'tcp:9223'); adb('reverse', '--remove', 'tcp:8788') } catch { /* dedicated emulator only */ }
}
console.log(JSON.stringify(report))
