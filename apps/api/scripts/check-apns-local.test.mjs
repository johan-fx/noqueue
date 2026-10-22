import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { generateKeyPairSync } from 'node:crypto'
import { checkApnsKey, probeApnsTransport } from './check-apns-local.mjs'
const pem = curve => generateKeyPairSync('ec', { namedCurve: curve }).privateKey.export({ format: 'pem', type: 'pkcs8' })
test('checks P-256 / JOSE signature format offline and rejects wrong keys', () => {
  assert.equal(checkApnsKey(pem('prime256v1')).signatureBytes, 64)
  assert.throws(() => checkApnsKey(pem('secp384r1')), /expected_p256/)
  assert.throws(() => checkApnsKey('invalid'), /invalid_private_key/)
})
test('probe uses fixed Apple hosts, validates TLS and never opens a notification stream', async () => {
  for (const environment of ['sandbox', 'production']) {
    let destroyed = false
    const result = await probeApnsTransport(environment, { connectImpl: (url, options) => {
      assert.equal(url, `https://${environment === 'sandbox' ? 'api.sandbox' : 'api'}.push.apple.com:443`)
      assert.deepEqual(options, { minVersion: 'TLSv1.2', rejectUnauthorized: true })
      const session = Object.assign(new EventEmitter(), { alpnProtocol: 'h2', socket: { authorized: true, getProtocol: () => 'TLSv1.3' },
        destroy: () => { destroyed = true }, request: () => assert.fail('No HTTP request allowed') })
      queueMicrotask(() => session.emit('remoteSettings', {}))
      return session
    } })
    assert.equal(result.httpRequests, 0); assert.equal(destroyed, true)
  }
})
test('rejects arbitrary hosts before connecting', async () => {
  await assert.rejects(probeApnsTransport('https://evil.invalid', { connectImpl: () => assert.fail() }), /invalid_environment/)
})
test('timeouts, early close, invalid TLS and ALPN fail closed and clean up', async () => {
  for (const failure of ['timeout', 'close', 'error', 'tls', 'alpn']) {
    let destroyed = false
    await assert.rejects(probeApnsTransport('sandbox', { timeoutMs: 5, connectImpl: () => {
      const session = Object.assign(new EventEmitter(), { alpnProtocol: failure === 'alpn' ? 'http/1.1' : 'h2',
        socket: { authorized: failure !== 'tls' }, destroy: () => { destroyed = true } })
      if (failure !== 'timeout') queueMicrotask(() => session.emit(['close', 'error'].includes(failure) ? failure : 'remoteSettings'))
      return session
    } }), /transport_/)
    assert.equal(destroyed, true)
  }
})
