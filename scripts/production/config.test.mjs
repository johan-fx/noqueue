import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { assertProductionConfig, readConfig, repository, productionBuildEnv } from './config.mjs'
const config = await readConfig()
test('initial production config is isolated, GA/WhatsApp off and includes receipt cleanup cron', () => {
  assertProductionConfig(config)
  assert.equal(productionBuildEnv.VITE_ANALYTICS_ENABLED, 'false')
  assert.equal(productionBuildEnv.LANDING_ANALYTICS_ENABLED, 'false')
  assert.equal(productionBuildEnv.VITE_API_URL, '')
  assert.equal(productionBuildEnv.VITE_PUBLIC_APP_ORIGIN, 'https://app.noqueue-app.com')
  if (config.env.production.d1_databases[0].database_id.startsWith('00000000-'))
    assert.throws(() => assertProductionConfig(config, { provisioned: true }), /not provisioned/)
})
for (const [label, change] of [
  ['missing privacy cron', (p) => p.triggers.crons.pop()],
  ['staging database', (p) => p.d1_databases[0].database_id = config.env.staging.d1_databases[0].database_id],
  ['staging origin', (p) => p.vars.PUBLIC_APP_ORIGIN = 'https://staging.noqueue-app.com'],
  ['enabled WhatsApp', (p) => p.vars.WHATSAPP_ENABLED = 'true'],
  ['staging approval', (p) => p.vars.STAGING_CONSENT_APPROVED = 'true'],
  ['E2E entrypoint override', (p) => p.main = 'test/e2e-worker.ts'],
  ['invocation log override', (p) => p.observability = { logs: { invocation_logs: true } }],
  ['preview URL', (p) => p.preview_urls = true],
  ['staging queue', (p) => p.queues.producers[0].queue = 'noqueue-whatsapp-staging'],
]) test(`preflight rejects ${label}`, () => {
  const next = structuredClone(config); change(next.env.production)
  assert.throws(() => assertProductionConfig(next))
})
test('build cache distinguishes API origin and all privacy build inputs', async () => {
  const turbo = JSON.parse(await readFile(new URL('turbo.json', repository), 'utf8'))
  for (const key of Object.keys(productionBuildEnv)) assert.ok(turbo.tasks.build.env.includes(key), key)
})
test('default deploy and unconfirmed bootstrap cannot make remote calls', () => {
  for (const path of ['apps/api/scripts/deploy.mjs', 'apps/api/scripts/bootstrap-production-admin.mjs']) {
    const result = spawnSync(process.execPath, [new URL(path, repository).pathname], { encoding: 'utf8', env: { PATH: process.env.PATH } })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Explicit --env|Requires --apply/)
  }
})
test('artifact fingerprints accept URLs and change with output contents/paths', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const { treeDigest } = await import('./artifacts.mjs')
  const folder = await mkdtemp(join(tmpdir(), 'noqueue-artifact-test-'))
  try {
    await writeFile(join(folder, 'app.js'), 'analytics=false')
    const before = await treeDigest(pathToFileURL(folder))
    assert.equal(before, await treeDigest(folder))
    await writeFile(join(folder, 'app.js'), 'analytics=true')
    assert.notEqual(before, await treeDigest(folder))
    assert.match(await treeDigest(join(folder, 'app.js')), /^[a-f0-9]{64}$/)
  } finally { await rm(folder, { recursive: true, force: true }) }
})
