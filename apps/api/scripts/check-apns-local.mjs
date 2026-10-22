// Operator-only Node diagnostic. No device tokens, HTTP requests or provider JWTs.
// A successful local connection does NOT attest Workers fetch or APNs authorization.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { connect } from 'node:http2'
import { readFile, realpath, stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

export const destinations = {
  sandbox: { host: 'api.sandbox.push.apple.com', keyId: '33FG9322FT' },
  production: { host: 'api.push.apple.com', keyId: 'W666TVNM38' },
}
const requireCheck = (ok, code) => { if (!ok) throw new Error(code) }
export function checkApnsKey(pem) {
  let key
  try { key = createPrivateKey(pem) } catch { throw new Error('invalid_private_key') }
  requireCheck(key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails.namedCurve === 'prime256v1', 'expected_p256')
  const data = Buffer.from('NoQueue offline APNs verification — not a provider JWT')
  const signature = sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' })
  requireCheck(signature.length === 64 && verify('sha256', data, { key: createPublicKey(key), dsaEncoding: 'ieee-p1363' }, signature), 'signature_failed')
  return { curve: 'P-256', signatureBytes: 64, offlineSignature: 'passed' }
}
export async function probeApnsTransport(environment, { connectImpl = connect, timeoutMs = 10000 } = {}) {
  requireCheck(Object.hasOwn(destinations, environment), 'invalid_environment')
  const { host } = destinations[environment]
  return new Promise((resolve, reject) => {
    let session, timer, settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      session?.destroy()
      if (error) reject(new Error(error)); else resolve(result)
    }
    try {
      session = connectImpl(`https://${host}:443`, { minVersion: 'TLSv1.2', rejectUnauthorized: true })
      timer = setTimeout(() => finish('transport_timeout'), timeoutMs)
      session.once('error', () => finish('transport_failed'))
      session.once('close', () => finish('transport_closed'))
      session.once('remoteSettings', () => {
        if (session.alpnProtocol !== 'h2' || !session.socket.authorized) return finish('transport_not_verified')
        finish(null, { host, alpn: 'h2', tls: session.socket.getProtocol(), remoteSettings: 'received', httpRequests: 0 })
      })
      // Deliberately never call session.request(): only TLS + HTTP/2 SETTINGS.
    } catch { finish('transport_failed') }
  })
}

async function main() {
  const args = process.argv.slice(2)
  requireCheck(args.length >= 1 && args.length <= 2 && (!args[1] || args[1] === '--probe-transport'), 'invalid_arguments')
  const directory = await realpath(args[0])
  const repository = fileURLToPath(new URL('../../../', import.meta.url))
  requireCheck(!`${directory}/`.startsWith(repository), 'keys_must_be_outside_repository')
  requireCheck(((await stat(directory)).mode & 0o077) === 0, 'insecure_permissions')
  const results = {}
  for (const [environment, { keyId }] of Object.entries(destinations)) {
    const file = await realpath(path.join(directory, `AuthKey_${keyId}.p8`))
    const info = await stat(file)
    requireCheck(path.dirname(file) === directory && info.isFile() && (info.mode & 0o077) === 0, 'insecure_permissions')
    results[environment] = { keyId, ...checkApnsKey(await readFile(file, 'utf8')) }
    if (args[1]) results[environment].localNodeTransport = await probeApnsTransport(environment)
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), runtime: `Node ${process.version}`, team: '6VYYNUZPSH', topic: 'com.noqueue-app.ios',
    results, deliveryAttempted: false, credentialsSent: false, apnsAuthorization: 'not_tested', workerTransport: 'not_verified' }, null, 2))
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    // No raw TLS errors, PEMs, filesystem contents or credentials in output.
    console.error(JSON.stringify({ status: 'failed', code: 'apns_local_check_failed', deliveryAttempted: false }))
    process.exitCode = 1
  })
}
