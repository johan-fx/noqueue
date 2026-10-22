import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localPushOptions } from './local-push-options.mjs'
test('requires explicit platform opt-in', () => {
  for (const value of [undefined, '', 'true', 'android', 'only-my-phone'])
    assert.throws(() => localPushOptions({ NOQUEUE_REAL_PUSH_SMOKE: value }))
})
test('keeps iPhone defaults and requires LAN host', () => {
  assert.throws(() => localPushOptions({ NOQUEUE_REAL_PUSH_SMOKE: 'only-my-iphone' }))
  assert.deepEqual(localPushOptions({ NOQUEUE_REAL_PUSH_SMOKE: 'only-my-iphone', NOQUEUE_LOCAL_HOST: '192.168.1.38' }),
    { platform: 'ios', apiPort: 8788, controlPort: 8789, reportPath: 'reports/ios-device/push-real' })
})
test('isolates Android controls and evidence from running iPhone', () => {
  assert.deepEqual(localPushOptions({ NOQUEUE_REAL_PUSH_SMOKE: 'only-my-android' }),
    { platform: 'android', apiPort: 8790, controlPort: 8791, reportPath: 'reports/android-device/push-real' })
})
