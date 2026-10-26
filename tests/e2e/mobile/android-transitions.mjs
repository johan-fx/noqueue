import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { request } from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// Real Capacitor Android WebView, driven over local CDP. The API and fixtures are
// ephemeral; this runner does not install APKs, reset app data, deploy, or send push.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const evidenceDir = path.join(root, 'reports/android-local/transitions')
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554'
assert.match(serial, /^emulator-\d+$/, 'This test is limited to the dedicated Android emulator')
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const origin = 'https://127.0.0.1:8788'
const ca = await readFile(path.join(root, 'reports/android-local/tls/res/raw/noqueue_local_ca.pem'))
const api = route => new Promise((resolve, reject) => {
  const req = request(origin + route, { ca, timeout: 15000 }, response => {
    let body = ''
    response.setEncoding('utf8').on('data', chunk => { body += chunk })
    response.on('end', () => {
      try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)) }
      catch (error) { reject(error) }
    })
  })
  req.on('error', reject)
  req.on('timeout', () => req.destroy(new Error('Local API timed out')))
  req.end()
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const foregroundPackage = () => {
  const dump = adb('shell', 'dumpsys', 'activity', 'activities')
  return dump.match(/topResumedActivity=ActivityRecord\{[^\n]*?\bu\d+\s+([^\s/]+)/)?.[1]
    ?? dump.match(/Resumed:\s*ActivityRecord\{[^\n]*?\bu\d+\s+([^\s/]+)/)?.[1]
    ?? null
}
const waitForAppForeground = async expected => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const foreground = foregroundPackage() === 'com.noqueueapp.android'
    if (foreground === expected) return
    await sleep(150)
  }
  throw new Error('Android app did not reach the expected foreground state')
}
const report = { status: 'running', at: new Date().toISOString(), serial, apiLevel: Number(adb('shell', 'getprop', 'ro.build.version.sdk')), screenshots: [], phases: [] }
const resultFile = path.join(evidenceDir, 'result.json')
const save = () => writeFile(resultFile, JSON.stringify(report, null, 2))
const redact = value => String(value).split('Call log:')[0]
  .replace(/[a-f0-9]{64}/gi, '[redacted]')
  .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
const videoPath = path.join(evidenceDir, `transitions-api${report.apiLevel}-${Date.now()}.mp4`)
const remoteVideoPath = `/sdcard/noqueue-transitions-${Date.now()}.mp4`
let browser, recorder, recorderPid

async function launch() {
  adb('shell', 'am', 'start', '-n', 'com.noqueueapp.android/.MainActivity')
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const pid = adb('shell', 'pidof', 'com.noqueueapp.android')
      assert.match(pid, /^\d+$/)
      adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`)
      // WebView does not implement Browser.setDownloadBehavior.
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults: true })
      const page = browser.contexts()[0]?.pages()[0]
      assert.ok(page, 'No real app WebView')
      page.setDefaultTimeout(20000)
      await page.goto('https://localhost/?lang=es')
      await page.waitForFunction(() => document.body.innerText.includes('¿Dónde quieres'), null, { timeout: 20000 })
      return page
    } catch {
      await browser?.close().catch(() => {})
      browser = undefined
      await sleep(500)
    }
  }
  throw new Error('Cannot attach to the Android app WebView; check emulator, app build and local TLS')
}
async function beginRecording() {
  recorder = spawn('adb', ['-s', serial, 'shell', 'screenrecord', '--time-limit', '180', remoteVideoPath], { stdio: 'ignore' })
  await sleep(900)
  if (recorder.exitCode !== null) throw new Error(`Android screenrecord exited early (${recorder.exitCode})`)
  const pids = adb('shell', 'pidof', 'screenrecord').split(/\s+/).filter(value => /^\d+$/.test(value))
  assert.equal(pids.length, 1, 'Expected exactly one screen recorder on the dedicated emulator')
  recorderPid = pids[0]
}
async function endRecording() {
  if (!recorderPid) return
  try { adb('shell', 'kill', '-INT', recorderPid) } catch { /* It may have reached its time limit. */ }
  await sleep(1200)
  try { execFileSync('adb', ['-s', serial, 'pull', remoteVideoPath, videoPath], { stdio: 'ignore' }) } finally {
    try { adb('shell', 'rm', '-f', remoteVideoPath) } catch { /* Remove only this uniquely named test video. */ }
    recorderPid = undefined
  }
}
async function runScenario(page, source, services, venue, options = {}) {
  const value = await page.evaluate(async ({ source, args }) => await (0, eval)(source)(args), {
    source,
    args: { services, venue, ...options },
  })
  assert.equal(value.status, 'passed')
  assert.equal(value.instrumented, value.apiSupported, 'If available, the WebView transition API must be instrumentable')
  const starts = value.transitions.filter(item => item.phase === 'start')
  if (options.simulateApiUnavailable) {
    assert.equal(value.apiSupported, false, 'Test-only API override must exercise the no-API branch')
    assert.equal(value.reducedMotion, false, 'No-API validation runs with normal motion preference')
    assert.equal(starts.length, 0, 'No-API navigation must remain functional without requesting transitions')
  } else if (value.reducedMotion) {
    assert.equal(starts.length, 0, 'Reduced motion must suppress route transitions')
  } else if (value.apiSupported) {
    assert.ok(starts.length >= 4, 'Real routes should be transitioned in Android WebView')
    for (const intent of ['forward', 'back', 'replace']) assert.ok(starts.some(item => item.intent === intent), `Missing ${intent} intent`)
    assert.ok(value.transitions.some(item => item.phase === 'ready'))
    assert.ok(value.transitions.some(item => item.phase === 'finished'))
  } else {
    assert.equal(starts.length, 0, 'Unsupported Android WebView must continue without animation')
  }
  return value
}

try {
  await mkdir(evidenceDir, { recursive: true })
  await save()
  assert.equal(report.apiLevel, 36, 'Use the dedicated noqueue-api36 AVD')
  assert.equal(adb('emu', 'avd', 'name').split('\n')[0].trim(), 'noqueue-api36', 'Use the dedicated test emulator')
  const webviewDump = adb('shell', 'dumpsys', 'webviewupdate')
  const currentWebView = webviewDump.match(/Current WebView package[^\n]*:\s*\(([^,\s()]+),\s*(\d+(?:\.\d+)+)\)/i)
    ?? webviewDump.match(/Valid package\s+([^\s()]+)\s+\(versionName:\s*(\d+(?:\.\d+)+)/i)
  assert.ok(currentWebView, 'Could not parse the active Android WebView provider/version from dumpsys')
  report.webViewPackage = currentWebView[1]
  report.webViewVersion = currentWebView[2]
  const initial = await api('/__local/evidence')
  assert.equal(initial.counts?.queue_entry, 0, 'Restart the ephemeral local API before each platform run')
  for (const table of ['mobile_push_registration', 'mobile_push_outbox', 'notification_outbox']) assert.equal(initial.counts?.[table] ?? 0, 0, 'Push remains disabled')
  adb('reverse', 'tcp:8788', 'tcp:8788')
  const page = await launch()
  const userAgent = await page.evaluate(() => navigator.userAgent)
  report.chromeVersion = userAgent.match(/Chrome\/([0-9.]+)/)?.[1] ?? 'unavailable'
  assert.ok(await page.evaluate(() => Boolean(window.Capacitor?.isNativePlatform?.())), 'Must run inside the installed native Capacitor shell')
  const source = await readFile(path.join(root, 'apps/mobile/ios/App/AppLocalTests/transition-scenarios.js'), 'utf8')
  await page.exposeFunction('__noqueueCapture', async name => {
    assert.match(name, /^[a-z-]{1,32}$/)
    const file = path.join(evidenceDir, `${name}.png`)
    await page.screenshot({ path: file })
    report.screenshots.push(path.basename(file))
    await save()
  })
  await page.exposeFunction('__noqueueNativeAction', async action => {
    assert.ok(['open-venue', 'open-service', 'back-overlay', 'back-active-turn', 'resume'].includes(action), 'Unknown test-only native action')
    if (action === 'open-venue' || action === 'open-service') {
      const route = action === 'open-venue'
        ? `/v/${initial.venue}`
        : `/q/${initial.services.reception}`
      // Explicit ACTION_VIEW targets the actual Capacitor Activity so its native
      // App plugin emits AppUrlOpen. The public fixture ID is kept only in RAM.
      execFileSync('adb', [
        '-s', serial, 'shell', 'am', 'start', '-W', '-n', 'com.noqueueapp.android/.MainActivity',
        '-a', 'android.intent.action.VIEW', '-d', `https://app.noqueue-app.com${route}?lang=es`,
      ], { stdio: 'ignore' })
      await waitForAppForeground(true)
      return 'app-url-delivered'
    }
    if (action === 'back-overlay' || action === 'back-active-turn') {
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
      if (action === 'back-active-turn') await waitForAppForeground(false)
      else await waitForAppForeground(true)
      return 'back-pressed'
    }
    adb('shell', 'am', 'start', '-W', '-n', 'com.noqueueapp.android/.MainActivity')
    await waitForAppForeground(true)
    return 'app-resumed'
  })
  await page.evaluate(() => {
    window.__noqueueNativeActions = [
      'open-venue', 'open-service', 'back-overlay', 'back-active-turn', 'resume',
    ]
  })
  await beginRecording()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const normal = await runScenario(page, source, initial.services, initial.venue, { reducedMotionOverride: false })
  for (const check of [
    'native AppUrlOpen route supersession',
    'Android Back dismisses overlay',
    'Android Back minimizes/resumes active turn without navigation',
  ]) assert.ok(normal.checks.includes(check), `Native Android scenario did not execute: ${check}`)
  report.apiSupported = normal.apiSupported
  report.phases.push({ name: 'normal-motion', apiSupported: normal.apiSupported, transitions: normal.transitions })
  await save()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await runScenario(page, source, initial.services, initial.venue, { reducedMotionOverride: true })
  report.phases.push({ name: 'reduced-motion', apiSupported: reduced.apiSupported, transitions: reduced.transitions })
  await save()

  if (normal.apiSupported) {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const unavailable = await runScenario(page, source, initial.services, initial.venue, { simulateApiUnavailable: true })
    report.phases.push({ name: 'api-unavailable-fallback', apiSupported: unavailable.apiSupported, transitions: unavailable.transitions })
    await save()
  } else {
    report.phases.push({ name: 'api-unavailable-fallback', apiSupported: false, exercisedBy: 'normal-motion-pass' })
  }
  await endRecording()

  const final = await api('/__local/evidence')
  assert.equal(final.counts?.queue_entry, 1, 'The test-created ticket should be cancelled')
  assert.equal(final.counts?.mobile_entry_installation, 1)
  for (const table of ['queue_entry_contact', 'consent', 'notification_outbox', 'mobile_push_registration', 'mobile_push_outbox']) {
    assert.equal(final.counts?.[table] ?? 0, 0, `${table} must remain empty`)
  }
  assert.deepEqual(final.statuses, [{ status: 'cancelled', n: 1 }])
  assert.ok((await stat(videoPath)).size > 1024, 'Android screen recording should contain visual evidence')
  Object.assign(report, { status: 'passed', video: path.relative(root, videoPath), database: final.counts, statuses: final.statuses, push: 'off' })
  await save()
  console.log(`PASS Android API ${report.apiLevel} / WebView ${report.chromeVersion}: native route transitions; evidence ${path.relative(root, evidenceDir)}`)
} catch (error) {
  report.status = 'failed'
  report.error = redact(error?.message ?? error)
  await endRecording().catch(() => {})
  await save()
  console.error(`FAIL ${report.error}`)
  process.exitCode = 1
} finally {
  await browser?.close()
  try {
    adb('shell', 'am', 'force-stop', 'com.noqueueapp.android')
    adb('forward', '--remove', 'tcp:9223')
    adb('reverse', '--remove', 'tcp:8788')
  } catch { /* Dedicated emulator only; no persistent app data is cleared. */ }
}
