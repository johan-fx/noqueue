import test from 'node:test'
import assert from 'node:assert/strict'
import { auditSettings, auditSignedMetadata, auditDevelopmentDevice, auditFcmConfiguration, auditFirebaseClient, parseProfile, bundle, team } from './check-ios-push.mjs'

test('requires the physical device in a debuggable development profile without disclosing its identifier', () => {
  const entitlement = { 'get-task-allow': true }
  const profile = { Entitlements: entitlement, ProvisionedDevices: ['test-device'] }
  const result = auditDevelopmentDevice(entitlement, profile, 'test-device')
  assert.deepEqual(result, { developmentDeviceIncluded: true })
  assert.throws(() => auditDevelopmentDevice(entitlement, profile, 'another-device'))
  assert.throws(() => auditDevelopmentDevice(entitlement, profile, ''))
  assert.throws(() => auditDevelopmentDevice({}, profile, 'test-device'))
  assert.throws(() => auditDevelopmentDevice(entitlement, { ...profile, Entitlements: {} }, 'test-device'))
  assert.throws(() => auditDevelopmentDevice(entitlement, { Entitlements: entitlement }, 'test-device'))
})
test('validates client config offline without returning the API key or claiming delivery', () => {
  const client = { PROJECT_ID: 'nq-app-f3127', BUNDLE_ID: bundle, GCM_SENDER_ID: '54689871019', GOOGLE_APP_ID: '1:54689871019:ios:bf4f2ec894b1aa99bf73ee', API_KEY: 'AIza' + 'a'.repeat(35) }
  assert.equal(auditFirebaseClient(undefined).clientConfiguration, 'missing_fail_closed')
  const result = auditFirebaseClient(client)
  assert.equal(result.clientConfiguration, 'validated_offline')
  assert.equal(JSON.stringify(result).includes(client.API_KEY), false)
  for (const key of Object.keys(client)) assert.throws(() => auditFirebaseClient({ ...client, [key]: 'wrong' }))
})
const settings = { PRODUCT_BUNDLE_IDENTIFIER: bundle, DEVELOPMENT_TEAM: team, CODE_SIGN_STYLE: 'Automatic', CODE_SIGN_ENTITLEMENTS: 'App/App.entitlements', APS_ENVIRONMENT: 'development' }
test('requires synced FCM bridge and all local privacy/activation guards', () => {
  const info = { FirebaseMessagingAutoInitEnabled: false, FirebaseAppDelegateProxyEnabled: false, FIREBASE_ANALYTICS_COLLECTION_ENABLED: false, FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED: true }
  const config = { plugins: { NoQueueFcm: { enabled: false } }, packageClassList: ['NoQueueFcmPlugin'] }
  assert.equal(auditFcmConfiguration(info, config).nativeGate, 'off')
  for (const key of Object.keys(info)) assert.throws(() => auditFcmConfiguration({ ...info, [key]: !info[key] }, config))
  assert.throws(() => auditFcmConfiguration(info, { ...config, packageClassList: [] }))
  assert.throws(() => auditFcmConfiguration(info, { ...config, plugins: { NoQueueFcm: { enabled: true } } }))
})
test('audits resolved Debug/Release settings and simulator isolation, not just project text', () => {
  assert.equal(auditSettings(settings, 'Debug', 'iphoneos').configurationAudit, 'passed')
  assert.equal(auditSettings({ ...settings, APS_ENVIRONMENT: 'production' }, 'Release', 'iphoneos').environment, 'production')
  assert.equal(auditSettings({ ...settings, CODE_SIGN_ENTITLEMENTS: undefined }, 'Debug', 'iphonesimulator').entitlements, 'none')
  for (const [field, value] of [['PRODUCT_BUNDLE_IDENTIFIER', 'com.noqueue.app'], ['DEVELOPMENT_TEAM', 'OTHERTEAM1'], ['APS_ENVIRONMENT', 'production'], ['CODE_SIGN_ENTITLEMENTS', ''], ['CODE_SIGN_STYLE', 'Manual']]) {
    assert.throws(() => auditSettings({ ...settings, [field]: value }, 'Debug', 'iphoneos'))
  }
  assert.throws(() => auditSettings(settings, 'Debug', 'iphonesimulator'))
})
const info = { CFBundleIdentifier: bundle, DTPlatformName: 'iphoneos' }
const entitlements = { 'application-identifier': `${team}.${bundle}`, 'com.apple.developer.team-identifier': team, 'aps-environment': 'production', 'get-task-allow': false }
const profile = () => ({ TeamIdentifier: [team], ExpirationDate: '2099-01-01', Entitlements: { ...entitlements } })
test('extracts profile audit fields even with plist dates and certificate data', { skip: process.platform !== 'darwin' }, () => {
  const result = parseProfile(`<?xml version="1.0"?><plist version="1.0"><dict>
    <key>TeamIdentifier</key><array><string>${team}</string></array>
    <key>ProvisionedDevices</key><array><string>test-device</string></array>
    <key>ExpirationDate</key><date>2099-01-01T00:00:00Z</date>
    <key>DeveloperCertificates</key><array><data>YWI=</data></array>
    <key>Entitlements</key><dict><key>aps-environment</key><string>production</string></dict>
  </dict></plist>`)
  assert.deepEqual(result.TeamIdentifier, [team])
  assert.deepEqual(result.ProvisionedDevices, ['test-device'])
  assert.ok(Date.parse(result.ExpirationDate) > Date.now())
  assert.equal(result.Entitlements['aps-environment'], 'production')
  assert.equal(result.DeveloperCertificates, undefined)
})
test('requires agreement of profile, signed entitlements, bundle, team and expiry', () => {
  assert.equal(auditSignedMetadata(info, entitlements, profile(), 'production').signedMetadata, 'passed')
  for (const p of [{ ...profile(), ExpirationDate: '2000-01-01' }, { ...profile(), TeamIdentifier: ['OTHER'] },
    { ...profile(), Entitlements: { ...entitlements, 'aps-environment': 'development' } }]) {
    assert.throws(() => auditSignedMetadata(info, entitlements, p, 'production'))
  }
  for (const e of [{ ...entitlements, 'application-identifier': `${team}.*` }, { ...entitlements, 'get-task-allow': true }, { ...entitlements, 'aps-environment': 'development' }]) {
    assert.throws(() => auditSignedMetadata(info, e, profile(), 'production'))
  }
  assert.throws(() => auditSignedMetadata({ ...info, DTPlatformName: 'iphonesimulator' }, entitlements, profile(), 'production'))
  assert.throws(() => auditSignedMetadata(info, entitlements, profile(), 'sandbox'))
})
