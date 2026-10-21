import { isIP } from 'node:net'
import path from 'node:path'

export function privateHost(host) {
  if (isIP(host) !== 4) return false
  const [a, b] = host.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
/** Opt-in private interface only; no public/wildcard listeners or production URLs. */
export function mobileNetwork(env, root) {
  if (!env.NOQUEUE_LOCAL_HOST) return {
    host: '127.0.0.1', origin: 'https://127.0.0.1:8788',
    key: path.join(root, 'reports/android-local/tls/server.key'),
    cert: path.join(root, 'reports/android-local/tls/res/raw/noqueue_local_ca.pem'),
  }
  if (!privateHost(env.NOQUEUE_LOCAL_HOST)) throw new Error('Select a private IPv4 interface')
  const tls = path.join(root, 'reports/ios-device/tls')
  return { host: env.NOQUEUE_LOCAL_HOST, origin: `https://${env.NOQUEUE_LOCAL_HOST}:8788`,
    key: path.join(tls, 'server.key'), cert: path.join(tls, 'server.pem') }
}
