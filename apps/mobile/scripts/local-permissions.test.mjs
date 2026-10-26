import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')

test('iOS camera/location explanations are localized, registered, and local network is absent from source Info.plist', () => {
  const plist = read('../ios/App/App/Info.plist')
  const project = read('../ios/App/App.xcodeproj/project.pbxproj')
  const expectedKeys = ['NSCameraUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription']
  assert.doesNotMatch(plist, /NSLocalNetworkUsageDescription/)
  assert.match(project, /developmentRegion = en;/)
  assert.match(project, /knownRegions = \([\s\S]*?\ben,[\s\S]*?\bes,[\s\S]*?Base,/)
  assert.match(project, /E10000000000000000000002 \/\* InfoPlist\.strings \*\//)
  for (const locale of ['en', 'es']) {
    const strings = read(`../ios/App/App/${locale}.lproj/InfoPlist.strings`)
    for (const key of expectedKeys) assert.match(strings, new RegExp(`"${key}"\\s*=`))
    assert.match(strings, /camera|c[aá]mara/i)
    assert.match(strings, /location|ubicaci[oó]n/i)
  }
})

test('Android keeps only capabilities actually used and declares branded FCM defaults', () => {
  const manifest = read('../android/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android\.permission\.CAMERA/)
  assert.match(manifest, /android\.permission\.ACCESS_COARSE_LOCATION/)
  assert.match(manifest, /android\.permission\.ACCESS_FINE_LOCATION" android:maxSdkVersion="30"/)
  assert.match(manifest, /android\.permission\.RECEIVE_BOOT_COMPLETED" tools:node="remove"/)
  assert.match(manifest, /com\.capacitorjs\.plugins\.localnotifications\.LocalNotificationRestoreReceiver" tools:node="remove"/)
  assert.match(manifest, /com\.google\.firebase\.messaging\.default_notification_icon" android:resource="@drawable\/ic_stat_noqueue"/)
  assert.match(manifest, /com\.google\.firebase\.messaging\.default_notification_color" android:resource="@color\/brand_notification_color"/)
  assert.match(manifest, /android:required="false"/)
  assert.doesNotMatch(manifest, /ACCESS_BACKGROUND_LOCATION|RECORD_AUDIO|READ_MEDIA|READ_EXTERNAL_STORAGE/)
})

test('iOS build phase adds local-network disclosure only to Debug product plist', { skip: process.platform !== 'darwin' }, () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'noqueue-privacy-build-'))
  try {
    const src = path.join(temp, 'src'), product = path.join(temp, 'build/App.app')
    mkdirSync(path.join(src, 'App'), { recursive: true })
    mkdirSync(product, { recursive: true })
    const info = path.join(product, 'Info.plist')
    const source = `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleDisplayName</key><string>No Queue</string><key>NSLocalNetworkUsageDescription</key><string>stale development value</string></dict></plist>`
    writeFileSync(info, source)
    const script = new URL('./copy-firebase-config.sh', import.meta.url)
    const run = configuration => execFileSync('/bin/sh', [script.pathname], {
      env: { ...process.env, SRCROOT: src, TARGET_BUILD_DIR: path.join(temp, 'build'), INFOPLIST_PATH: 'App.app/Info.plist', UNLOCALIZED_RESOURCES_FOLDER_PATH: 'App.app', CONFIGURATION: configuration },
      stdio: 'pipe',
    })
    const readBuiltPlist = () => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', info], { encoding: 'utf8' }))

    run('Debug')
    assert.match(readBuiltPlist().NSLocalNetworkUsageDescription, /development server during local development and testing/)
    run('Release')
    assert.equal(readBuiltPlist().NSLocalNetworkUsageDescription, undefined)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
