// Intentional guard for pnpm deploy. Direct Wrangler remains an operator-only escape hatch.
import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertProductionConfig, readConfig, repository, productionBuildEnv } from '../../../scripts/production/config.mjs'
import { treeDigest, sourcePaths } from '../../../scripts/production/artifacts.mjs'
import { initialSecretsFile } from '../../../scripts/production/secrets.mjs'
const { values } = parseArgs({ options: { env: { type: 'string' }, 'confirm-production': { type: 'boolean' }, 'secrets-file': { type: 'string' } } })
assert.ok(['sandbox', 'staging', 'production'].includes(values.env), 'Explicit --env sandbox|staging|production required; default/local deployment forbidden')
let secretsPath
if (values['secrets-file']) {
  assert.equal(values.env, 'production', 'This secrets option is reserved for the initial production release')
  secretsPath = await initialSecretsFile(values['secrets-file'])
}
if (values.env === 'production') {
  assert.equal(values['confirm-production'], true, 'Production deployment requires separate authorization and --confirm-production')
  const config = await readConfig()
  assertProductionConfig(config, { provisioned: true })
  assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, config.account_id, 'Explicit account required')
  assert.ok(process.env.CLOUDFLARE_API_TOKEN, 'Explicit authorized deployment token required')
  const manifest = JSON.parse(await readFile(new URL('queue-reports/production/manifest.json', repository), 'utf8'))
  assert.notEqual(manifest.format, 'noqueue-production-release-v2', 'Use pnpm production:deploy --target app --release ID --confirm-production for immutable releases')
  assert.equal(manifest.analytics, false)
  assert.deepEqual(manifest.buildEnv, productionBuildEnv)
  for (const path of sourcePaths)
    assert.equal(await treeDigest(new URL(path, repository)), manifest.sources[path], 'Worker source/configuration changed; rebuild before deploying')
  for (const path of ['apps/web/dist', 'apps/landing/dist', 'apps/api/dist/production'])
    assert.equal(await treeDigest(new URL(path, repository)), manifest.digests[path], 'Artifact changed since production:build; rebuild before deploying')
}
const result = spawnSync('pnpm', ['exec', 'wrangler', 'deploy', '--minify', '--env', values.env, '--env-file', '/dev/null', ...(secretsPath ? ['--secrets-file', secretsPath] : [])], {
  cwd: fileURLToPath(new URL('apps/api/', repository)), env: process.env, stdio: 'inherit',
})
process.exitCode = result.status ?? 1
