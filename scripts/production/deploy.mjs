import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { accountId } from './config.mjs'
import { root, verifyRelease } from './release.mjs'
const { values } = parseArgs({ options: {
  release: { type: 'string' }, target: { type: 'string' }, 'confirm-production': { type: 'boolean' },
  'confirm-analytics': { type: 'boolean' }, 'confirm-whatsapp': { type: 'boolean' },
  rollback: { type: 'boolean' },
} })
assert.ok(['app', 'landing'].includes(values.target), 'Explicit --target app|landing required')
assert.equal(values['confirm-production'], true, 'Production deployment requires authorization and --confirm-production')
assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, accountId, 'Explicit matching account required')
assert.ok(process.env.CLOUDFLARE_API_TOKEN, 'Explicit authorized deployment token required')
const { directory, profile } = await verifyRelease(values.release, { rollback: values.rollback === true })
// Rollback is per-feature: preserving a healthy feature still requires its explicit approval.
const analyticsOn = values.target === 'landing' ? profile.analytics !== 'off' : profile.analytics === 'both'
if (analyticsOn) assert.equal(values['confirm-analytics'], true, 'Real-Google audit and operator analytics approval required')
if (values.target === 'app' && profile.whatsapp === 'on') {
  assert.equal(values['confirm-whatsapp'], true, 'Approved templates and exclusive channel cutover must be verified before enabling WhatsApp')
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/noqueue-api-production/secrets`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  assert.equal(response.ok, true, 'Cannot verify production channel secret metadata')
  const body = await response.json()
  assert.equal(body.success, true, 'Cannot verify production channel secret metadata')
  for (const name of ['D360DIALOG_API_KEY', 'D360DIALOG_PHONE_NUMBER_ID', 'D360DIALOG_WEBHOOK_TOKEN'])
    assert.ok(body.result.some((secret) => secret.name === name), 'Missing production channel secret: ' + name)
}
const app = values.target === 'app'
// Publish the exact verified compiled bytes, not a rebuild from the current checkout.
const result = spawnSync('pnpm', ['exec', 'wrangler', 'deploy', ...(app ? [resolve(directory, 'api/index.js'), '--no-bundle'] : []),
  '--config', resolve(directory, app ? 'worker.json' : 'landing.json'), ...(app ? ['--env', 'production'] : []), '--env-file', '/dev/null'], {
  cwd: resolve(root, app ? 'apps/api' : 'apps/landing'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'inherit',
})
process.exitCode = result.status ?? 1
