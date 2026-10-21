import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read = p => readFile(new URL(p, import.meta.url), 'utf8')
test('discovery scenario is test-only and native runners require local API and dedicated simulators', async () => {
  const project = await read('../ios/App/App.xcodeproj/project.pbxproj')
  const appResources = project.match(/504EC3021FED79650016851F \/\* Resources \*\/ = \{([\s\S]*?)\n\t\t\};/)[1]
  assert.doesNotMatch(appResources, /F40000000000000000000001|discovery-scenarios/)
  assert.match(project, /F20000000000000000000003 = .*F40000000000000000000001/)
  assert.match(await read('./ios-smoke.mjs'), /test19NativeDiscoveryAndAdmission/)
  const android = await read('../../../tests/e2e/mobile/android-discovery.mjs')
  assert.match(android, /chromium.connectOverCDP/)
  assert.match(android, /'noqueue-api36'/)
  assert.match(android, /https:\/\/127\.0\.0\.1:8788/)
  assert.doesNotMatch(android, /ignoreHTTPSErrors|rejectUnauthorized: false/)
})
test('native discovery uses UI and real API without writing vault or sending notifications', async () => {
  const source = await read('../ios/App/AppLocalTests/discovery-scenarios.js')
  for (const label of ['three searched services', 'text and filters preserved', 'anonymous mobile form', 'one committed admission', 'push stays off', 'identity preserved across discovery and turn']) assert.ok(source.includes(label))
  assert.doesNotMatch(source, /NoQueueVault.write|localStorage|sessionStorage|console.log/)
})
