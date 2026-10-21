import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read = relative => readFile(new URL(relative, import.meta.url), 'utf8')
test('local TLS is opt-in, Debug scoped, and forbidden with Release tasks', async () => {
  const gradle = await read('../android/app/build.gradle')
  assert.match(gradle, /providers\.gradleProperty\('noqueueLocalTlsDir'\)/)
  assert.match(gradle, /sourceSets\.debug/)
  assert.match(gradle, /contains\('release'\)/)
  assert.match(gradle, /throw new GradleException\('Local TLS is forbidden/)
  assert.doesNotMatch(await read('../android/app/src/main/AndroidManifest.xml'), /networkSecurityConfig|usesCleartextTraffic/)
  const trust = await read('../android/app/src/localDebug/res/xml/noqueue_local_network.xml')
  assert.match(trust, /includeSubdomains="false">127\.0\.0\.1/)
  assert.doesNotMatch(trust, /cleartextTrafficPermitted="true"|src="user"/)
})
test('bridge logs are disabled so native vault arguments are not logged', async () => {
  assert.match(await read('../capacitor.config.ts'), /loggingBehavior: 'none'/)
})
test('emulator API uses test config, local-only binding, and fails closed on external traffic', async () => {
  const harness = await read('../../api/scripts/dev-mobile.mjs')
  assert.match(harness, /test\/wrangler\.json/)
  assert.match(harness, /db\.remote = false/)
  assert.match(harness, /CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'/)
  assert.match(harness, /WHATSAPP_ENABLED: 'false'/)
  assert.match(harness, /server\.listen\(8788, network.host/)
  assert.match(await read('../../api/test/mobile-local-worker.ts'), /http\.all\('\*', \(\) => HttpResponse\.error\(\)\)/)
})
