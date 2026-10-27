import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { readConfig, releaseProfile, buildEnvironment, withReleaseProfile, assertProductionConfig, assertProductionIdentity, assertLandingConfig } from './config.mjs'
import { root, releaseDirectory, wranglerConfigs, verifyRelease } from './release.mjs'
import { sourcePaths, treeDigest } from './artifacts.mjs'
import { migrationPlan } from './migrations.mjs'
const config = await readConfig()
const landing = JSON.parse(await readFile(resolve(root, 'apps/landing/wrangler.jsonc'), 'utf8'))
for (const analytics of ['off', 'landing', 'both']) for (const whatsapp of ['off', 'on']) {
  test(`isolated release ${analytics}/${whatsapp} preserves resource identity and backup validation`, () => {
    const profile = releaseProfile({ analytics, whatsapp }), next = withReleaseProfile(config, profile), env = buildEnvironment(profile)
    assertProductionConfig(next, { whatsapp })
    assertProductionIdentity(next, { provisioned: true })
    assert.equal(config.env.production.vars.WHATSAPP_ENABLED, 'false')
    assert.equal(env.LANDING_ANALYTICS_ENABLED, String(analytics !== 'off'))
    assert.equal(env.VITE_ANALYTICS_ENABLED, String(analytics === 'both'))
    assert.equal(env.VITE_GA4_MEASUREMENT_ID, analytics === 'both' ? 'G-S905ERLNN9' : '')
    assert.equal(env.LANDING_GA4_MEASUREMENT_ID, analytics !== 'off' ? 'G-QEVCK0TBCF' : '')
    assert.equal(env.VITE_API_URL, '')
    assert.equal(env.VITE_PUBLIC_APP_ORIGIN, 'https://app.noqueue-app.com')
    assert.deepEqual(next.env.staging, config.env.staging)
    const generated = wranglerConfigs(config, landing, profile, '/tmp/noqueue-release-test')
    assert.equal(generated.worker.assets.directory, '/tmp/noqueue-release-test/web')
    assert.equal(generated.landing.assets.directory, '/tmp/noqueue-release-test/landing')
    assert.equal(generated.worker.env.production.vars.WHATSAPP_ENABLED, String(whatsapp === 'on'))
    assert.equal('D360DIALOG_PHONE_NUMBER_ID' in generated.worker.env.production.vars, false)
  })
}
test('profiles default OFF and reject ambiguous enablement or path input', () => {
  assert.deepEqual(releaseProfile(), { analytics: 'off', whatsapp: 'off' })
  for (const analytics of ['true', 'app', 'staging', '']) assert.throws(() => releaseProfile({ analytics }))
  for (const whatsapp of ['true', '', 'staging']) assert.throws(() => releaseProfile({ whatsapp }))
  for (const id of ['', '../valid-release', '/tmp/release', 'x/../../release']) assert.throws(() => releaseDirectory(id))
})
test('relocated Worker config rebases file aliases without changing package aliases or source config', async () => {
  const source = structuredClone(config)
  source.alias = {
    ...source.alias,
    'parent-file': '../shared/runtime.ts',
    'absolute-file': resolve(root, 'apps/api/src/auth/async-hooks.workerd.ts'),
    'package-alias': 'replacement-package',
    'builtin-alias': 'node:async_hooks',
  }
  const before = structuredClone(source)
  const { worker } = wranglerConfigs(source, landing, releaseProfile(), '/tmp/noqueue-relocated-release')
  const authAlias = worker.alias['@better-auth/core/async_hooks']
  assert.equal(authAlias, resolve(root, 'apps/api/src/auth/async-hooks.workerd.ts'))
  assert.ok((await stat(authAlias)).isFile())
  assert.equal(worker.alias['parent-file'], resolve(root, 'apps/shared/runtime.ts'))
  assert.equal(worker.alias['absolute-file'], source.alias['absolute-file'])
  assert.equal(worker.alias['package-alias'], 'replacement-package')
  assert.equal(worker.alias['builtin-alias'], 'node:async_hooks')
  assert.deepEqual(source, before)
})
test('landing guard rejects domain, account, preview and executable-code drift', () => {
  assertLandingConfig(landing)
  for (const change of [{ workers_dev: true }, { preview_urls: true }, { name: 'other' }, { account_id: 'other' }, { main: 'unreviewed.js' }, { routes: [] }])
    assert.throws(() => assertLandingConfig({ ...landing, ...change }))
})
test('deployment fails before provider calls without explicit target/authorization/account', () => {
  for (const args of [[], ['--target', 'app'], ['--target', 'landing', '--confirm-production']]) {
    const result = spawnSync(process.execPath, ['scripts/production/deploy.mjs', ...args], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Explicit --target|authorization|matching account/)
  }
})
test('source fingerprints include frontend/privacy/build/deploy inputs and no dependency trees', async () => {
  for (const path of sourcePaths) assert.ok((await stat(resolve(root, path))).isFile() || (await stat(resolve(root, path))).isDirectory())
  for (const path of ['apps/web/src', 'apps/landing/scripts', 'packages/privacy/src', 'scripts/production']) assert.ok(sourcePaths.includes(path))
  assert.equal(sourcePaths.some((path) => path.includes('node_modules')), false)
})

for (const format of ['noqueue-production-release-v2', 'noqueue-production-release-v3']) test(`${format} verification rejects source/artifact/migration drift`, async () => {
  const id = 'test-release-' + process.pid + '-' + format.at(-1)
  const directory = releaseDirectory(id)
  const profile = releaseProfile({ analytics: 'both', whatsapp: 'off' })
  await mkdir(directory, { recursive: true })
  try {
    for (const path of ['web', 'landing', 'api']) {
      await mkdir(resolve(directory, path))
      await writeFile(resolve(directory, path, 'fixture.txt'), 'synthetic artifact')
    }
    const configs = wranglerConfigs(config, landing, profile, directory)
    for (const [name, value] of Object.entries(configs)) await writeFile(resolve(directory, name + '.json'), JSON.stringify(value))
    const sources = {}, digests = {}
    for (const path of sourcePaths) sources[path] = await treeDigest(resolve(root, path))
    for (const path of ['web', 'landing', 'api', 'worker.json', 'landing.json']) digests[path] = await treeDigest(resolve(directory, path))
    if (format.endsWith('v2')) delete sources['apps/api/migrations'] // historical manifests lack this source
    const manifest = { format, id, profile, buildEnv: buildEnvironment(profile), sources, digests, ...(format.endsWith('v3') ? { migrations: migrationPlan() } : {}) }
    const save = () => writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest))
    await save()
    assert.deepEqual((await verifyRelease(id)).profile, profile)
    if (manifest.migrations) {
      manifest.migrations.pending[0].sha256 = 'tampered'
      await save()
      await assert.rejects(verifyRelease(id, { rollback: true }), /Migration inventory changed/)
      manifest.migrations = migrationPlan()
    }
    manifest.sources['apps/web/src'] = 'old-source-hash'
    await save()
    await assert.rejects(verifyRelease(id), /Source changed/)
    assert.deepEqual((await verifyRelease(id, { rollback: true })).profile, profile)
    await writeFile(resolve(directory, 'web/fixture.txt'), 'tampered artifact')
    await assert.rejects(verifyRelease(id, { rollback: true }), /Release artifact changed/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
