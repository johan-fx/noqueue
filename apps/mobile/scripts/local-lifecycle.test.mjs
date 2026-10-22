import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read = p => readFile(new URL(p, import.meta.url), 'utf8')
test('lifecycle control is opt-in loopback, authenticated, real coordinator and real time', async () => {
  const source = await read('../../api/scripts/dev-mobile.mjs')
  for (const text of ["process.env.NOQUEUE_LOCAL_LIFECYCLE === '1'", 'request.headers.authorization !== `Bearer ${controlToken}`',
    'mode: 0o600', 'stub.staffCommand(', 'stub.refresh(queue)', "!lifecycle || network.host === '127.0.0.1'", 'lifecycle ? 2 : 5']) assert.ok(source.includes(text))
  assert.doesNotMatch(source, /UPDATE queue_entry|SET status|SET arrival_deadline/)
})
test('lifecycle links are test-only Keychain or runner RAM, not reports or product storage', async () => {
  const swift = await read('../ios/App/AppLocalTests/LocalSmokeTests.swift')
  assert.match(swift, /com.noqueue.local-tests.lifecycle/)
  assert.match(swift, /SecItemDelete\(lifecycleQuery/)
  const android = await read('../../../tests/e2e/mobile/android-services.mjs')
  assert.match(android, /RAM only; never include knownLinks in the report/)
  const scenario = await read('../ios/App/AppLocalTests/lifecycle-scenarios.js')
  assert.doesNotMatch(scenario, /localStorage|sessionStorage|NoQueueVault.write|console.log/)
  for (const text of ['terminal command rejected409', 'foreign link denied404', 'no identity denied401',
    'only waiting/called in active list', 'same four capabilities after restart', 'one version per transition']) assert.ok(scenario.includes(text))
  const project = await read('../ios/App/App.xcodeproj/project.pbxproj')
  const appResources = project.match(/504EC3021FED79650016851F \/\* Resources \*\/ = \{([\s\S]*?)\n\t\t\};/)[1]
  assert.doesNotMatch(appResources, /F30000000000000000000001/)
})
