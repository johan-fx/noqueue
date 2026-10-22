import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:https'

// Runs only against the dedicated simulator and ephemeral local API described in
// docs/runbooks/mobile-local.md. No device reset, Keychain access, deploy, or push.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'reports/ios-local/transitions')
await mkdir(output, { recursive: true })
const run = await mkdtemp(path.join(output, 'run-'))
const simulator = (process.env.IOS_SIMULATOR_ID ?? process.env.IOS_TRANSITIONS_SIMULATOR_ID ??
  await readFile(path.join(root, 'reports/ios-local/simulator-id'), 'utf8')).trim()
assert.match(simulator, /^[A-F0-9-]{36}$/i, 'Set IOS_SIMULATOR_ID to the dedicated iOS 18 or iOS 27 simulator')
const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { encoding: 'utf8' }))
const runtimeEntry = Object.entries(devices.devices).flatMap(([runtime, list]) => list.map(device => ({ runtime, device })))
  .find(({ device }) => device.udid === simulator)
assert.ok(runtimeEntry?.device.name.startsWith('NoQueue iOS'), 'Select a dedicated NoQueue simulator; never use a personal device')
assert.equal(runtimeEntry.device.state, 'Booted', 'Boot the dedicated NoQueue simulator before running this test')
const runtime = runtimeEntry.runtime
const expectedRuntime = process.env.IOS_TRANSITIONS_EXPECT_RUNTIME
if (expectedRuntime) {
  assert.match(expectedRuntime, /^(18|27)$/)
  assert.match(runtime, new RegExp(`iOS-${expectedRuntime}-`), `Selected simulator is not iOS ${expectedRuntime}`)
}

const ca = await readFile(path.join(root, 'reports/android-local/tls/res/raw/noqueue_local_ca.pem'))
const evidence = () => new Promise((resolve, reject) => {
  const req = request('https://127.0.0.1:8788/__local/evidence', { ca, timeout: 15000 }, response => {
    let body = ''
    response.setEncoding('utf8').on('data', part => { body += part })
    response.on('end', () => {
      try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)) }
      catch (error) { reject(error) }
    })
  })
  req.on('error', reject)
  req.on('timeout', () => req.destroy(new Error('Local API timed out')))
  req.end()
})

const derived = process.env.NOQUEUE_IOS_DERIVED_DATA ?? '/tmp/noqueue-mobile-ios'
const resultPath = path.join(run, 'transitions.xcresult')
const logPath = path.join(run, 'xcodebuild.log')
const videoPath = path.join(output, `transitions-${runtime.replaceAll('.', '-')}-${Date.now()}.mp4`)
const common = [
  '-project', path.join(root, 'apps/mobile/ios/App/App.xcodeproj'),
  '-scheme', 'LocalSmoke', '-configuration', 'Debug',
  '-destination', `platform=iOS Simulator,id=${simulator}`,
  '-destination-timeout', '30', '-derivedDataPath', derived,
  '-clonedSourcePackagesDirPath', '/tmp/noqueue-mobile-spm', '-parallel-testing-enabled', 'NO',
]

let video
let status = 'running'
const report = { status, at: new Date().toISOString(), simulator, runtime, minimumOSVersion: null, video: path.relative(root, videoPath), resultBundle: path.relative(root, resultPath) }
const save = () => writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
const launchVideo = async () => {
  video = spawn('xcrun', ['simctl', 'io', simulator, 'recordVideo', '--codec=h264', videoPath], { stdio: 'ignore' })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 700)
    video.once('error', error => { clearTimeout(timer); reject(error) })
    video.once('exit', code => { clearTimeout(timer); reject(new Error(`Simulator screen recording exited early (${code})`)) })
  })
}
const stopVideo = async () => {
  if (!video || video.exitCode !== null) return
  const closed = new Promise(resolve => video.once('close', resolve))
  video.kill('SIGINT')
  await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000))])
  video = undefined
}
const runXcode = async (args, label) => {
  const log = await open(logPath, 'a')
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn('xcodebuild', [...common, ...args], { cwd: root, stdio: ['ignore', log.fd, log.fd] })
      child.once('error', reject)
      child.once('exit', resolve)
    })
    assert.equal(code, 0, `Xcode ${label} failed; inspect ${path.relative(root, logPath)} locally`)
  } finally { await log.close() }
}

try {
  const before = await evidence()
  assert.equal(before.counts?.queue_entry, 0, 'Restart the ephemeral dev:mobile API before each platform run')
  assert.equal(before.counts?.mobile_push_registration ?? 0, 0, 'Push must remain disabled')
  await save()
  await runXcode(['CODE_SIGN_IDENTITY=-', 'build-for-testing'], 'build-for-testing')

  const appPath = path.join(derived, 'Build/Products/Debug-iphonesimulator/App.app')
  const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Info.plist')], { encoding: 'utf8' }))
  report.minimumOSVersion = info.MinimumOSVersion
  assert.equal(info.MinimumOSVersion, '18.0', 'Built native app must advertise iOS 18.0 as its minimum')
  await save()

  await launchVideo()
  await runXcode([
    '-only-testing:AppLocalTests/TransitionSmokeTests/testNativeViewTransitions',
    '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '240',
    '-maximum-test-execution-time-allowance', '300',
    '-resultBundlePath', resultPath, 'test-without-building',
  ], 'native transition test')
  await stopVideo()
  const summary = JSON.parse(execFileSync('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', resultPath], { encoding: 'utf8' }))
  assert.equal(summary.passedTests, 1, 'Expected exactly one XCTest transition scenario')
  assert.equal(summary.failedTests, 0)
  const final = await evidence()
  assert.equal(final.counts?.queue_entry, 1, 'The test-created turn should be cancelled')
  assert.equal(final.counts?.mobile_entry_installation, 1)
  for (const table of ['queue_entry_contact', 'consent', 'notification_outbox', 'mobile_push_registration', 'mobile_push_outbox']) {
    assert.equal(final.counts?.[table] ?? 0, 0, `${table} must remain empty`)
  }
  assert.deepEqual(final.statuses, [{ status: 'cancelled', n: 1 }])
  assert.ok((await stat(videoPath)).size > 1024, 'Simulator recording should contain visual evidence')
  Object.assign(report, { status: 'passed', phases: summary.passedTests, database: final.counts, statuses: final.statuses, push: 'off' })
  await save()
  console.log(`PASS iOS ${runtime}: native WKWebView transitions and reduced-motion pass; evidence ${path.relative(root, output)}`)
} catch (error) {
  report.status = 'failed'
  report.error = String(error?.message ?? error).split('Call log:')[0]
  await stopVideo().catch(() => {})
  await save()
  throw error
} finally {
  await stopVideo().catch(() => {})
}
