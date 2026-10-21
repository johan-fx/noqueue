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
