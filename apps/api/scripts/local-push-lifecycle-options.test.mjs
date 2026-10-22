import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lifecycleOptions, lifecycleWindow, scenarios } from './local-push-lifecycle-options.mjs'
test('requires its own explicit opt-in and bounded scenario', () => {
  for (const env of [{}, {NOQUEUE_REAL_PUSH_SMOKE:'only-my-iphone'}, {NOQUEUE_REAL_PUSH_LIFECYCLE:'only-my-android'}, {NOQUEUE_REAL_PUSH_LIFECYCLE:'only-my-android',NOQUEUE_PUSH_SCENARIO:'all'}]) assert.throws(()=>lifecycleOptions(env))
  for (const scenario of Object.keys(scenarios)) {
    const result=lifecycleOptions({NOQUEUE_REAL_PUSH_LIFECYCLE:'only-my-android',NOQUEUE_PUSH_SCENARIO:scenario})
    assert.equal(result.platform,'android')
    assert.equal(result.apiPort,8792)
    assert.equal(result.controlPort,8793)
    const budget=Object.values(result.limits).reduce((a,b)=>a+b,0)
    assert.ok(budget>=1 && budget<=20)
    assert.match(result.reportPath,/push-lifecycle$/)
  }
})
test('closure uses an actual finite Madrid service window and rejects crossing midnight', () => {
  const result=lifecycleWindow('closure',new Date('2026-10-21T10:20:00Z'))
  assert.equal(result.twentyFourHours,false)
  assert.equal(result.schedules[0].to,'12:28')
  assert.ok(result.windowId.startsWith('2026-10-21:00:00:12:28:'))
  assert.throws(()=>lifecycleWindow('closure',new Date('2026-10-21T21:56:00Z')))
  assert.equal(lifecycleWindow('normal').twentyFourHours,true)
})

test('an operator may only reduce a declared scenario budget', () => {
  const env={NOQUEUE_REAL_PUSH_LIFECYCLE:'only-my-android',NOQUEUE_PUSH_SCENARIO:'improvements'}
  assert.equal(lifecycleOptions({...env,NOQUEUE_PUSH_MAX_SENDS:'2'}).budget,2)
  for(const value of ['0','-1','2.5','NaN','5',''])assert.throws(()=>lifecycleOptions({...env,NOQUEUE_PUSH_MAX_SENDS:value}))
})
