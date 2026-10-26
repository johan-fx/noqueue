import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
test('native SDK is lazy, gated and contains neither Analytics/Auth nor token logs', () => {
  const source = read('../../../packages/native-fcm/ios/Sources/NoQueueFcmPlugin/NoQueueFcmPlugin.swift')
  const manifest = read('../../../packages/native-fcm/Package.swift')
  assert.match(manifest, /FirebaseMessaging/)
  assert.doesNotMatch(manifest, /FirebaseAnalytics|FirebaseAuth|Crashlytics/)
  assert.doesNotMatch(source, /print\(|NSLog\(|CAPLog\.|isAutoInitEnabled = true|registerForRemoteNotifications\(/)
  assert.match(source, /getBoolean\("enabled", false\)/)
  assert.match(source, /isAutoInitEnabled = false/)
  assert.match(source, /Messaging.messaging\(\).apnsToken = token/)
  const capacitorConfig = read('../capacitor.config.ts')
  assert.match(capacitorConfig, /NoQueueFcm: \{ enabled: releaseProfile\.fcmEnabled(?:, releaseProfile: releaseProfile\.profile)? \}/)
  assert.match(capacitorConfig, /profile: 'default', fcmEnabled: false/)
  const plist = read('../ios/App/App/Info.plist')
  for (const key of ['FirebaseMessagingAutoInitEnabled', 'FirebaseAppDelegateProxyEnabled', 'FIREBASE_ANALYTICS_COLLECTION_ENABLED']) assert.match(plist, new RegExp(`<key>${key}</key>\\s*<false\\s*/>`))
  assert.match(plist, /FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED<\/key>\s*<true\s*\/>/)
  assert.match(read('../../api/.dev.vars.example'), /FCM_IOS_ENABLED=false/)
})
test('native FCM stays OFF by default and is enabled only by an explicit iOS internal-staging profile', () => {
  const configUrl = new URL('../capacitor.config.ts', import.meta.url).href
  const runConfig = env => {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
      `import config from ${JSON.stringify(configUrl)}; console.log(JSON.stringify(config.plugins.NoQueueFcm.enabled))`],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(output.trim())
  }
  const off = { ...process.env }
  for (const key of ['NOQUEUE_MOBILE_RELEASE_PROFILE', 'NOQUEUE_NATIVE_PLATFORM', 'NOQUEUE_LIVE_RELOAD_URL', 'NOQUEUE_LOCAL_DEVELOPMENT', 'VITE_APP_ENV', 'VITE_API_URL', 'VITE_PUBLIC_APP_ORIGIN', 'VITE_MOBILE_PUSH_ENABLED', 'VITE_ANALYTICS_ENABLED', 'VITE_GA4_MEASUREMENT_ID']) delete off[key]
  assert.equal(runConfig(off), false)

  const staging = {
    ...off,
    NOQUEUE_MOBILE_RELEASE_PROFILE: 'internal-staging',
    NOQUEUE_NATIVE_PLATFORM: 'ios',
    VITE_APP_ENV: 'staging',
    VITE_API_URL: 'https://staging.noqueue-app.com',
    VITE_PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com',
    VITE_MOBILE_PUSH_ENABLED: 'true',
    VITE_ANALYTICS_ENABLED: 'false',
    VITE_GA4_MEASUREMENT_ID: '',
  }
  assert.equal(runConfig(staging), true)
})
test('migration retires APNs tokens, not installation/turns/notice access; preserves Android', () => {
  const migration = read('../../api/migrations/0032_mobile_fcm_ios.sql')
  const result = execFileSync('python3', ['-c', `
import sqlite3,sys
c=sqlite3.connect(':memory:')
c.executescript("""
CREATE TABLE mobile_push_registration(installation_hash TEXT PRIMARY KEY,provider TEXT,token_cipher TEXT);
CREATE TABLE mobile_push_outbox(id TEXT,installation_hash TEXT,status TEXT,last_error TEXT);
CREATE TABLE mobile_installation(id TEXT); INSERT INTO mobile_installation VALUES ('ios'),('android');
CREATE TABLE queue_entry(id TEXT,status TEXT); INSERT INTO queue_entry VALUES ('turn','called');
INSERT INTO mobile_push_registration VALUES ('ios','apns','old-apns'),('android','fcm','MiXeD');
INSERT INTO mobile_push_outbox VALUES ('old','ios','pending',NULL),('flight','ios','sending',NULL),('done','ios','accepted',NULL),('android-notice','android','pending',NULL);
""")
c.executescript(sys.stdin.read())
assert c.execute('SELECT * FROM mobile_push_registration').fetchall()==[('android','fcm','MiXeD','android')]
assert c.execute('SELECT id,status FROM mobile_push_outbox ORDER BY id').fetchall()==[('android-notice','pending'),('done','accepted'),('flight','discarded'),('old','discarded')]
assert c.execute('SELECT * FROM queue_entry').fetchall()==[('turn','called')]
assert c.execute('SELECT count(*) FROM mobile_installation').fetchone()[0]==2
print('passed')
`], { input: migration, encoding: 'utf8' })
  assert.equal(result.trim(), 'passed')
})
test('optional client config build phase removes stale config and rejects a different project', { skip: process.platform !== 'darwin' }, () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'noqueue-client-config-'))
  try {
    const src = path.join(temp, 'src'), dst = path.join(temp, 'build')
    mkdirSync(path.join(src, 'App'), { recursive: true }); mkdirSync(path.join(dst, 'App.app'), { recursive: true })
    const target = path.join(dst, 'App.app/GoogleService-Info.plist')
    writeFileSync(target, 'stale')
    const script = new URL('./copy-firebase-config.sh', import.meta.url)
    const run = () => execFileSync('/bin/sh', [script.pathname], { env: { ...process.env, SRCROOT: src, TARGET_BUILD_DIR: dst, UNLOCALIZED_RESOURCES_FOLDER_PATH: 'App.app' }, stdio: 'pipe' })
    run(); assert.equal(existsSync(target), false)
    writeFileSync(path.join(src, 'App/GoogleService-Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>PROJECT_ID</key><string>wrong-project</string></dict></plist>')
    assert.throws(run); assert.equal(existsSync(target), false)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
test('Swift lifecycle covers binding, rotation, resume and late callbacks without the Firebase SDK', { skip: process.platform !== 'darwin' }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noqueue-fcm-session-'))
  try {
    const source = new URL('../../../packages/native-fcm/ios/Sources/NoQueueFcmPlugin/FcmSession.swift', import.meta.url).pathname
    const main = new URL('../../../packages/native-fcm/tests/main.swift', import.meta.url).pathname
    const output = path.join(directory, 'test-fcm')
    execFileSync('swiftc', ['-module-cache-path', path.join(directory, 'modules'), source, main, '-o', output], { stdio: 'pipe' })
    assert.match(execFileSync(output, { encoding: 'utf8' }), /23 assertions passed/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
