import { isIP } from 'node:net'
import path from 'node:path'

export function privateHost(host) {
  if (isIP(host) !== 4) return false
  const [a, b] = host.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
/** Opt-in private interface only; no public/wildcard listeners or production URLs. */
export function mobileNetwork(env, root) {
  // Separate USB Android API without interrupting the existing iPhone fixture.
  const port = env.NOQUEUE_LOCAL_PORT ?? '8788'
  if (!['8788', '8790'].includes(port)) throw new Error('Select local API port 8788 or 8790')
  if (!env.NOQUEUE_LOCAL_HOST) return {
    host: '127.0.0.1', port: Number(port), origin: `https://127.0.0.1:${port}`,
    key: path.join(root, 'reports/android-local/tls/server.key'),
    cert: path.join(root, 'reports/android-local/tls/res/raw/noqueue_local_ca.pem'),
  }
  if (!privateHost(env.NOQUEUE_LOCAL_HOST)) throw new Error('Select a private IPv4 interface')
  const tls = path.join(root, 'reports/ios-device/tls')
  return { host: env.NOQUEUE_LOCAL_HOST, port: Number(port), origin: `https://${env.NOQUEUE_LOCAL_HOST}:${port}`,
    key: path.join(tls, 'server.key'), cert: path.join(tls, 'server.pem') }
}
