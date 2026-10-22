// Local operator controls. Never accepts a recipient token or arbitrary endpoint.
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const platform = process.env.NOQUEUE_REAL_PUSH_SMOKE === 'only-my-android' ? 'android' : 'ios'
const controlPort = platform === 'android' ? 8791 : 8789
const [action, code] = process.argv.slice(2)
assert.ok(['evidence', 'call-once', 'disarm', 'shutdown'].includes(action))
assert.ok(action === 'call-once' ? /^[A-Z0-9]{6}$/.test(code ?? '') : code === undefined)
const file = new URL(`../../../reports/${platform}-device/push-real/control.json`, import.meta.url)
const control = JSON.parse(await readFile(file, 'utf8'))
assert.equal(control.port, controlPort)
const response = await fetch(`http://127.0.0.1:${controlPort}/${action}`, {
  headers: { Authorization: `Bearer ${control.token}`, 'Content-Type': 'application/json' },
  ...(action === 'evidence' ? {} : { method: 'POST', body: JSON.stringify({ ...(code ? { code } : {}) }) }),
  redirect: 'error', signal: AbortSignal.timeout(15000),
})
const value = await response.json()
assert.ok(response.ok, `Local control rejected: ${response.status}`)
if (action === 'evidence') await writeFile(new URL(`../../../reports/${platform}-device/push-real/progress.json`, import.meta.url), JSON.stringify(value, null, 2), { mode: 0o600 })
console.log(JSON.stringify(value, null, 2))
