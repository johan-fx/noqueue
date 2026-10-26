#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const webDist = path.join(repoRoot, 'apps/web/dist')
const releaseManifestName = 'noqueue-mobile-release.json'
const STAGING_ORIGIN = 'https://staging.noqueue-app.com'

export function parseOptions(argv) {
  const options = { profile: undefined, buildNumber: undefined, platform: 'both', dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--profile' || arg === '--build-number' || arg === '--platform') {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      if (arg === '--profile') options.profile = value
      else if (arg === '--platform') options.platform = value
      else options.buildNumber = value
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.help) {
    if (options.profile !== 'internal-staging') throw new Error('Only --profile internal-staging is currently supported')
    if (!['both', 'android', 'ios'].includes(options.platform)) throw new Error('--platform must be both, android, or ios')
    if (!/^[1-9][0-9]*$/.test(options.buildNumber ?? '')) throw new Error('--build-number must be a positive integer')
    const numericBuildNumber = Number(options.buildNumber)
    if (!Number.isSafeInteger(numericBuildNumber) || numericBuildNumber > 2_100_000_000)
      throw new Error('--build-number must be between 1 and 2100000000')
    options.buildNumber = numericBuildNumber
  }
  return options
}

export function releaseEnvironment(base = process.env) {
  const env = { ...base }
  // Native signing credentials are never needed by web compilation or sync.
  for (const key of Object.keys(env)) {
    if (/^(NOQUEUE_ANDROID_UPLOAD_|ANDROID_KEYSTORE|ANDROID_STORE_PASSWORD|ANDROID_KEY_ALIAS|ANDROID_KEY_PASSWORD)/.test(key)) delete env[key]
  }
  delete env.NOQUEUE_LIVE_RELOAD_URL
  delete env.NOQUEUE_LOCAL_DEVELOPMENT
  delete env.NOQUEUE_NATIVE_PLATFORM
  Object.assign(env, {
    NOQUEUE_MOBILE_RELEASE_PROFILE: 'internal-staging',
    VITE_APP_ENV: 'staging',
    VITE_API_URL: STAGING_ORIGIN,
    VITE_PUBLIC_APP_ORIGIN: STAGING_ORIGIN,
    VITE_MOBILE_PUSH_ENABLED: 'true',
    VITE_ANALYTICS_ENABLED: 'false',
    VITE_GA4_MEASUREMENT_ID: '',
  })
  return env
}

export function prepareCommands(platform = 'both') {
  if (!['both', 'android', 'ios'].includes(platform)) throw new Error('Invalid native platform')
  return [
    { command: 'pnpm', args: ['--filter', '@noqueue/web', 'build'] },
    platform === 'both'
      ? { command: 'pnpm', args: ['--filter', '@noqueue/mobile', 'sync'] }
      : { command: 'pnpm', args: ['--filter', '@noqueue/mobile', 'exec', 'cap', 'sync', platform] },
  ]
}

/** Hash a static web distribution in a path- and content-stable order. */
export function hashDirectory(root, { nativeGenerated = false } = {}) {
  const files = []
  const nativeStubs = new Set(['cordova.js', 'cordova_plugins.js'])
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in web distribution: ${relative}`)
      if (entry.isDirectory()) visit(absolute, relative)
      else if (entry.isFile() && relative === releaseManifestName) continue
      else if (entry.isFile() && nativeGenerated && nativeStubs.has(relative)) {
        if (lstatSync(absolute).size !== 0) throw new Error(`Unexpected nonempty Capacitor Cordova bridge stub: ${relative}`)
      } else if (entry.isFile()) files.push({ absolute, relative })
      else if (!entry.isFile()) throw new Error(`Unexpected non-file in web distribution: ${relative}`)
    }
  }
  visit(root)
  if (files.length === 0) throw new Error(`No web distribution files found under ${root}`)
  const digest = createHash('sha256')
  for (const file of files) {
    digest.update(file.relative.replaceAll(path.sep, '/')).update('\0')
    digest.update(readFileSync(file.absolute)).update('\0')
  }
  return digest.digest('hex')
}

export function releaseManifest(buildNumber, assetsSha256) {
  return {
    schemaVersion: 1,
    profile: 'internal-staging',
    buildNumber,
    apiOrigin: STAGING_ORIGIN,
    publicAppOrigin: STAGING_ORIGIN,
    pushEnabled: true,
    analyticsEnabled: false,
    ga4MeasurementId: '',
    assetsSha256,
  }
}

function createWebReleaseManifest(buildNumber) {
  const digest = hashDirectory(webDist)
  const manifest = releaseManifest(buildNumber, digest)
  writeFileSync(path.join(webDist, releaseManifestName), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
  return manifest
}

function verifySyncedWebAssets(manifest, platform) {
  const roots = {
    android: path.join(repoRoot, 'apps/mobile/android/app/src/main/assets/public'),
    ios: path.join(repoRoot, 'apps/mobile/ios/App/App/public'),
  }
  const platformRoots = platform === 'both' ? Object.values(roots) : [roots[platform]]
  for (const root of platformRoots) {
    const markerPath = path.join(root, releaseManifestName)
    if (!existsSync(markerPath)) throw new Error(`Capacitor sync did not copy ${releaseManifestName} to ${root}`)
    const copiedManifest = JSON.parse(readFileSync(markerPath, 'utf8'))
    for (const bridge of ['cordova.js', 'cordova_plugins.js']) {
      const bridgePath = path.join(root, bridge)
      if (!existsSync(bridgePath) || !lstatSync(bridgePath).isFile() || lstatSync(bridgePath).size !== 0)
        throw new Error(`Unexpected Capacitor-generated ${bridge}; only empty Cordova bridge stubs are allowed in this app payload`)
    }
    if (copiedManifest.assetsSha256 !== manifest.assetsSha256 || hashDirectory(root, { nativeGenerated: true }) !== manifest.assetsSha256)
      throw new Error(`Synced native web assets differ from the prepared distribution: ${root}`)
  }
}

function appleDistributionIdentityCount() {
  if (process.platform !== 'darwin') return { available: false, count: null }
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0) return { available: false, count: null }
  // Parse only the public identity class/count; never print hashes, names or raw output.
  const count = (result.stdout.match(/Apple Distribution:/g) ?? []).length
  return { available: true, count }
}

function showUsage() {
  console.log('Usage: pnpm mobile:release:prepare --profile internal-staging --build-number N [--platform both|android|ios] [--dry-run]')
  console.log('Builds the staging web bundle and syncs Capacitor only. It does not build, sign, archive, or upload native artifacts.')
}

export async function main(argv = process.argv.slice(2)) {
  let options
  try { options = parseOptions(argv) } catch (error) {
    console.error(error.message)
    showUsage()
    return 2
  }
  if (options.help) { showUsage(); return 0 }

  const identity = options.platform === 'android' ? { available: false, count: null } : appleDistributionIdentityCount()
  console.log('NoQueue mobile release preflight (metadata only)')
  console.log(`Profile: ${options.profile}`)
  console.log(`Build number: ${options.buildNumber}`)
  console.log(`Native platform: ${options.platform}`)
  console.log('Web/API origin: https://staging.noqueue-app.com')
  console.log('Push: enabled for internal staging; analytics: disabled')
  console.log(options.platform === 'android' ? 'Apple signing: not inspected for Android-only preparation' : identity.available
    ? `Apple Distribution identities: ${identity.count}${identity.count === 0 ? ' (iOS store signing blocked)' : ''}`
    : 'Apple Distribution identities: unknown (security metadata check unavailable)')
  console.log('Android upload signing: not inspected; no credentials or keystore contents read')
  console.log('Store readiness: false until signed Android AAB and iOS archive are verified')

  const commands = prepareCommands(options.platform)
  for (const { command, args } of commands) console.log(`$ ${command} ${args.join(' ')}`)
  if (options.dryRun) return 0

  const env = releaseEnvironment()
  if (options.platform !== 'both') env.NOQUEUE_NATIVE_PLATFORM = options.platform
  const oldManifest = path.join(webDist, releaseManifestName)
  if (existsSync(oldManifest)) rmSync(oldManifest)
  const buildCommand = commands[0]
  const buildResult = spawnSync(buildCommand.command, buildCommand.args, { cwd: repoRoot, env, stdio: 'inherit' })
  if (buildResult.error || buildResult.status !== 0) {
    console.error(buildResult.error ? `Could not run ${buildCommand.command}: ${buildResult.error.message}` : `${buildCommand.command} exited with status ${buildResult.status ?? 'unknown'}`)
    return buildResult.status ?? 1
  }
  let manifest
  try { manifest = createWebReleaseManifest(options.buildNumber) } catch (error) {
    console.error(`Could not stamp web build: ${error.message}`)
    return 1
  }
  console.log(`Prepared web payload SHA-256: ${manifest.assetsSha256}`)

  const syncCommand = commands[1]
  {
    const { command, args } = syncCommand
    const result = spawnSync(command, args, { cwd: repoRoot, env, stdio: 'inherit' })
    if (result.error) {
      console.error(`Could not run ${command}: ${result.error.message}`)
      return 1
    }
    if (result.status !== 0) {
      console.error(`${command} exited with status ${result.status ?? 'unknown'}`)
      return result.status ?? 1
    }
  }
  try { verifySyncedWebAssets(manifest, options.platform) } catch (error) {
    console.error(`Capacitor payload verification failed: ${error.message}`)
    return 1
  }
  console.log('Prepared staging web assets and synced Capacitor projects. No native build/sign/archive/upload was performed.')
  console.log(`Prepared web payload SHA-256 verified in ${options.platform} sync: ${manifest.assetsSha256}`)
  if (options.platform !== 'ios') {
    console.log(`Signed Android AAB (requires externally configured upload key): cd apps/mobile/android && ./gradlew bundleRelease -PnoqueueBuildNumber=${options.buildNumber}`)
    console.log(`Unsigned Android audit only: cd apps/mobile/android && ./gradlew bundleRelease -PnoqueueBuildNumber=${options.buildNumber} -PnoqueueAllowUnsignedRelease=true`)
    console.log('That explicit unsigned Release cannot be uploaded to Google Play and must verify as storeReady=false.')
  }
  if (options.platform !== 'android') {
    console.log(`iOS archive template (blocked until Apple Distribution identity and matching App Store provisioning exist): cd apps/mobile/ios && xcodebuild -project App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath build/NoQueue-internal-staging.xcarchive CURRENT_PROJECT_VERSION=${options.buildNumber} archive`)
    console.log('IPA export template after archive: xcodebuild -exportArchive -archivePath build/NoQueue-internal-staging.xcarchive -exportPath build/export -exportOptionsPlist /path/to/ExportOptions-AppStore.plist')
  }
  console.log('Do not add -allowProvisioningUpdates or upload flags: prepare/verify never provisions, publishes, or invites testers.')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
