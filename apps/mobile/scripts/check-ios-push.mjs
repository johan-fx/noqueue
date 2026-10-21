// Read-only local audit; never creates a signing identity/profile or registers APNs.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
export const bundle = 'com.noqueue-app.ios', team = '6VYYNUZPSH'
const check = (value, message) => { if (!value) throw new Error(message) }
const run = (cmd, args, input) => execFileSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
const plist = input => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '--', '-'], input))
export function parseProfile(input) {
  // Provisioning profiles contain NSDate/NSData, which cannot be converted as a
  // whole plist to JSON. Extract only non-secret audit fields, never certificates.
  const extract = (field, format) => run('plutil', ['-extract', field, format, '-o', '-', '--', '-'], input).trim()
  let ProvisionedDevices = []
  try { ProvisionedDevices = JSON.parse(extract('ProvisionedDevices', 'json')) } catch { /* Store profiles have no device list. */ }
  return { ProvisionedDevices, TeamIdentifier: JSON.parse(extract('TeamIdentifier', 'json')),
    ExpirationDate: extract('ExpirationDate', 'raw'), Entitlements: JSON.parse(extract('Entitlements', 'json')) }
}

export function auditSettings(settings, configuration, sdk) {
  check(settings.PRODUCT_BUNDLE_IDENTIFIER === bundle, 'wrong_bundle')
  check(settings.DEVELOPMENT_TEAM === team, 'wrong_team')
  const environment = configuration === 'Debug' ? 'development' : 'production'
  check(settings.APS_ENVIRONMENT === environment, 'wrong_aps_environment')
  check(sdk === 'iphoneos' ? settings.CODE_SIGN_ENTITLEMENTS === 'App/App.entitlements' : !settings.CODE_SIGN_ENTITLEMENTS, 'wrong_entitlements_scope')
  check(settings.CODE_SIGN_STYLE === 'Automatic', 'unexpected_signing_style')
  return { configuration, sdk, bundle, team, environment, entitlements: sdk === 'iphoneos' ? 'App/App.entitlements' : 'none', configurationAudit: 'passed', signedArtifact: 'not_verified' }
}

export function auditFcmConfiguration(info, config) {
  check(info.FirebaseMessagingAutoInitEnabled === false, 'fcm_auto_init_enabled')
  check(info.FirebaseAppDelegateProxyEnabled === false, 'firebase_swizzling_enabled')
  check(info.FIREBASE_ANALYTICS_COLLECTION_ENABLED === false && info.FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED === true, 'firebase_analytics_enabled')
  check(config.plugins?.NoQueueFcm?.enabled === false, 'local_fcm_gate_enabled')
  check(config.packageClassList?.includes('NoQueueFcmPlugin'), 'fcm_plugin_not_synced')
  return { nativeGate: 'off', autoInit: 'off', swizzling: 'off', analytics: 'off', bridge: 'synced' }
}

export function auditFirebaseClient(client) {
  if (!client) return { clientConfiguration: 'missing_fail_closed' }
  check(client.PROJECT_ID === 'nq-app-f3127', 'wrong_firebase_project')
  check(client.BUNDLE_ID === bundle, 'wrong_firebase_bundle')
  check(client.GCM_SENDER_ID === '54689871019', 'wrong_firebase_sender')
  check(client.GOOGLE_APP_ID === '1:54689871019:ios:bf4f2ec894b1aa99bf73ee', 'wrong_firebase_app')
  check(/^AIza[A-Za-z0-9_-]{35}$/.test(client.API_KEY ?? ''), 'invalid_client_key_format')
  // Configuration shape/identity only; no authentication or SDK initialization.
  return { clientConfiguration: 'validated_offline', project: client.PROJECT_ID, bundle: client.BUNDLE_ID, appId: client.GOOGLE_APP_ID }
}

export function auditSignedMetadata(info, entitlements, profile, environment, now = Date.now()) {
  check(['development', 'production'].includes(environment), 'invalid_environment')
  check(info.CFBundleIdentifier === bundle && info.DTPlatformName === 'iphoneos', 'not_device_app')
  const profileEntitlements = profile.Entitlements ?? {}
  check(Array.isArray(profile.TeamIdentifier) && profile.TeamIdentifier.includes(team), 'wrong_profile_team')
  check(Date.parse(profile.ExpirationDate) > now, 'profile_expired')
  for (const value of [entitlements, profileEntitlements]) {
    check(value['application-identifier'] === `${team}.${bundle}`, 'wrong_application_identifier')
    check(value['com.apple.developer.team-identifier'] === team, 'wrong_entitlement_team')
    check(value['aps-environment'] === environment, 'signed_environment_mismatch')
  }
  if (environment === 'production') check(!entitlements['get-task-allow'] && !profileEntitlements['get-task-allow'], 'debuggable_production_app')
  return { bundle, team, environment, signedMetadata: 'passed', apnsAuthorization: 'not_tested', deliveryAttempted: false }
}

export function auditDevelopmentDevice(entitlements, profile, device) {
  check(typeof device === 'string' && device.length > 0, 'device_required')
  check(entitlements['get-task-allow'] === true && profile.Entitlements?.['get-task-allow'] === true, 'not_development_profile')
  check(Array.isArray(profile.ProvisionedDevices) && profile.ProvisionedDevices.includes(device), 'device_not_provisioned')
  // Do not include the device identifier in shareable audit output.
  return { developmentDeviceIncluded: true }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length) {
    check((args.length === 4 || (args.length === 6 && args[4] === '--device' && args[3] === 'development')) && args[0] === '--app' && args[2] === '--environment', 'invalid_arguments')
    const app = path.resolve(args[1])
    // Check the bundle signature before trusting its displayed entitlements.
    run('codesign', ['--verify', '--deep', '--strict', app])
    const entitlements = plist(run('codesign', ['--display', '--entitlements', ':-', app]))
    const profile = parseProfile(run('security', ['cms', '-D', '-i', path.join(app, 'embedded.mobileprovision')]))
    console.log(JSON.stringify({ at: new Date().toISOString(), ...auditSignedMetadata(plist(readFileSync(path.join(app, 'Info.plist'))), entitlements, profile, args[3]),
      ...(args[4] ? auditDevelopmentDevice(entitlements, profile, args[5]) : {}), signatureIntegrity: 'passed', appleTrustAndDelivery: 'not_verified' }, null, 2))
    return
  }
  const results = []
  for (const [configuration, sdk] of [['Debug', 'iphoneos'], ['Release', 'iphoneos'], ['Debug', 'iphonesimulator']]) {
    const values = JSON.parse(run('xcodebuild', ['-project', path.join(root, 'apps/mobile/ios/App/App.xcodeproj'), '-scheme', 'App',
      '-configuration', configuration, '-sdk', sdk, '-showBuildSettings', '-json',
      '-derivedDataPath', '/tmp/noqueue-push-ios-audit', '-clonedSourcePackagesDirPath', '/tmp/noqueue-mobile-spm',
      '-disableAutomaticPackageResolution', '-skipPackageUpdates']))
    const settings = values.find(value => value.target === 'App')?.buildSettings
    check(settings, 'app_target_missing')
    results.push(auditSettings(settings, configuration, sdk))
  }
  const info = plist(readFileSync(path.join(root, 'apps/mobile/ios/App/App/Info.plist')))
  check(!(info.UIBackgroundModes ?? []).includes('remote-notification'), 'unexpected_silent_push_mode')
  const entitlements = plist(readFileSync(path.join(root, 'apps/mobile/ios/App/App/App.entitlements')))
  check(entitlements['aps-environment'] === '$(APS_ENVIRONMENT)', 'entitlement_variable_missing')
  const config = JSON.parse(readFileSync(path.join(root, 'apps/mobile/ios/App/App/capacitor.config.json'), 'utf8'))
  check(config.appId === bundle && config.loggingBehavior === 'none', 'wrong_capacitor_config')
  check(Array.isArray(config.plugins?.PushNotifications?.presentationOptions) && config.plugins.PushNotifications.presentationOptions.length === 0, 'foreground_policy_not_synced')
  console.log(JSON.stringify({ at: new Date().toISOString(), xcode: run('xcodebuild', ['-version']).trim(), results,
    fcm: { ...auditFcmConfiguration(info, config), ...auditFirebaseClient(existsSync(path.join(root, 'apps/mobile/ios/App/App/GoogleService-Info.plist')) ? plist(readFileSync(path.join(root, 'apps/mobile/ios/App/App/GoogleService-Info.plist'))) : undefined) },
    copiedCapacitorConfiguration: 'passed', silentPushBackgroundMode: 'absent_by_design',
    signedDeviceProfile: 'not_verified', deliveryAttempted: false }, null, 2))
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main() } catch {
    // Never dump profiles, certificate identities, raw Xcode logs or app secrets.
    console.error(JSON.stringify({ status: 'failed', code: 'ios_push_audit_failed', deliveryAttempted: false }))
    process.exitCode = 1
  }
}
