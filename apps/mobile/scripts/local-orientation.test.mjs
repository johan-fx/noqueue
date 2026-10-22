import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')

test('iOS supports upright portrait only on phone and iPad', () => {
  const plist = read('../ios/App/App/Info.plist')
  for (const key of ['UISupportedInterfaceOrientations', 'UISupportedInterfaceOrientations~ipad']) {
    const array = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1]
    assert.ok(array, `${key} must be explicitly configured`)
    assert.deepEqual([...array.matchAll(/<string>(.*?)<\/string>/g)].map(match => match[1]), ['UIInterfaceOrientationPortrait'])
  }
  assert.match(plist, /<key>UIRequiresFullScreen<\/key>\s*<true\s*\/>/)
})

test('Android MainActivity requests portrait with API 36 compatibility', () => {
  const manifest = read('../android/app/src/main/AndroidManifest.xml')
  const activity = manifest.match(/<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/)?.[0]
  assert.ok(activity)
  assert.match(activity.split('>')[0], /android:screenOrientation="portrait"/)
  assert.match(activity, /<property\s+android:name="android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY"\s+android:value="true"\s*\/>/)
})

test('portrait smoke uses the dedicated emulator, a rotation control, and restores settings', () => {
  const runner = read('../../../tests/e2e/mobile/android-portrait.mjs')
  assert.match(runner, /'noqueue-api36'/)
  assert.match(runner, /'android.settings.SETTINGS'/)
  assert.match(runner, /rotation\(\)\.actual\)\.toBe\(1\)/)
  assert.match(runner, /'SCREEN_ORIENTATION_PORTRAIT'/)
  assert.match(runner, /'wm', 'user-rotation', \.\.\.previousRotation/)
  assert.match(runner, /No goto after launch/)
  assert.match(runner, /report\.externalRequests, 0/)
  assert.match(runner, /report\.pushRequests, 0/)
  assert.doesNotMatch(runner, /'uninstall'|'clear'|ignoreHTTPSErrors|rejectUnauthorized:\s*false|Tus turnos|Abrir turno 1/)
})
