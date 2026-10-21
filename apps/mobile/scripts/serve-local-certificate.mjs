// Public certificate only. Never serve the TLS directory or any private key.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { privateHost } from '../../api/scripts/mobile-network.mjs'
const host = process.env.NOQUEUE_LOCAL_HOST
if (!privateHost(host ?? '')) throw new Error('Set a private NOQUEUE_LOCAL_HOST')
const certificate = readFileSync(new URL('../../../reports/ios-device/tls/noqueue-local.cer', import.meta.url))
const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/noqueue-local.cer') { res.writeHead(404).end(); return }
  res.writeHead(200, { 'Content-Type':'application/x-x509-ca-cert', 'Content-Disposition':'attachment; filename="noqueue-local.cer"', 'Cache-Control':'no-store' }).end(certificate)
})
server.listen(8089, host, () => console.log(`Public CA download only: http://${host}:8089/noqueue-local.cer`))
const close = () => server.close(() => process.exit(0))
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, close)
setTimeout(close, 15 * 60 * 1000).unref()
