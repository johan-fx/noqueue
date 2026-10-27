#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { mobileProfile } from './release-profiles.mjs'
const EXPECTED_IOS_BUNDLE_ID = 'com.noqueue-app.ios'
const EXPECTED_ANDROID_BUNDLE_ID = 'com.noqueueapp.android'
const EXPECTED_ANDROID_FIREBASE = {
  project_id: 'nq-app-f3127',
  gcm_defaultSenderId: '54689871019',
  google_app_id: '1:54689871019:android:862772299ec67a4cbf73ee',
}
const EXPECTED_TEAM_ID = '6VYYNUZPSH'
const EXPECTED_TARGET_SDK = 36
const RELEASE_MANIFEST = 'noqueue-mobile-release.json'

export function parseOptions(argv) {
  const options = { profile: undefined, buildNumber: undefined, androidAab: undefined, iosArchive: undefined, iosIpa: undefined, allowUnsigned: false, expectedAndroidCertSha256: undefined, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--allow-unsigned') options.allowUnsigned = true
    else if (['--profile', '--build-number', '--android-aab', '--ios-archive', '--ios-ipa', '--expected-android-upload-cert-sha256'].includes(arg)) {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      if (arg === '--profile') options.profile = value
      else if (arg === '--build-number') options.buildNumber = value
      else if (arg === '--android-aab') options.androidAab = value
      else if (arg === '--ios-archive') options.iosArchive = value
      else if (arg === '--ios-ipa') options.iosIpa = value
      else options.expectedAndroidCertSha256 = value
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.help) {
    mobileProfile(options.profile)
    if (!/^[1-9][0-9]*$/.test(options.buildNumber ?? '')) throw new Error('--build-number must be a positive integer')
    const buildNumber = Number(options.buildNumber)
    if (!Number.isSafeInteger(buildNumber) || buildNumber > 2_100_000_000) throw new Error('--build-number must be between 1 and 2100000000')
    options.buildNumber = buildNumber
    if (!options.androidAab && !options.iosArchive && !options.iosIpa) throw new Error('Supply at least one real artifact: --android-aab, --ios-archive, or --ios-ipa')
    if (options.expectedAndroidCertSha256 && !/^(?:[0-9a-f]{2}:?){32}$/i.test(options.expectedAndroidCertSha256))
      throw new Error('--expected-android-upload-cert-sha256 must be a 32-byte SHA-256 fingerprint')
  }
  return options
}

function command(commandName, args, extra = {}) {
  const result = spawnSync(commandName, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...extra })
  return { ok: !result.error && result.status === 0, status: result.status, error: result.error, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function check(result, name, passed, message, readinessOnly = false) {
  result.checks.push({ name, passed, message })
  if (!passed) {
    if (!readinessOnly) result.auditValid = false
    result.storeReady = false
    result.blockers.push(message)
  }
}

export function validateReleaseManifest(manifest, expectedBuildNumber, expectedProfile = 'internal-staging') {
  const selected = mobileProfile(expectedProfile)
  const errors = []
  if (!manifest || typeof manifest !== 'object') return ['Release profile marker is missing or invalid']
  if (manifest.schemaVersion !== 1) errors.push('Unsupported mobile release marker schema')
  if (manifest.profile !== expectedProfile) errors.push('Embedded profile marker does not match requested ' + expectedProfile)
  if (Number(manifest.buildNumber) !== Number(expectedBuildNumber)) errors.push('Embedded web build number does not match the requested build number')
  if (manifest.apiOrigin !== selected.origin || manifest.publicAppOrigin !== selected.origin) errors.push('Embedded web origins do not match the requested profile')
  if (manifest.pushEnabled !== true || manifest.analyticsEnabled !== false || manifest.ga4MeasurementId !== '') errors.push('Embedded web build flags do not match release profile (push on, analytics/GA4 off)')
  if (!/^[a-f0-9]{64}$/i.test(manifest.assetsSha256 ?? '')) errors.push('Embedded web asset SHA-256 is malformed')
  return errors
}

export function validateAndroidManifest(xml, expectedBuildNumber) {
  const errors = []
  const manifestTag = xml.match(/<manifest\b[^>]*>/)?.[0] ?? ''
  const sdkTag = xml.match(/<uses-sdk\b[^>]*>/)?.[0] ?? ''
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name.replace(':', ':')}=["']([^"']*)["']`))?.[1]
  if (attr(manifestTag, 'package') !== EXPECTED_ANDROID_BUNDLE_ID) errors.push('Android package id does not match com.noqueueapp.android')
  if (Number(attr(manifestTag, 'android:versionCode')) !== Number(expectedBuildNumber)) errors.push('Android manifest versionCode does not match build number')
  if (Number(attr(sdkTag, 'android:targetSdkVersion')) !== EXPECTED_TARGET_SDK) errors.push(`Android targetSdkVersion must be ${EXPECTED_TARGET_SDK}`)

  const permissionTags = [...xml.matchAll(/<uses-permission(?:-sdk-\d+)?\b[^>]*>/g)].map(match => match[0])
  const permissions = permissionTags.map(tag => ({ name: attr(tag, 'android:name'), maxSdk: attr(tag, 'android:maxSdkVersion') }))
  const required = ['android.permission.INTERNET', 'android.permission.CAMERA', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.POST_NOTIFICATIONS']
  for (const permission of required) if (!permissions.some(item => item.name === permission)) errors.push(`Android merged manifest is missing ${permission}`)
  const fineLocation = permissions.find(item => item.name === 'android.permission.ACCESS_FINE_LOCATION')
  if (!fineLocation || Number(fineLocation.maxSdk) > 30 || !fineLocation.maxSdk) errors.push('Android fine location must be limited to maxSdkVersion=30')
  const forbidden = [
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_EXACT_ALARM',
    'android.permission.RECORD_AUDIO',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_IMAGES',
  ]
  for (const permission of forbidden) if (permissions.some(item => item.name === permission)) errors.push(`Android manifest contains unneeded/restricted permission ${permission}`)

  const meta = name => {
    const tag = xml.match(new RegExp(`<meta-data\\b(?=[^>]*android:name=["']${name}["'])[^>]*>`))?.[0]
    return tag ? attr(tag, 'android:value') : undefined
  }
  for (const [name, expected] of [
    ['firebase_messaging_auto_init_enabled', 'false'],
    ['firebase_analytics_collection_enabled', 'false'],
    ['firebase_analytics_collection_deactivated', 'true'],
  ]) if (meta(name) !== expected) errors.push(`Android merged manifest must set ${name}=${expected}`)
  if (!xml.includes('com.capacitorjs.plugins.pushnotifications.MessagingService') || !xml.includes('com.google.firebase.messaging.FirebaseMessagingService'))
    errors.push('Android merged manifest is missing Firebase/Capacitor messaging services')
  return errors
}

export function validateIosPrivacy(info, entitlements, expectedBuildNumber) {
  const errors = []
  if (info.CFBundleIdentifier !== EXPECTED_IOS_BUNDLE_ID) errors.push('iOS bundle id does not match com.noqueue-app.ios')
  if (String(info.CFBundleVersion) !== String(expectedBuildNumber)) errors.push('iOS CFBundleVersion does not match build number')
  for (const key of ['NSCameraUsageDescription', 'NSLocationWhenInUseUsageDescription']) {
    if (typeof info[key] !== 'string' || !info[key].trim()) errors.push(`iOS Info.plist is missing ${key}`)
  }
  for (const key of ['NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription']) {
    if (key in info) errors.push(`iOS Info.plist declares an unused media permission: ${key}`)
  }
  if (entitlements['aps-environment'] !== 'production') errors.push('Signed iOS app must carry aps-environment=production for store/TestFlight distribution')
  if (entitlements['get-task-allow'] !== false) errors.push('Signed iOS app must set get-task-allow=false for distribution')
  if (entitlements['application-identifier'] !== `${EXPECTED_TEAM_ID}.${EXPECTED_IOS_BUNDLE_ID}`) errors.push('Signed iOS application-identifier does not match the expected team/bundle id')
  return errors
}

function zipEntries(archivePath) {
  const result = command('unzip', ['-Z1', archivePath])
  if (!result.ok) throw new Error(`Could not list artifact zip entries${result.error ? `: ${result.error.message}` : ''}`)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

function zipEntry(archivePath, entry) {
  const result = command('unzip', ['-p', archivePath, entry], { encoding: null })
  if (!result.ok) throw new Error(`Could not read packaged entry: ${entry}`)
  return result.stdout
}

function parseJsonBuffer(buffer, description) {
  try { return JSON.parse(buffer.toString('utf8')) } catch { throw new Error(`${description} is not valid JSON`) }
}

function hasUnapprovedLoopbackUrl(jsText) {
  // React Router uses these two exact `http://localhost` values as inert URL
  // parser bases: one for resolving a document URL and one for resolving a
  // relative href. Allow only those literal occurrences in their parser
  // contexts; direct fetch/Request endpoints and other URL constructor inputs
  // remain release blockers. Keep this deliberately coupled to the minified
  // emitted shape so dependency changes fail closed until reviewed.
  const allowedOffsets = new Set()
  const parserFallbacks = [
    /function\s+[A-Za-z_$][\w$]*\([^)]*\)\{let\s+([A-Za-z_$][\w$]*)=`http:\/\/localhost`;([A-Za-z_$][\w$]*)&&\(\1=\2\.location\.origin===`null`\?\2\.location\.href:\2\.location\.origin\)/g,
    /(?:var|let|const)\s+([A-Za-z_$][\w$]*)=new URL\(`http:\/\/localhost`\);function\s+[A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{if\(\2\.createURL\)return\s+\2\.createURL\(`\/`\);try\{return new URL\(\2\.createHref\(`\/`\),\1\)\}/g,
  ]
  for (const pattern of parserFallbacks) {
    for (const match of jsText.matchAll(pattern)) {
      const literalOffset = match[0].indexOf('http://localhost')
      if (literalOffset >= 0) allowedOffsets.add(match.index + literalOffset)
    }
  }

  const loopbackUrls = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/gi
  for (const match of jsText.matchAll(loopbackUrls)) {
    if (!allowedOffsets.has(match.index)) return true
  }
  return false
}

export function validateWebContent(assetContents, manifest) {
  const errors = []
  const javascript = assetContents.filter(item => item.name.endsWith('.js'))
  if (javascript.length === 0) errors.push('Native bundle contains no packaged JavaScript assets')
  const jsText = javascript.map(item => item.bytes.toString('utf8')).join('\n')
  if (manifest.profile === 'production' && jsText.includes('https://staging.noqueue-app.com')) errors.push('Production JavaScript contains the staging origin')
  if (!jsText.includes(manifest.apiOrigin)) errors.push('Compiled JavaScript does not contain the configured API origin')
  if (!jsText.includes(manifest.publicAppOrigin)) errors.push('Compiled JavaScript does not contain the configured public origin')
  if (javascript.some(item => hasUnapprovedLoopbackUrl(item.bytes.toString('utf8')))) errors.push('Compiled JavaScript contains a loopback/live-development URL outside the reviewed React Router parser fallbacks')
  if (/\bG-[A-Z0-9]{10}\b/.test(jsText)) errors.push('Compiled JavaScript appears to contain a GA4 measurement id while analytics is disabled')
  if (manifest.ga4MeasurementId !== '') errors.push('Release marker unexpectedly contains a GA4 measurement id')
  return errors
}

function verifyWebMarkerAndHash(entries, prefix, archivePath, expectedBuildNumber, result, expectedProfile) {
  const markerEntry = `${prefix}${RELEASE_MANIFEST}`
  if (!entries.includes(markerEntry)) {
    check(result, 'web-release-marker', false, `Native artifact is missing ${RELEASE_MANIFEST}`)
    return { manifest: null, assetContents: [] }
  }
  let manifest
  try { manifest = parseJsonBuffer(zipEntry(archivePath, markerEntry), RELEASE_MANIFEST) } catch (error) {
    check(result, 'web-release-marker', false, error.message)
    return { manifest: null, assetContents: [] }
  }
  const markerErrors = validateReleaseManifest(manifest, expectedBuildNumber, expectedProfile)
  check(result, 'web-release-marker', markerErrors.length === 0, markerErrors.join('; ') || 'Requested profile/build flags match')

  const assetEntries = entries.filter(name => name.startsWith(prefix) && !name.endsWith('/') && name !== markerEntry)
  const assetContents = []
  const digest = createHash('sha256')
  let emptyCordovaBridges = true
  for (const name of assetEntries.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    const relative = name.slice(prefix.length).replaceAll('\\', '/')
    const bytes = zipEntry(archivePath, name)
    if (['cordova.js', 'cordova_plugins.js'].includes(relative)) {
      if (bytes.length !== 0) emptyCordovaBridges = false
      continue
    }
    digest.update(relative).update('\0').update(bytes).update('\0')
    if (/\.(?:js|json)$/i.test(relative) || relative === 'index.html') assetContents.push({ name: relative, bytes })
  }
  const bridgeNames = ['cordova.js', 'cordova_plugins.js']
  const bridgesPresent = bridgeNames.every(name => entries.includes(`${prefix}${name}`))
  check(result, 'capacitor-cordova-stubs', bridgesPresent && emptyCordovaBridges, bridgesPresent && emptyCordovaBridges
    ? 'Only the expected empty Cordova bridge stubs were added by Capacitor sync'
    : 'Capacitor-generated Cordova bridge stubs are missing or contain unexpected code')
  const computed = digest.digest('hex')
  const hashMatches = computed === manifest.assetsSha256
  check(result, 'web-assets-sha256', hashMatches, hashMatches
    ? `Embedded web payload hash verified (${computed})`
    : `Embedded web payload hash mismatch (expected ${manifest.assetsSha256}, computed ${computed})`)
  const contentErrors = manifest ? validateWebContent(assetContents, manifest) : ['Release marker unavailable for web-content verification']
  check(result, 'compiled-web-profile', contentErrors.length === 0, contentErrors.join('; ') || 'Compiled JS carries requested origins and no loopback/GA4 configuration')
  return { manifest, assetContents }
}

function runBundletool(args) {
  const jarPath = process.env.BUNDLETOOL_JAR
  const executable = process.env.NOQUEUE_BUNDLETOOL
  return jarPath
    ? command('java', ['-jar', jarPath, ...args])
    : command(executable || 'bundletool', args)
}

function bundletoolManifest(aabPath) {
  const result = runBundletool(['dump', 'manifest', `--bundle=${aabPath}`, '--module=base'])
  if (!result.ok) return { error: result.error?.message ?? 'bundletool manifest dump failed or bundletool is not installed' }
  return { xml: result.stdout }
}

export function validateAndroidFirebaseResources(values) {
  return Object.entries(EXPECTED_ANDROID_FIREBASE)
    .filter(([name, expected]) => values[name] !== expected)
    .map(([name]) => `Compiled Android Firebase ${name} does not match the registered Play app`)
}

function normalizeFingerprint(value) { return value.replace(/[^a-f0-9]/gi, '').toUpperCase() }

function verifyAndroidAab(aabPath, expectedBuildNumber, expectedCert, allowUnsigned, expectedProfile) {
  const result = { kind: 'android-aab', path: path.resolve(aabPath), checks: [], blockers: [], auditValid: true, storeReady: true }
  let entries
  try {
    if (!existsSync(aabPath) || !statSync(aabPath).isFile()) throw new Error('Android AAB path is not a readable regular file')
    entries = zipEntries(aabPath)
    check(result, 'aab-container', entries.includes('base/manifest/AndroidManifest.xml'), entries.includes('base/manifest/AndroidManifest.xml') ? 'AAB contains base module manifest' : 'AAB is missing base/manifest/AndroidManifest.xml')
  } catch (error) {
    check(result, 'aab-container', false, error.message)
    return result
  }

  const signatureEntries = entries.filter(name => /(?:^|\/)META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/i.test(name))
  const verified = command('jarsigner', ['-verify', '-verbose', '-certs', aabPath])
  const hasSignature = signatureEntries.length > 0 && verified.ok && !/jar is unsigned/i.test(`${verified.stdout}\n${verified.stderr}`)
  if (hasSignature) check(result, 'aab-signature', true, 'AAB JAR signature verifies')
  else if (allowUnsigned && signatureEntries.length === 0) check(result, 'aab-signature', false, 'AAB is unsigned; accepted only for explicitly requested audit, never store-ready', true)
  else check(result, 'aab-signature', false, 'AAB is unsigned or its JAR signature does not verify')

  const manifestDump = bundletoolManifest(path.resolve(aabPath))
  if (!manifestDump.xml) check(result, 'android-manifest-decode', false, manifestDump.error)
  else {
    const errors = validateAndroidManifest(manifestDump.xml, expectedBuildNumber)
    check(result, 'android-manifest-policy', errors.length === 0, errors.join('; ') || `Package, versionCode, target SDK ${EXPECTED_TARGET_SDK}, required permissions, FCM, and restricted-permission policy verified`)
  }

  // Inspect the actual AAB resources, not just a source JSON that could have
  // changed after compilation. No API keys or private credentials are dumped.
  const firebaseValues = {}
  for (const name of Object.keys(EXPECTED_ANDROID_FIREBASE)) {
    const dump = runBundletool(['dump', 'resources', `--bundle=${path.resolve(aabPath)}`, `--resource=string/${name}`, '--values'])
    const values = [...dump.stdout.matchAll(/\[STR\] "([^"\r\n]*)"/g)].map(match => match[1])
    if (dump.ok && values.length === 1) firebaseValues[name] = values[0]
  }
  const firebaseErrors = validateAndroidFirebaseResources(firebaseValues)
  check(result, 'android-firebase-registration', firebaseErrors.length === 0,
    firebaseErrors.join('; ') || 'Compiled Firebase project, sender and Android app ID match the new Play registration')

  const profile = verifyWebMarkerAndHash(entries, 'base/assets/public/', aabPath, expectedBuildNumber, result, expectedProfile)
  const configName = ['base/assets/capacitor.config.json', 'base/assets/public/capacitor.config.json'].find(name => entries.includes(name))
  let capacitorConfig
  try { if (configName) capacitorConfig = parseJsonBuffer(zipEntry(aabPath, configName), 'Android Capacitor config') } catch { /* recorded below */ }
  const androidConfigOk = !capacitorConfig?.server && !!capacitorConfig && capacitorConfig.appId === EXPECTED_ANDROID_BUNDLE_ID
    && capacitorConfig.plugins?.NoQueueFcm?.releaseProfile === expectedProfile
    && capacitorConfig.plugins?.NoQueueFcm?.enabled === false
  check(result, 'android-capacitor-profile', androidConfigOk, androidConfigOk
    ? 'Android Capacitor config has requested profile marker; iOS-only NoQueueFcm remains disabled'
    : 'Android Capacitor config is missing the expected app id/profile marker or unexpectedly enables NoQueueFcm')

  const keytool = command('keytool', ['-printcert', '-jarfile', path.resolve(aabPath)])
  const fingerprint = keytool.stdout.match(/SHA256:\s*([0-9A-F:]{64,95})/i)?.[1]
  if (hasSignature && fingerprint && expectedCert) {
    const matches = normalizeFingerprint(fingerprint) === normalizeFingerprint(expectedCert)
    check(result, 'android-upload-key-reference', matches, matches
      ? 'AAB signer SHA-256 matches the externally supplied Play upload-certificate fingerprint'
      : 'AAB signer SHA-256 does not match the externally supplied Play upload-certificate fingerprint')
  } else if (hasSignature && fingerprint) {
    check(result, 'android-upload-key-reference', false, 'AAB signer is cryptographically valid, but no expected Play upload-certificate fingerprint was supplied; account/key association remains unknown', true)
  } else if (hasSignature) {
    check(result, 'android-upload-key-reference', false, 'Could not extract public signer fingerprint for comparison with the Play upload key')
  }
  if (profile.manifest?.pushEnabled !== true) check(result, 'android-push-profile', false, 'Push-enabled release profile marker is not verified')
  return result
}

function plistJsonFromFile(file) {
  const parsed = command('plutil', ['-convert', 'json', '-o', '-', file])
  if (!parsed.ok) throw new Error(`Could not read plist metadata: ${path.basename(file)}`)
  return JSON.parse(parsed.stdout)
}

export function plistJsonFromText(text, description) {
  const start = text.indexOf('<?xml')
  const plistStart = start >= 0 ? start : text.indexOf('<plist')
  if (plistStart < 0) throw new Error(`Could not decode ${description} plist`)
  const end = text.indexOf('</plist>', plistStart)
  if (end < 0) throw new Error(`Incomplete ${description} plist`)
  // Provisioning profiles contain dates/data, which plutil cannot serialize to JSON.
  const parser = 'import sys,json,plistlib,datetime; print(json.dumps(plistlib.loads(sys.stdin.buffer.read()), default=lambda v: v.replace(tzinfo=datetime.timezone.utc).isoformat() if isinstance(v,datetime.datetime) else None))'
  const decoded = command('python3', ['-c', parser], { input: text.slice(plistStart, end + 8) })
  if (!decoded.ok) throw new Error(`Could not parse ${description} plist`)
  return JSON.parse(decoded.stdout)
}

function verifyIosApp(appPath, expectedBuildNumber, label, allowProfileOmitted = false, expectedProfile = 'internal-staging') {
  const result = { kind: label, path: appPath, checks: [], blockers: [], auditValid: true, storeReady: true }
  try {
    const info = plistJsonFromFile(path.join(appPath, 'Info.plist'))
    const signing = command('codesign', ['-dv', '--verbose=4', appPath])
    const signingText = `${signing.stdout}\n${signing.stderr}`
    const verified = command('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    const entitlementsOutput = command('codesign', ['-d', '--entitlements', '-', '--xml', appPath])
    let entitlements = {}
    if (entitlementsOutput.ok) {
      try { entitlements = plistJsonFromText(`${entitlementsOutput.stdout}\n${entitlementsOutput.stderr}`, 'signed app entitlements') } catch { /* recorded below */ }
    }
    const errors = validateIosPrivacy(info, entitlements, expectedBuildNumber)
    check(result, 'ios-bundle-and-privacy', errors.length === 0, errors.join('; ') || 'iOS bundle ID/build and camera/location usage descriptions verified')
    check(result, 'ios-code-signature', verified.ok && signing.ok, verified.ok && signing.ok ? 'iOS code signature verifies' : 'iOS code signature is absent or does not verify')
    const distribution = /Authority=Apple Distribution:/i.test(signingText)
    check(result, 'ios-distribution-identity', distribution, distribution ? 'Signed with an Apple Distribution identity' : 'App is not signed with an Apple Distribution identity')
    check(result, 'ios-team-id', signingText.includes(`TeamIdentifier=${EXPECTED_TEAM_ID}`), signingText.includes(`TeamIdentifier=${EXPECTED_TEAM_ID}`) ? 'Apple team identifier matches the configured app team' : 'Signed iOS app team identifier does not match the configured team')
    check(result, 'ios-apns-entitlement', entitlements['aps-environment'] === 'production', entitlements['aps-environment'] === 'production' ? 'Signed app has production APNs entitlement' : 'Signed app lacks aps-environment=production')

    const configPath = [path.join(appPath, 'capacitor.config.json'), path.join(appPath, 'public/capacitor.config.json')].find(existsSync)
    let config
    try { if (configPath) config = JSON.parse(readFileSync(configPath, 'utf8')) } catch { /* recorded below */ }
    const configOk = !config?.server && !!config && config.appId === EXPECTED_IOS_BUNDLE_ID
      && config.plugins?.NoQueueFcm?.releaseProfile === expectedProfile
      && config.plugins?.NoQueueFcm?.enabled === true
      && config.packageClassList?.includes('NoQueueFcmPlugin')
    check(result, 'ios-capacitor-push-profile', configOk, configOk
      ? 'iOS Capacitor config enables NoQueueFcm for the requested profile'
      : 'iOS Capacitor config is missing the expected FCM release gate/plugin registration')
    check(result, 'ios-firebase-client-config', existsSync(path.join(appPath, 'GoogleService-Info.plist')), existsSync(path.join(appPath, 'GoogleService-Info.plist')) ? 'Firebase iOS client configuration is packaged' : 'Firebase iOS client configuration is missing')

    const profilePath = path.join(appPath, 'embedded.mobileprovision')
    if (!existsSync(profilePath) && allowProfileOmitted) {
      const distribution = /Authority=Apple Distribution:/i.test(signingText)
      const profileOmittedOk = distribution && entitlements['aps-environment'] === 'production' && entitlements['get-task-allow'] === false
      check(result, 'ios-app-store-provisioning', profileOmittedOk, profileOmittedOk
        ? 'Store-export IPA has no embedded profile; distribution signature and production APNs entitlements are valid'
        : 'Store-export IPA without embedded profile is not signed for App Store distribution')
    } else if (!existsSync(profilePath)) check(result, 'ios-app-store-provisioning', false, 'App archive has no embedded provisioning profile')
    else {
      const decoded = command('security', ['cms', '-D', '-i', profilePath])
      let profile = {}
      try { if (decoded.ok) profile = plistJsonFromText(decoded.stdout, 'embedded provisioning profile') } catch { /* recorded below */ }
      const profileEntitlements = profile.Entitlements ?? {}
      const appIdentifier = profileEntitlements['application-identifier']
      const profileOk = decoded.ok
        && profileEntitlements['get-task-allow'] === false
        && profileEntitlements['aps-environment'] === 'production'
        && appIdentifier === `${EXPECTED_TEAM_ID}.${EXPECTED_IOS_BUNDLE_ID}`
        && profile.ProvisionsAllDevices !== true
        && !Array.isArray(profile.ProvisionedDevices)
        && (!profile.ExpirationDate || new Date(profile.ExpirationDate).getTime() > Date.now())
      check(result, 'ios-app-store-provisioning', profileOk, profileOk
        ? 'Embedded profile is non-development, production APNs, correct bundle/team, and unexpired'
        : 'Embedded provisioning profile is missing, development/ad-hoc, mismatched, expired, or not decodable')
    }

    const web = verifyWebMarkerAndHashFromDirectory(path.join(appPath, 'public'), expectedBuildNumber, result, expectedProfile)
    if (web.manifest?.pushEnabled !== true) check(result, 'ios-push-profile', false, 'Push-enabled release web profile marker is not verified')
    const frameworkNames = existsSync(path.join(appPath, 'Frameworks')) ? readdirSync(path.join(appPath, 'Frameworks')) : []
    const analyticsFrameworkPresent = frameworkNames.some(name => /FirebaseAnalytics|GoogleAppMeasurement/i.test(name))
    check(result, 'ios-analytics-sdk', !analyticsFrameworkPresent, analyticsFrameworkPresent ? 'Analytics framework is unexpectedly bundled in the release app' : 'No Firebase Analytics / Google App Measurement framework is bundled')
  } catch (error) {
    check(result, 'ios-app-inspection', false, error.message)
  }
  return result
}

function hashDirectoryContents(root, excluded = RELEASE_MANIFEST) {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('Packaged web directory is missing')
  const files = []
  const walk = (folder, prefix = '') => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const file = path.join(folder, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in packaged web assets: ${relative}`)
      if (entry.isDirectory()) walk(file, relative)
      else if (entry.isFile() && relative !== excluded && !['cordova.js', 'cordova_plugins.js'].includes(relative)) files.push({ file, relative })
      else if (!entry.isFile()) throw new Error(`Unexpected item in packaged web assets: ${relative}`)
    }
  }
  walk(root)
  if (!files.length) throw new Error('Packaged web directory contains no files')
  const hash = createHash('sha256')
  for (const item of files) hash.update(item.relative.replaceAll(path.sep, '/')).update('\0').update(readFileSync(item.file)).update('\0')
  return hash.digest('hex')
}

function verifyWebMarkerAndHashFromDirectory(publicRoot, expectedBuildNumber, result, expectedProfile) {
  let manifest
  try { manifest = JSON.parse(readFileSync(path.join(publicRoot, RELEASE_MANIFEST), 'utf8')) } catch {
    check(result, 'web-release-marker', false, `Packaged app is missing or has invalid ${RELEASE_MANIFEST}`)
    return { manifest: null }
  }
  const errors = validateReleaseManifest(manifest, expectedBuildNumber, expectedProfile)
  check(result, 'web-release-marker', errors.length === 0, errors.join('; ') || 'Requested profile/build flags match')
  const bridgesPresent = ['cordova.js', 'cordova_plugins.js'].every(name => existsSync(path.join(publicRoot, name)))
  const bridgesEmpty = bridgesPresent && ['cordova.js', 'cordova_plugins.js'].every(name => {
    const file = path.join(publicRoot, name)
    return lstatSync(file).isFile() && lstatSync(file).size === 0
  })
  check(result, 'capacitor-cordova-stubs', bridgesPresent && bridgesEmpty, bridgesPresent && bridgesEmpty
    ? 'Only the expected empty Cordova bridge stubs were added by Capacitor sync'
    : 'Capacitor-generated Cordova bridge stubs are missing or contain unexpected code')
  let actual
  try { actual = hashDirectoryContents(publicRoot) } catch (error) { actual = ''; errors.push(error.message) }
  check(result, 'web-assets-sha256', actual === manifest.assetsSha256, actual === manifest.assetsSha256
    ? `Embedded web payload hash verified (${actual})`
    : `Embedded web payload hash mismatch${actual ? ` (expected ${manifest.assetsSha256}, computed ${actual})` : ''}`)
  const js = []
  const collect = folder => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, item.name)
      if (item.isDirectory()) collect(full)
      else if (item.isFile() && item.name.endsWith('.js')) js.push(readFileSync(full))
    }
  }
  let contentErrors = []
  try { collect(publicRoot); contentErrors = validateWebContent(js.map((bytes, i) => ({ name: `asset-${i}.js`, bytes })), manifest) }
  catch (error) { contentErrors = [error.message] }
  check(result, 'compiled-web-profile', contentErrors.length === 0, contentErrors.join('; ') || 'Compiled JS carries requested origins and no loopback/GA4 configuration')
  return { manifest }
}

function verifyIosArchive(archivePath, buildNumber, expectedProfile) {
  const result = { kind: 'ios-xcarchive', path: path.resolve(archivePath), checks: [], blockers: [], auditValid: true, storeReady: true }
  try {
    if (!existsSync(archivePath) || !statSync(archivePath).isDirectory()) throw new Error('iOS archive path is not an existing .xcarchive directory')
    const products = path.join(archivePath, 'Products/Applications')
    const apps = existsSync(products) ? readdirSync(products).filter(name => name.endsWith('.app')) : []
    if (apps.length !== 1) throw new Error('iOS archive must contain exactly one application bundle')
    return verifyIosApp(path.join(products, apps[0]), buildNumber, 'ios-xcarchive', false, expectedProfile)
  } catch (error) {
    check(result, 'ios-archive-container', false, error.message)
    return result
  }
}

function verifyIosIpa(ipaPath, buildNumber, expectedProfile) {
  const result = { kind: 'ios-ipa', path: path.resolve(ipaPath), checks: [], blockers: [], auditValid: true, storeReady: true }
  let temp
  try {
    if (!existsSync(ipaPath) || !statSync(ipaPath).isFile()) throw new Error('iOS IPA path is not an existing regular file')
    const entries = zipEntries(ipaPath)
    const appPaths = [...new Set(entries.map(name => name.match(/^(Payload\/[^/]+\.app)\//)?.[1]).filter(Boolean))]
    if (appPaths.length !== 1) throw new Error('IPA must contain exactly one Payload/*.app bundle')
    temp = mkdtempSync(path.join(os.tmpdir(), 'noqueue-release-ipa-'))
    const extracted = command('unzip', ['-q', path.resolve(ipaPath), '-d', temp])
    if (!extracted.ok) throw new Error('Could not unpack IPA for read-only signature and manifest inspection')
    const app = path.join(temp, appPaths[0])
    const inspected = verifyIosApp(app, buildNumber, 'ios-ipa', true, expectedProfile)
    result.checks.push(...inspected.checks)
    result.blockers.push(...inspected.blockers)
    result.auditValid = inspected.auditValid
    result.storeReady = inspected.storeReady
    return result
  } catch (error) {
    check(result, 'ios-ipa-container', false, error.message)
    return result
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true })
  }
}

function usage() {
  console.log('Usage: pnpm mobile:release:verify --profile internal-staging|production --build-number N [--android-aab PATH] [--ios-archive PATH | --ios-ipa PATH] [--allow-unsigned] [--expected-android-upload-cert-sha256 SHA256]')
  console.log('Verification is read-only except temporary IPA extraction; it never uploads or provisions. --allow-unsigned is audit-only and can never result in storeReady=true.')
}

export async function main(argv = process.argv.slice(2)) {
  let options
  try { options = parseOptions(argv) } catch (error) {
    console.error(error.message)
    usage()
    return 2
  }
  if (options.help) { usage(); return 0 }

  const expectedCert = options.expectedAndroidCertSha256 ?? process.env.NOQUEUE_ANDROID_EXPECTED_UPLOAD_CERT_SHA256
  const artifacts = []
  if (options.androidAab) artifacts.push(verifyAndroidAab(options.androidAab, options.buildNumber, expectedCert, options.allowUnsigned, options.profile))
  if (options.iosArchive) artifacts.push(verifyIosArchive(options.iosArchive, options.buildNumber, options.profile))
  if (options.iosIpa) artifacts.push(verifyIosIpa(options.iosIpa, options.buildNumber, options.profile))

  const android = artifacts.find(item => item.kind === 'android-aab')
  const ios = artifacts.some(item => item.kind === 'ios-xcarchive' || item.kind === 'ios-ipa')
  const completenessBlockers = []
  if (!android) completenessBlockers.push('Android AAB was not supplied')
  if (!ios) completenessBlockers.push('Neither an iOS archive nor IPA was supplied')
  const storeReady = !!android && ios && artifacts.every(item => item.storeReady)
  const auditValid = artifacts.length > 0 && artifacts.every(item => item.auditValid)
  const report = {
    profile: options.profile,
    buildNumber: options.buildNumber,
    storeReady,
    auditValid,
    uploadPerformed: false,
    provisioningPerformed: false,
    externalAccountState: { googlePlayConsole: 'unknown', appStoreConnect: 'unknown' },
    blockers: [...completenessBlockers, ...artifacts.flatMap(item => item.blockers)],
    artifacts,
  }
  console.log(JSON.stringify(report, null, 2))
  return storeReady ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
