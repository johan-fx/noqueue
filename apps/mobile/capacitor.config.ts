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


// Package scripts set this explicitly because the registered IDs differ by platform.
const platform = process.env.NOQUEUE_NATIVE_PLATFORM ?? (process.argv.includes('ios') ? 'ios' : 'android')
if (platform !== 'ios' && platform !== 'android') throw new Error('Invalid NOQUEUE_NATIVE_PLATFORM')

const localServer = liveReloadServer(process.env.NOQUEUE_LIVE_RELOAD_URL, process.env.NOQUEUE_LOCAL_DEVELOPMENT)
if (localServer && platform !== 'ios') throw new Error('This local live-reload workflow is iOS-only')
const config: CapacitorConfig = {
  appId: platform === 'ios' ? 'com.noqueue-app.ios' : 'com.noqueue.app',
  appName: 'No Queue',
  ...(localServer ? { server: localServer } : {}),
  webDir: '../web/dist',
  // Native bridge debug logs include plugin arguments (including vault secrets).
  loggingBehavior: 'none',
  // Foreground refreshes the current turn via the listener; no duplicate banner,
  // sound or badge while it is visible. Background remains an APNs alert.
  plugins: {
    PushNotifications: { presentationOptions: [] },
    // Separate native opt-in; no SDK initialization even if JS is misconfigured.
    NoQueueFcm: { enabled: false },
  },
}

export default config
