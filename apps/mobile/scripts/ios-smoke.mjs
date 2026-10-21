import { lifecycleControl } from './lifecycle-control.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { readFile, mkdir, mkdtemp, writeFile, open } from 'node:fs/promises'
import { request } from 'node:https'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const discoveryMode = process.argv.includes('--discovery')
const lifecycleMode = process.argv.includes('--lifecycle')
const servicesMode = process.argv.includes('--services')
const upgrade = process.argv.includes('--upgrade')
assert.ok(process.argv.slice(2).every(arg => ['--upgrade', '--services', '--lifecycle', '--discovery'].includes(arg)), 'Unknown smoke argument')
assert.ok([upgrade, servicesMode, lifecycleMode, discoveryMode].filter(Boolean).length <= 1, 'Choose one smoke mode')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'reports/ios-local')
await mkdir(output, { recursive: true })
const run = await mkdtemp(path.join(output, 'run-'))
const simulator = (process.env.IOS_SIMULATOR_ID ?? await readFile(path.join(output, 'simulator-id'), 'utf8')).trim()
assert.match(simulator, /^[A-F0-9-]{36}$/i)
const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { encoding: 'utf8' }))
const device = Object.values(devices.devices).flat().find(d => d.udid === simulator)
assert.ok(device?.name === 'NoQueue iOS local' && device.state === 'Booted', 'Select the booted, dedicated NoQueue iOS local simulator')
const ca = await readFile(path.join(root, 'reports/android-local/tls/res/raw/noqueue_local_ca.pem'))
function evidence() {
  return new Promise((resolve, reject) => {
    const req = request('https://127.0.0.1:8788/__local/evidence', { ca }, response => {
      let body = ''
      response.setEncoding('utf8').on('data', part => { body += part })
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200)
          resolve(JSON.parse(body))
        } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Local API timed out')))
    req.end()
  })
}
const derived = process.env.NOQUEUE_IOS_DERIVED_DATA ?? '/tmp/noqueue-mobile-ios'
const common = ['-project', path.join(root, 'apps/mobile/ios/App/App.xcodeproj'), '-scheme', 'LocalSmoke',
  '-configuration', 'Debug', '-destination', `platform=iOS Simulator,id=${simulator}`, '-destination-timeout', '30',
  '-derivedDataPath', derived, '-clonedSourcePackagesDirPath', '/tmp/noqueue-mobile-spm', '-parallel-testing-enabled', 'NO']
async function xcode(args, label) {
  const log = await open(path.join(run, `${label}.log`), 'w')
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn('xcodebuild', [...common, ...args], { cwd: root, stdio: ['ignore', log.fd, log.fd] })
      child.once('error', reject)
      child.once('exit', resolve)
    })
    assert.equal(code, 0, `Xcode phase ${label} failed; inspect its local log (not safe to publish raw logs)`)
  } finally { await log.close() }
}
const report = { status: 'running', at: new Date().toISOString(), simulator, run, mode: discoveryMode ? 'discovery' : lifecycleMode ? 'lifecycle' : servicesMode ? 'services' : upgrade ? 'upgrade' : 'smoke', phases: [] }
const save = () => writeFile(path.join(output, discoveryMode ? 'discovery-result.json' : lifecycleMode ? 'lifecycle-result.json' : servicesMode ? 'services-result.json' : upgrade ? 'upgrade-result.json' : 'smoke-result.json'), JSON.stringify(report, null, 2))
await save()
try {
  assert.equal((await evidence()).counts.queue_entry, 0, 'Restart the ephemeral dev:mobile API before each run')
  const installBuild = async (version, build) => {
    // CLI-only overrides: never change release version settings in the project.
    await xcode(['CODE_SIGN_IDENTITY=-', `MARKETING_VERSION=${version}`,
      `CURRENT_PROJECT_VERSION=${build}`, 'build-for-testing'], `build-${build}`)
    const app = path.join(derived, 'Build/Products/Debug-iphonesimulator/App.app')
    execFileSync('xcrun', ['simctl', 'install', simulator, app])
    const installed = execFileSync('xcrun', ['simctl', 'get_app_container', simulator, 'com.noqueue-app.ios', 'app'], { encoding: 'utf8' }).trim()
    const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(installed, 'Info.plist')], { encoding: 'utf8' }))
    assert.equal(info.CFBundleIdentifier, 'com.noqueue-app.ios')
    assert.equal(info.CFBundleShortVersionString, version)
    assert.equal(info.CFBundleVersion, build)
    return { version, build }
  }
  const container = () => execFileSync('xcrun', ['simctl', 'get_app_container', simulator, 'com.noqueue-app.ios', 'data'], { encoding: 'utf8' }).trim()
  const checkpointDigest = async directory => createHash('sha256').update(await readFile(path.join(directory, 'Documents/noqueue-local-smoke-checkpoint.json'))).digest('hex')
  if (upgrade) report.before = await installBuild('1.0.0', '1001')
  else await xcode(['CODE_SIGN_IDENTITY=-', 'build-for-testing'], 'build')
  if (discoveryMode) {
    execFileSync('xcrun', ['simctl', 'privacy', simulator, 'grant', 'location', 'com.noqueue-app.ios'])
    execFileSync('xcrun', ['simctl', 'location', simulator, 'set', '40.4168,-3.7038'])
  }
  const phases = discoveryMode ? ['test19NativeDiscoveryAndAdmission', 'test20NativeLocation'] : lifecycleMode
    ? ['test15LifecycleSeed', 'test16CalledAfterRelaunch', 'test17TerminalAfterRelaunch', 'test18TerminalRecoveredAgain']
    : servicesMode
    ? ['test11RestaurantPoolAdmission', 'test12RestaurantManagementAfterRelaunch', 'test13PoolManagementAfterRelaunch', 'test14ServicesCancelledAfterRelaunch']
    : upgrade
    ? ['test08SeedBeforeUpgrade', 'test09UpgradePreservesIdentityTicketsAndPendingRetry', 'test10UpdatedAppAfterRelaunch']
    : ['test01AnonymousAdmissionAndKeychain', 'test02RecoveryAndCancellationAfterRelaunch', 'test03CancelledTicketStaysAbsentAfterRelaunch',
      'test04CommittedResponseLostTwice', 'test05RetryAfterRelaunchWithoutDuplicate',
      'test06CorruptKeychainFailsClosedAndRestores', 'test07RestoredIdentityAfterRelaunch']
  for (const phase of phases) {
    // App is a test host, not a browser runtime mock. A separate process per phase.
    try { execFileSync('xcrun', ['simctl', 'terminate', simulator, 'com.noqueue-app.ios'], { stdio: 'ignore' }) } catch { /* May already be stopped. */ }
    if (upgrade && phase === 'test09UpgradePreservesIdentityTicketsAndPendingRetry') {
      const beforeContainer = container()
      const beforeCheckpoint = await checkpointDigest(beforeContainer)
      const beforeDatabase = await evidence()
      assert.equal(beforeDatabase.counts.queue_entry, 2)
      assert.equal(beforeDatabase.statuses.reduce((n, row) => n + (row.status === 'cancelled' ? 0 : row.n), 0), 2)
      // No uninstall, erase, reset, seed, or API restart between these builds.
      report.after = await installBuild('1.0.1', '1002')
      const dataContainerPathChanged = container() !== beforeContainer // OS may relocate it on update.
      assert.equal(await checkpointDigest(container()), beforeCheckpoint, 'Checkpoint must survive update byte-for-byte')
      assert.deepEqual(await evidence(), beforeDatabase, 'Installing must not change the server state')
      report.update = { dataContainerPathChanged, checkpointPreserved: true, databaseUnchanged: true }
      await save()
    }
    if (phase === 'test16CalledAfterRelaunch') await lifecycleControl('call')
    if (phase === 'test17TerminalAfterRelaunch') {
      await lifecycleControl('complete')
      await lifecycleControl('expire')
    }
    const resultPath = path.join(run, `${phase}.xcresult`)
    await xcode(['-only-testing:AppLocalTests/LocalSmokeTests/' + phase,
      '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '90',
      '-maximum-test-execution-time-allowance', '120', '-resultBundlePath', resultPath, 'test-without-building'], phase)
    const summary = JSON.parse(execFileSync('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', resultPath], { encoding: 'utf8' }))
    assert.equal(summary.passedTests, 1, 'Expected exactly one executed test, not an empty successful selection')
    assert.equal(summary.failedTests, 0)
    report.phases.push({ name: phase, passed: 1 })
    await save()
    console.log(`PASS ${phase}`)
  }
  const final = await evidence()
  const expectedEntries = discoveryMode ? 1 : (servicesMode || lifecycleMode) ? 4 : 2
  assert.equal(final.counts.queue_entry, expectedEntries)
  assert.equal(final.counts.mobile_entry_installation, expectedEntries)
  for (const table of ['queue_entry_contact', 'consent', 'notification_outbox']) assert.equal(final.counts[table], 0)
  if (discoveryMode) for (const table of ['mobile_push_registration', 'mobile_push_outbox']) assert.equal(final.counts[table], 0)
  assert.deepEqual(final.statuses, lifecycleMode ? [{ status: 'completed', n: 2 }, { status: 'expired', n: 2 }] : [{ status: 'cancelled', n: expectedEntries }])
  if (servicesMode) assert.deepEqual(final.byService, [{ type: 'pool', status: 'cancelled', n: 2 }, { type: 'restaurant', status: 'cancelled', n: 2 }])
  if (lifecycleMode) assert.deepEqual(final.byService, ['pool', 'restaurant'].flatMap(type =>
    [{ type, status: 'completed', n: 1 }, { type, status: 'expired', n: 1 }]))
  Object.assign(report, { status: 'passed', database: final.counts, statuses: final.statuses, byService: final.byService })
  await save()
  console.log(`PASS local D1: ${expectedEntries} terminal mobile tickets; no phone, consent or WhatsApp outbox`)
} catch (error) {
  report.status = 'failed'
  await save()
  console.error(error.message)
  process.exitCode = 1
}
