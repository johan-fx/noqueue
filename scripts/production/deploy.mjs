import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { accountId, readConfig } from './config.mjs'
import { assertReleaseApprovals, assertAppReadiness } from './readiness.mjs'
import { root, verifyRelease } from './release.mjs'
const { values } = parseArgs({ options: {
  release: { type: 'string' }, target: { type: 'string' }, 'confirm-production': { type: 'boolean' },
  'confirm-analytics': { type: 'boolean' }, 'confirm-whatsapp': { type: 'boolean' },
  'confirm-push': { type: 'boolean' }, 'confirm-automation': { type: 'boolean' }, 'confirm-disable-whatsapp': { type: 'boolean' },
  rollback: { type: 'boolean' },
} })
assert.ok(['app', 'landing'].includes(values.target), 'Explicit --target app|landing required')
assert.equal(values['confirm-production'], true, 'Production deployment requires authorization and --confirm-production')
assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, accountId, 'Explicit matching account required')
assert.ok(process.env.CLOUDFLARE_API_TOKEN, 'Explicit authorized deployment token required')
const { directory, profile } = await verifyRelease(values.release, { rollback: values.rollback === true })
// Every enabled feature needs explicit intent, including during rollback.
assertReleaseApprovals(profile, values)
if (values.target === 'app') await assertAppReadiness({ profile, config: await readConfig(),
  token: process.env.CLOUDFLARE_API_TOKEN, confirmDisableWhatsapp: values['confirm-disable-whatsapp'] === true })
const app = values.target === 'app'
// Publish the exact verified compiled bytes, not a rebuild from the current checkout.
const result = spawnSync('pnpm', ['exec', 'wrangler', 'deploy', ...(app ? [resolve(directory, 'api/index.js'), '--no-bundle'] : []),
  '--config', resolve(directory, app ? 'worker.json' : 'landing.json'), ...(app ? ['--env', 'production'] : []), '--env-file', '/dev/null'], {
  cwd: resolve(root, app ? 'apps/api' : 'apps/landing'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'inherit',
})
process.exitCode = result.status ?? 1
