import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read = file => readFile(new URL(file, import.meta.url), 'utf8')
test('iOS smoke is a separate simulator test bundle, never an App source', async () => {
  const project = await read('../ios/App/App.xcodeproj/project.pbxproj')
  const appSources = project.match(/504EC3001FED79650016851F \/\* Sources \*\/ = \{([\s\S]*?)\n\t\t\};/)[1]
  assert.doesNotMatch(appSources, /LocalSmoke|F10000000000000000000001/)
  assert.match(project, /productType = "com.apple.product-type.bundle.unit-test"/)
  assert.match(project, /SUPPORTED_PLATFORMS = iphonesimulator/)
  assert.doesNotMatch(await read('../ios/App/App/Info.plist'), /NSAllowsArbitraryLoads|NSExceptionDomains/)
  assert.doesNotMatch(await read('../ios/App/App/NoQueueVault.swift'), /SecTrust|URLAuthenticationChallenge/)
})
test('iOS runner is local-only and forces process separation and nonempty test selection', async () => {
  const runner = await read('./ios-smoke.mjs')
  assert.match(runner, /https:\/\/127\.0\.0\.1:8788\/__local\/evidence/)
  assert.match(runner, /device\?\.name === 'NoQueue iOS local'/)
  assert.match(runner, /'simctl', 'terminate'/)
  assert.match(runner, /summary\.passedTests, 1/)
  assert.doesNotMatch(runner, /rejectUnauthorized: false|--remote|deploy/)
  const tests = await read('../ios/App/AppLocalTests/LocalSmokeTests.swift')
  assert.match(tests, /SecItemCopyMatching/)
  assert.match(tests, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/)
  assert.match(tests, /XCTAssertNotEqual\(checkpoint\["pid"\]/)
})
test('iOS fault scenarios keep real commits and restore only the app-owned Keychain record', async () => {
  const tests = await read('../ios/App/AppLocalTests/LocalSmokeTests.swift')
  const runner = await read('./ios-smoke.mjs')
  for (const phase of ['test04CommittedResponseLostTwice', 'test05RetryAfterRelaunchWithoutDuplicate',
    'test06CorruptKeychainFailsClosedAndRestores', 'test07RestoredIdentityAfterRelaunch']) {
    assert.ok(tests.includes(`func ${phase}()`))
    assert.ok(runner.includes(`'${phase}'`))
  }
  assert.ok(tests.indexOf('await original.call(this, input, init)', tests.indexOf('private func observeAdmission'))
    < tests.indexOf("if (drop) throw new TypeError"))
  assert.match(tests, /defer \{ XCTAssertEqual\(replaceVault\(original\)/)
  assert.match(tests, /SecItemUpdate\(vaultQuery/)
  assert.doesNotMatch(tests.split("// Saved known links for testing")[0], /SecItemDelete|SecItemAdd|\.write\(to:.*original/)
  assert.match(tests, /web\.reload\(\)/)
  assert.match(tests, /Data\(\[0xff, 0xfe, 0xfd\]\)/)
  assert.match(tests, /XCTAssertEqual\(calls as\? Int, 0\)/)
  assert.match(runner, /status: 'cancelled', n: expectedEntries/)
})
test('iOS upgrade uses distinct builds without wiping state and checks installed/running versions', async () => {
  const runner = await read('./ios-smoke.mjs')
  const tests = await read('../ios/App/AppLocalTests/LocalSmokeTests.swift')
  const pkg = JSON.parse(await read('../package.json'))
  assert.equal(pkg.scripts['test:ios:upgrade'], 'node scripts/ios-smoke.mjs --upgrade')
  assert.match(runner, /installBuild\('1\.0\.0', '1001'\)/)
  assert.match(runner, /installBuild\('1\.0\.1', '1002'\)/)
  assert.match(runner, /'simctl', 'install', simulator, app/)
  assert.doesNotMatch(runner, /'uninstall'|'erase'|'reset'/)
  assert.match(runner, /dataContainerPathChanged = container\(\) !== beforeContainer/)
  assert.match(runner, /checkpointDigest\(container\(\)\), beforeCheckpoint/)
  assert.match(runner, /info.CFBundleVersion, build/)
  assert.match(tests, /Bundle.main.object\(forInfoDictionaryKey: "CFBundleVersion"\)/)
  assert.match(tests, /vaultDigest == checkpoint\["vaultDigestBeforeUpgrade"\]/)
  assert.match(tests, /Set\(paths.map \{ digest\(\$0\) \}\) == expected/)
  for (const phase of ['test08SeedBeforeUpgrade', 'test09UpgradePreservesIdentityTicketsAndPendingRetry', 'test10UpdatedAppAfterRelaunch']) {
    assert.ok(runner.includes(`'${phase}'`))
    assert.ok(tests.includes(`func ${phase}()`))
  }
})
