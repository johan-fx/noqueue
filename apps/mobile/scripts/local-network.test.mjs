import test from 'node:test'
import assert from 'node:assert/strict'
import { mobileNetwork, privateHost } from '../../api/scripts/mobile-network.mjs'
test('local API keeps loopback by default and only accepts explicit private IPv4', () => {
  assert.equal(mobileNetwork({}, '/repo').host, '127.0.0.1')
  for (const host of ['192.168.1.38', '10.0.0.2', '172.16.0.2', '172.31.255.2']) {
    assert.equal(privateHost(host), true)
    assert.equal(mobileNetwork({ NOQUEUE_LOCAL_HOST: host }, '/repo').origin, `https://${host}:8788`)
  }
  for (const host of ['0.0.0.0','8.8.8.8','app.noqueue-app.com','localhost','172.32.0.1','::','192.168.999.1','192.168.1.1/path']) {
    assert.equal(privateHost(host), false)
    assert.throws(() => mobileNetwork({ NOQUEUE_LOCAL_HOST: host }, '/repo'))
  }
})
test('Android can use its own USB port without changing host/TLS or iPhone defaults', () => {
  const android = mobileNetwork({ NOQUEUE_LOCAL_PORT: '8790' }, '/repo')
  assert.equal(android.origin, 'https://127.0.0.1:8790')
  assert.equal(android.host, '127.0.0.1')
  assert.equal(android.port, 8790)
  assert.equal(android.cert, mobileNetwork({}, '/repo').cert)
  assert.equal(mobileNetwork({}, '/repo').port, 8788)
  for (const port of ['', '80', '443', '0', '8791', '8790/path', 'NaN']) {
    assert.throws(() => mobileNetwork({ NOQUEUE_LOCAL_PORT: port }, '/repo'))
  }
})
