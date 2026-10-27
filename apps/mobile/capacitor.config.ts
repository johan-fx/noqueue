import type { CapacitorConfig } from '@capacitor/cli'
import process from 'node:process'
/** No persisted IP, wildcard navigation or HTTP fallback in the shared config. */
export function liveReloadServer(url: string | undefined, enabled: string | undefined) {
  if (!url) return undefined
  if (enabled !== '1') throw new Error('Live reload requires NOQUEUE_LOCAL_DEVELOPMENT=1')
  const parsed = new URL(url)
  const octets = parsed.hostname.split('.').map(Number)
  const privateIp = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) || (octets[0] === 192 && octets[1] === 168))
  if (!privateIp || parsed.protocol !== 'https:' || parsed.port !== '5173' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error('Live reload requires a private HTTPS IPv4 origin on port 5173')
  return { url: parsed.origin, cleartext: false }
}

const RELEASE_ORIGINS = { 'internal-staging': 'https://staging.noqueue-app.com', production: 'https://app.noqueue-app.com' } as const

/**
 * Release profile validation belongs in Capacitor's config as well as the
 * preparation script: a direct `cap sync` must not silently create an
 * release native project with a mismatched origin, local, or push-off web env.
 */
export function mobileReleaseProfile(env: Record<string, string | undefined>, platform: string) {
  const profile = env.NOQUEUE_MOBILE_RELEASE_PROFILE
  if (profile === undefined || profile === '') return { profile: 'default', fcmEnabled: false }
  if (profile !== 'internal-staging' && profile !== 'production') throw new Error(`Unsupported mobile release profile: ${profile}`)
  if (platform !== 'ios' && platform !== 'android') throw new Error('Invalid NOQUEUE_NATIVE_PLATFORM')
  if (env.NOQUEUE_LIVE_RELOAD_URL || env.NOQUEUE_LOCAL_DEVELOPMENT === '1')
    throw new Error('Mobile release forbids live reload/local development')

  const required: Record<string, string> = {
    VITE_APP_ENV: profile === 'production' ? 'production' : 'staging',
    VITE_API_URL: RELEASE_ORIGINS[profile],
    VITE_PUBLIC_APP_ORIGIN: RELEASE_ORIGINS[profile],
    VITE_MOBILE_PUSH_ENABLED: 'true',
    VITE_ANALYTICS_ENABLED: 'false',
    VITE_GA4_MEASUREMENT_ID: '',
  }
  for (const [key, expected] of Object.entries(required)) {
    if (env[key] !== expected) throw new Error(`Mobile release requires ${key}=${expected || '(empty)'}`)
  }
  return { profile, fcmEnabled: platform === 'ios' }
}


// Package scripts set this explicitly because the registered IDs differ by platform.
const platform = process.env.NOQUEUE_NATIVE_PLATFORM ?? (process.argv.includes('ios') ? 'ios' : 'android')
if (platform !== 'ios' && platform !== 'android') throw new Error('Invalid NOQUEUE_NATIVE_PLATFORM')
const releaseProfile = mobileReleaseProfile(process.env, platform)

const localServer = liveReloadServer(process.env.NOQUEUE_LIVE_RELOAD_URL, process.env.NOQUEUE_LOCAL_DEVELOPMENT)
if (localServer && platform !== 'ios') throw new Error('This local live-reload workflow is iOS-only')
const config: CapacitorConfig = {
  appId: platform === 'ios' ? 'com.noqueue-app.ios' : 'com.noqueueapp.android',
  appName: 'No Queue',
  // iOS 18 support uses PackageDescription 6.0's .iOS(.v18) platform.
  // Capacitor's generated CapApp-SPM package must use matching Swift tools.
  experimental: { ios: { spm: { swiftToolsVersion: '6.0' } } },
  ...(localServer ? { server: localServer } : {}),
  webDir: '../web/dist',
  // Native bridge debug logs include plugin arguments (including vault secrets).
  loggingBehavior: 'none',
  // Foreground refreshes the current turn via the listener; no duplicate banner,
  // sound or badge while it is visible. Background remains an APNs alert.
  plugins: {
    // Retain the native launch artwork until the first usable route/error
    // commits. No minimum display time, no second splash on foregrounding.
    SplashScreen: { launchAutoHide: false, showSpinner: false, backgroundColor: '#E1E1E0', launchFadeOutDuration: 150 },
    PushNotifications: { presentationOptions: [] },
    // Separate native opt-in; no SDK initialization even if JS is misconfigured.
    // releaseProfile is an inert, non-secret marker alongside the plugin gate;
    // the release verifier checks the actual native bundle was synced from the
    // intended profile (including on Android, where this iOS-only plugin is off).
    NoQueueFcm: { enabled: releaseProfile.fcmEnabled, releaseProfile: releaseProfile.profile },
  },
}

export default config
