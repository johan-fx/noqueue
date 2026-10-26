import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { hashDirectory, parseOptions as parsePrepareOptions, prepareCommands, releaseEnvironment, releaseManifest } from './mobile-release-prepare.mjs'
import {
  parseOptions as parseVerifyOptions,
  validateWebContent,
  plistJsonFromText,
  validateAndroidManifest,
  validateAndroidFirebaseResources,
  validateIosPrivacy,
  validateReleaseManifest,
} from './mobile-release-verify.mjs'

test('release prepare accepts only an explicit internal-staging profile and valid build number', () => {
  assert.deepEqual(parsePrepareOptions(['--profile', 'internal-staging', '--build-number', '1003']), {
    profile: 'internal-staging', buildNumber: 1003, platform: 'both', dryRun: false, help: false,
  })
  assert.throws(() => parsePrepareOptions(['--build-number', '1003']), /Only --profile internal-staging/)
  for (const number of ['0', '-1', '1.5', '2100000001', '999999999999999999999'])
    assert.throws(() => parsePrepareOptions(['--profile', 'internal-staging', '--build-number', number]))
})

test('platform-scoped preparation syncs only the selected platform and rejects typos', () => {
  const args = ['--profile', 'internal-staging', '--build-number', '1008']
  assert.equal(parsePrepareOptions([...args, '--platform', 'android']).platform, 'android')
  assert.throws(() => parsePrepareOptions([...args, '--platform', 'andriod']), /--platform/)
  assert.deepEqual(prepareCommands('android')[1].args, ['--filter', '@noqueue/mobile', 'exec', 'cap', 'sync', 'android'])
  assert.deepEqual(prepareCommands('ios')[1].args, ['--filter', '@noqueue/mobile', 'exec', 'cap', 'sync', 'ios'])
  assert.deepEqual(prepareCommands()[1].args, ['--filter', '@noqueue/mobile', 'sync'])
  assert.throws(() => prepareCommands('andriod'), /Invalid native platform/)
})

test('release environment is fail-closed to staging, push-on, analytics-off and strips signing secrets', () => {
  const env = releaseEnvironment({
    VITE_API_URL: 'https://production.invalid', VITE_PUBLIC_APP_ORIGIN: 'https://production.invalid',
    VITE_MOBILE_PUSH_ENABLED: 'false', VITE_ANALYTICS_ENABLED: 'true', VITE_GA4_MEASUREMENT_ID: 'secret-like',
    NOQUEUE_LIVE_RELOAD_URL: 'https://192.168.1.2:5173', NOQUEUE_LOCAL_DEVELOPMENT: '1',
    NOQUEUE_ANDROID_UPLOAD_STORE_PASSWORD: 'must-not-propagate', PATH: '/bin',
  })
  assert.equal(env.NOQUEUE_MOBILE_RELEASE_PROFILE, 'internal-staging')
  assert.equal(env.VITE_APP_ENV, 'staging')
  assert.equal(env.VITE_API_URL, 'https://staging.noqueue-app.com')
  assert.equal(env.VITE_PUBLIC_APP_ORIGIN, 'https://staging.noqueue-app.com')
  assert.equal(env.VITE_MOBILE_PUSH_ENABLED, 'true')
  assert.equal(env.VITE_ANALYTICS_ENABLED, 'false')
  assert.equal(env.VITE_GA4_MEASUREMENT_ID, '')
  assert.equal('NOQUEUE_LIVE_RELOAD_URL' in env, false)
  assert.equal('NOQUEUE_LOCAL_DEVELOPMENT' in env, false)
  assert.equal('NOQUEUE_ANDROID_UPLOAD_STORE_PASSWORD' in env, false)
  assert.equal(env.PATH, '/bin')
})

test('web payload hash is deterministic and excludes only its release marker', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'noqueue-release-hash-'))
  try {
    mkdirSync(path.join(root, 'assets'))
    writeFileSync(path.join(root, 'index.html'), '<html/>')
    writeFileSync(path.join(root, 'assets/main.js'), 'compiled')
    writeFileSync(path.join(root, 'noqueue-mobile-release.json'), '{"assetsSha256":"ignored"}')
    const first = hashDirectory(root)
    writeFileSync(path.join(root, 'noqueue-mobile-release.json'), '{"assetsSha256":"updated"}')
    assert.equal(hashDirectory(root), first)
    writeFileSync(path.join(root, 'assets/main.js'), 'changed')
    assert.notEqual(hashDirectory(root), first)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('web payload hash refuses symlinks', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'noqueue-release-symlink-'))
  try {
    writeFileSync(path.join(root, 'actual.js'), 'payload')
    symlinkSync('actual.js', path.join(root, 'link.js'))
    assert.throws(() => hashDirectory(root), /Refusing symlink/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('native sync hashes exclude only empty Capacitor Cordova stubs', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'noqueue-release-native-hash-'))
  try {
    writeFileSync(path.join(root, 'index.html'), '<html/>')
    const expected = hashDirectory(root)
    writeFileSync(path.join(root, 'cordova.js'), '')
    writeFileSync(path.join(root, 'cordova_plugins.js'), '')
    assert.equal(hashDirectory(root, { nativeGenerated: true }), expected)
    writeFileSync(path.join(root, 'cordova.js'), 'unexpected native code')
    assert.throws(() => hashDirectory(root, { nativeGenerated: true }), /nonempty Capacitor Cordova bridge stub/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('internal-staging release marker has fixed profile, endpoint, build number and flags', () => {
  const marker = releaseManifest(1003, 'a'.repeat(64))
  assert.deepEqual(validateReleaseManifest(marker, 1003), [])
  assert.match(validateReleaseManifest({ ...marker, apiOrigin: 'https://prod.example' }, 1003).join(' '), /origins/)
  assert.match(validateReleaseManifest({ ...marker, pushEnabled: false }, 1003).join(' '), /build flags/)
  assert.match(validateReleaseManifest(marker, 1004).join(' '), /build number/)
})

test('Capacitor native FCM profile is off by default and enabled only for internal-staging iOS', async () => {
  const source = readFileSync(new URL('../capacitor.config.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  const { mobileReleaseProfile } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const env = {
    NOQUEUE_MOBILE_RELEASE_PROFILE: 'internal-staging',
    VITE_APP_ENV: 'staging', VITE_API_URL: 'https://staging.noqueue-app.com',
    VITE_PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com', VITE_MOBILE_PUSH_ENABLED: 'true',
    VITE_ANALYTICS_ENABLED: 'false', VITE_GA4_MEASUREMENT_ID: '',
  }
  assert.deepEqual(mobileReleaseProfile({}, 'ios'), { profile: 'default', fcmEnabled: false })
  assert.deepEqual(mobileReleaseProfile(env, 'ios'), { profile: 'internal-staging', fcmEnabled: true })
  assert.deepEqual(mobileReleaseProfile(env, 'android'), { profile: 'internal-staging', fcmEnabled: false })
  assert.throws(() => mobileReleaseProfile({ ...env, VITE_API_URL: 'https://production.invalid' }, 'ios'), /VITE_API_URL/)
  assert.throws(() => mobileReleaseProfile({ ...env, NOQUEUE_LIVE_RELOAD_URL: 'https://192.168.1.2:5173' }, 'ios'), /forbids live reload/)
  assert.throws(() => mobileReleaseProfile({ ...env, NOQUEUE_MOBILE_RELEASE_PROFILE: 'prod' }, 'ios'), /Unsupported mobile release profile/)
})

test('Android Release signing cannot fall back to a key inside the repository', () => {
  const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8')
  assert.match(gradle, /resolve\('\.\.\/\.\.\/\.\.'\)/)
  assert.match(gradle, /keystorePath\.startsWith\(repositoryRoot\)/)
  const repositoryRoot = path.resolve('/repo/apps/mobile/android/../../..')
  for (const candidate of ['/repo/apps/upload-key.jks', '/repo/foo/upload-key.jks']) {
    const relative = path.relative(repositoryRoot, path.resolve(candidate))
    const insideRepository = relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    assert.equal(insideRepository, true, `${candidate} must be rejected as repository-local`)
  }
  assert.match(gradle, /noqueueAllowUnsignedRelease=true/)
  assert.match(gradle, /Release builds require external Android upload signing env/)
})

test('Android bundle manifest verification requires target SDK, runtime permissions, FCM and no excess access', () => {
  const manifest = `<manifest package="com.noqueueapp.android" android:versionCode="1003"><uses-sdk android:targetSdkVersion="36" />
    <uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.CAMERA"/>
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/><uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30"/>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
    <application><meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false"/>
    <meta-data android:name="firebase_analytics_collection_enabled" android:value="false"/>
    <meta-data android:name="firebase_analytics_collection_deactivated" android:value="true"/>
    <service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService"/>
    <service android:name="com.google.firebase.messaging.FirebaseMessagingService"/></application></manifest>`
  assert.deepEqual(validateAndroidManifest(manifest, 1003), [])
  assert.match(validateAndroidManifest(manifest.replace('com.noqueueapp.android', 'com.noqueue.app'), 1003).join(' '), /package id/)
  assert.match(validateAndroidManifest(manifest.replace('targetSdkVersion="36"', 'targetSdkVersion="35"'), 1003).join(' '), /targetSdkVersion/)
  assert.match(validateAndroidManifest(manifest.replace('android:maxSdkVersion="30"', ''), 1003).join(' '), /fine location/)
  assert.match(validateAndroidManifest(manifest.replace('</manifest>', '<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/></manifest>'), 1003).join(' '), /ACCESS_BACKGROUND_LOCATION/)
})

test('Android Firebase audit rejects the old app ID even in the same project', () => {
  const values = { project_id: 'nq-app-f3127', gcm_defaultSenderId: '54689871019', google_app_id: '1:54689871019:android:862772299ec67a4cbf73ee' }
  assert.deepEqual(validateAndroidFirebaseResources(values), [])
  assert.match(validateAndroidFirebaseResources({ ...values, google_app_id: '1:54689871019:android:fd8fe3f8c5fdb49cbf73ee' }).join(' '), /google_app_id/)
  assert.match(validateAndroidFirebaseResources({ ...values, project_id: 'wrong' }).join(' '), /project_id/)
  assert.match(validateAndroidFirebaseResources({ ...values, gcm_defaultSenderId: 'wrong' }).join(' '), /gcm_defaultSenderId/)
  assert.equal(validateAndroidFirebaseResources({}).length, 3)
  const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8')
  assert.match(gradle, /Release Firebase project\/sender\/app registration does not match com\.noqueueapp\.android/)
  assert.match(gradle, /1:54689871019:android:862772299ec67a4cbf73ee/)
})

test('iOS artifact verification requires user-facing camera/location descriptions and production APNs', () => {
  const info = { CFBundleIdentifier: 'com.noqueue-app.ios', CFBundleVersion: '1003', NSCameraUsageDescription: 'Scan a QR code', NSLocationWhenInUseUsageDescription: 'Nearby venues' }
  const entitlements = { 'aps-environment': 'production', 'get-task-allow': false, 'application-identifier': '6VYYNUZPSH.com.noqueue-app.ios' }
  assert.deepEqual(validateIosPrivacy(info, entitlements, 1003), [])
  assert.match(validateIosPrivacy({ ...info, NSCameraUsageDescription: '' }, { ...entitlements, 'aps-environment': 'development' }, 1003).join(' '), /NSCameraUsageDescription/)
  assert.match(validateIosPrivacy(info, { ...entitlements, 'aps-environment': 'development' }, 1003).join(' '), /aps-environment=production/)
  assert.match(validateIosPrivacy({ ...info, NSMicrophoneUsageDescription: 'Mic' }, entitlements, 1003).join(' '), /unused media permission/)
})

test('compiled-web audit allows only the two React Router parser fallbacks, not loopback endpoints', () => {
  const marker = {
    apiOrigin: 'https://staging.noqueue-app.com',
    publicAppOrigin: 'https://staging.noqueue-app.com',
    ga4MeasurementId: '',
  }
  const inspect = source => validateWebContent([{ name: 'vendor.js', bytes: Buffer.from(source) }], marker)
  const documentUrlParser = 'function O(e,t,n=!1){let r=`http://localhost`;e&&(r=e.location.origin===`null`?e.location.href:e.location.origin)}'
  const relativeHrefParser = 'var Ye=new URL(`http://localhost`);function Xe(e){if(e.createURL)return e.createURL(`/`);try{return new URL(e.createHref(`/`),Ye)}catch(t){return e.createHref(`/`)}}'

  assert.deepEqual(inspect(`${marker.apiOrigin};${documentUrlParser};${relativeHrefParser}`), [])
  assert.match(inspect(`${marker.apiOrigin};fetch('http://localhost/api')`).join(' '), /loopback\/live-development URL/)
  assert.match(inspect(`${marker.apiOrigin};new URL('http://localhost/api')`).join(' '), /loopback\/live-development URL/)
  assert.match(inspect(`${marker.apiOrigin};fetch('http://localhost')`).join(' '), /loopback\/live-development URL/)
  assert.match(inspect(`${marker.apiOrigin};var Ye=new URL(\`http://localhost\`);fetch(Ye)`).join(' '), /loopback\/live-development URL/)
})

test('verifier requires real artifacts; unsigned option is explicit and certificate fingerprint format is checked', () => {
  assert.throws(() => parseVerifyOptions(['--profile', 'internal-staging', '--build-number', '1003']), /at least one real artifact/)
  assert.equal(parseVerifyOptions(['--profile', 'internal-staging', '--build-number', '1003', '--android-aab', 'app.aab', '--allow-unsigned']).allowUnsigned, true)
  assert.throws(() => parseVerifyOptions(['--profile', 'internal-staging', '--build-number', '1003', '--ios-ipa', 'app.ipa', '--expected-android-upload-cert-sha256', 'invalid']), /fingerprint/)
})

// Xcode 27 requires codesign --xml; provisioning dates cannot pass plutil JSON.
test('parses XML entitlements and profile dates without swallowing diagnostic suffixes', () => {
  const xml = '<?xml version="1.0"?><plist version="1.0"><dict><key>aps-environment</key><string>production</string><key>ExpirationDate</key><date>2027-10-25T08:36:54Z</date><key>get-task-allow</key><false/></dict></plist>';
  const result = plistJsonFromText('Executable=/tmp/App\n' + xml + '\nwarning: diagnostic', 'test');
  assert.equal(result['aps-environment'], 'production');
  assert.equal(result['get-task-allow'], false);
  assert.equal(result.ExpirationDate, '2027-10-25T08:36:54+00:00');
  assert.throws(() => plistJsonFromText('<plist><dict>', 'test'), /Incomplete/);
});
