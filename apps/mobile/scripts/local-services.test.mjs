import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read = p => readFile(new URL(p, import.meta.url), 'utf8')
test('service fixtures preserve reception and activate restaurant explicitly in local test DB', async () => {
  const source = await read('../../api/scripts/dev-mobile.mjs')
  assert.match(source, /services = \{ reception: service, restaurant: crypto.randomUUID\(\), pool: crypto.randomUUID\(\) \}/)
  assert.match(source, /INSERT INTO queue_admission/)
  assert.match(source, /server.listen\(network.port, network.host/)
  assert.match(source, /byService: byService.results/)
})
test('shared scenario is bundled only in iOS tests and reused by actual Android WebView', async () => {
  const project = await read('../ios/App/App.xcodeproj/project.pbxproj')
  const appResources = project.match(/504EC3021FED79650016851F \/\* Resources \*\/ = \{([\s\S]*?)\n\t\t\};/)[1]
  assert.doesNotMatch(appResources, /F20000000000000000000001|service-scenarios/)
  assert.match(project, /F20000000000000000000003 = \{isa = PBXResourcesBuildPhase/)
  const swift = await read('../ios/App/AppLocalTests/LocalSmokeTests.swift')
  assert.match(swift, /Bundle\(for: LocalSmokeTests.self\).url\(forResource: "service-scenarios"/)
  const android = await read('../../../tests/e2e/mobile/android-services.mjs')
  assert.match(android, /service-scenarios.js/)
  assert.match(android, /chromium.connectOverCDP/)
  assert.match(android, /'noqueue-api36'/)
  assert.match(android, /assert.notEqual\(pid, lastPID/)
})
test('service scenario covers operational differences and real versioned actions without bypasses', async () => {
  const source = await read('../ios/App/AppLocalTests/service-scenarios.js')
  for (const text of ['pool group admission rejected', 'party update persisted', 'room update persisted',
    'pool edit rejected by API', 'both versions advanced on yield', 'replay does not yield twice',
    'stale command rejected', 'other installation cancel denied', 'failed yield does not mutate', 'cancel persisted']) assert.ok(source.includes(text))
  assert.doesNotMatch(source, /NoQueueVault.write|localStorage|sessionStorage|console.log|https:\/\/(?!127.0.0.1)/)
})
