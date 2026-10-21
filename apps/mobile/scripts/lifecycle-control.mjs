import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { request } from 'node:https'
// Node-only test controller. Never copied into native assets or sent to WebViews.
export async function lifecycleControl(action) {
  const { token } = JSON.parse(await readFile(new URL('../../../reports/android-local/lifecycle-control.json', import.meta.url), 'utf8'))
  const ca = await readFile(new URL('../../../reports/android-local/tls/res/raw/noqueue_local_ca.pem', import.meta.url))
  const result = await new Promise((resolve, reject) => {
    const req = request(`https://127.0.0.1:8788/__local/lifecycle/${action}`, {
      ca, method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }, response => {
      let body = ''
      response.setEncoding('utf8').on('data', part => { body += part })
      response.on('end', () => {
        try { assert.equal(response.statusCode, 200, `Local lifecycle ${action}`); resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('Lifecycle control timeout')))
    req.end()
  })
  if (action === 'expire' && result.waitMs > 0) {
    assert.ok(result.waitMs < 125000, 'Fixture grace must be two real minutes')
    await new Promise(resolve => setTimeout(resolve, result.waitMs))
    return lifecycleControl('expire')
  }
  return result
}
