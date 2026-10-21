// Explicit local-only Vite/HMR; production vite.config and Worker CORS stay intact.
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { Agent } from 'node:https'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mobileNetwork, privateHost } from '../../api/scripts/mobile-network.mjs'
const root = fileURLToPath(new URL('../../../', import.meta.url))
if (!privateHost(process.env.NOQUEUE_LOCAL_HOST ?? '')) throw new Error('Set NOQUEUE_LOCAL_HOST to the private IPv4 interface')
const network = mobileNetwork(process.env, root)
const origin = `https://${network.host}:5173`
process.env.VITE_API_URL = origin
process.env.VITE_PUBLIC_APP_ORIGIN = 'https://app.noqueue-app.com'
process.env.VITE_MOBILE_PUSH_ENABLED = 'false'
process.env.VITE_ANALYTICS_ENABLED = 'false'
const server = await createServer({ root: path.join(root,'apps/web'), server: {
  host: network.host, port: 5173, strictPort: true,
  https: { key: readFileSync(network.key), cert: readFileSync(network.cert) },
  proxy: { '/api': { target: network.origin, changeOrigin: true, secure: true,
    agent: new Agent({ ca: readFileSync(path.join(root,'reports/ios-device/tls/ca.pem')) }),
    // Only this non-deployable local proxy represents the native WebView origin.
    // Mobile routes still require the real installation secret; no auth bypass.
    configure(proxy) { proxy.on('proxyReq', request => request.setHeader('Origin','capacitor://localhost')) },
  } },
} })
await server.listen()
console.log(`NoQueue native live reload: ${origin}; push/analytics OFF; private LAN only`)
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
