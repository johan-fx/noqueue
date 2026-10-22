import assert from 'node:assert/strict'
import { localPushOptions } from './local-push-options.mjs'

export const scenarios = Object.freeze({
  normal: { approaching: 1, called: 1 },
  extensions: { approaching: 4, delayed: 3, called: 1 },
  improvements: { approaching: 1, improved: 2, called: 1 },
  yield: { approaching: 2, delayed: 1, called: 2 },
  expiry: { called: 1, expired: 1 },
  cancellation: { cancelled: 1 },
  closure: { service_ended: 1 },
})
export function lifecycleOptions(env) {
  assert.ok(Object.hasOwn(scenarios, env.NOQUEUE_PUSH_SCENARIO ?? ''), 'An explicit bounded lifecycle scenario is required')
  const options = localPushOptions({ ...env, NOQUEUE_REAL_PUSH_SMOKE: env.NOQUEUE_REAL_PUSH_LIFECYCLE })
  const maximum = Object.values(scenarios[env.NOQUEUE_PUSH_SCENARIO]).reduce((a,b)=>a+b,0)
  const budget = env.NOQUEUE_PUSH_MAX_SENDS === undefined ? maximum : Number(env.NOQUEUE_PUSH_MAX_SENDS)
  assert.ok(Number.isInteger(budget) && budget >= 1 && budget <= maximum, 'The run budget may only tighten the scenario maximum')
  // Dedicated Android lifecycle ports leave the existing single-call/local app
  // fixture on 8790/8791 untouched.
  return { ...options, ...(options.platform === 'android' ? { apiPort: 8792, controlPort: 8793 } : {}), reportPath: `reports/${options.platform}-device/push-lifecycle`,
    scenario: env.NOQUEUE_PUSH_SCENARIO, budget, limits: scenarios[env.NOQUEUE_PUSH_SCENARIO] }
}

/** A real short service window for closure tests; never modifies an existing turn. */
export function lifecycleWindow(scenario, now = new Date()) {
  if (scenario !== 'closure') return { twentyFourHours: true, schedules: [], windowId: `continuous:${JSON.stringify(['Europe/Madrid','restaurant',true,0,[]])}` }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type,p.value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`, end = Number(parts.hour)*60+Number(parts.minute)+8
  assert.ok(end<1440, 'Start the closure scenario at least eight minutes before local midnight')
  const to = `${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`
  const schedules = [{ day: new Date(`${date}T00:00:00Z`).getUTCDay(), from: '00:00', to }]
  return { twentyFourHours: false, schedules, windowId: `${date}:00:00:${to}:${JSON.stringify(['Europe/Madrid','restaurant',false,0,schedules])}` }
}
