// Local operator controls. Never accepts a recipient token or arbitrary endpoint.
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const platform = process.env.NOQUEUE_REAL_PUSH_LIFECYCLE === 'only-my-android' ? 'android' : 'ios'
const controlPort = platform === 'android' ? 8793 : 8789
const [action, value, minutes] = process.argv.slice(2)
assert.ok(['evidence', 'arm', 'step', 'disarm', 'shutdown'].includes(action))
assert.ok(action === 'arm' ? /^[A-Z0-9]{6}$/.test(value ?? '') : action === 'step' ? ['call','complete','cancel','refresh','average','companion'].includes(value) : value === undefined)
const file = new URL(`../../../reports/${platform}-device/push-lifecycle/control.json`, import.meta.url)
const control = JSON.parse(await readFile(file, 'utf8'))
assert.equal(control.port, controlPort)
const response = await fetch(`http://127.0.0.1:${controlPort}/${action}`, {
  headers: { Authorization: `Bearer ${control.token}`, 'Content-Type': 'application/json' },
  ...(action === 'evidence' ? {} : { method: 'POST', body: JSON.stringify(action === 'arm' ? { code: value } : action === 'step' ? { action: value, ...(minutes ? { minutes: Number(minutes) } : {}) } : {}) }),
  redirect: 'error', signal: AbortSignal.timeout(15000),
})
const result = await response.json()
assert.ok(response.ok, `Local control rejected: ${response.status}`)
if (action === 'evidence') await writeFile(new URL(`../../../reports/${platform}-device/push-lifecycle/progress.json`, import.meta.url), JSON.stringify(result, null, 2), { mode: 0o600 })
console.log(JSON.stringify(result, null, 2))
