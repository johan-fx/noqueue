import assert from 'node:assert/strict'

/** Explicit platform, fixed isolated ports; no arbitrary recipients or endpoints. */
export function localPushOptions(env) {
  assert.ok(['only-my-iphone', 'only-my-android'].includes(env.NOQUEUE_REAL_PUSH_SMOKE), 'Explicit real-push opt-in required')
  const platform = env.NOQUEUE_REAL_PUSH_SMOKE === 'only-my-android' ? 'android' : 'ios'
  if (platform === 'ios') assert.ok(env.NOQUEUE_LOCAL_HOST, 'Private LAN host required')
  return { platform, apiPort: platform === 'android' ? 8790 : 8788,
    controlPort: platform === 'android' ? 8791 : 8789,
    reportPath: `reports/${platform}-device/push-real` }
}
