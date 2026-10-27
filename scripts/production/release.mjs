import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repository, readConfig, releaseProfile, withReleaseProfile, buildEnvironment, assertProductionConfig, assertLandingConfig } from './config.mjs'
import { treeDigest, sourcePaths } from './artifacts.mjs'
import { migrationPlan } from './migrations.mjs'
export const root = fileURLToPath(repository)
export const releasesRoot = resolve(root, 'queue-reports/production/releases')
export function releaseDirectory(id) {
  assert.match(id ?? '', /^[a-z0-9][a-z0-9-]{5,95}$/, 'Expected a release ID, not a path')
  return resolve(releasesRoot, id)
}
export function wranglerConfigs(api, landing, profile, directory) {
  const worker = withReleaseProfile(api, profile)
  assertProductionConfig(worker, { ...profile, provisioned: true })
  assertLandingConfig(landing)
  // This binding is installed as a secret during cutover, never an empty var override.
  delete worker.env.production.vars.D360DIALOG_PHONE_NUMBER_ID
  worker.main = resolve(root, 'apps/api', worker.main)
  // Wrangler resolves file aliases relative to the copied config, not main.
  // Rebase only relative files; package and node: aliases keep their semantics.
  if (worker.alias) worker.alias = Object.fromEntries(Object.entries(worker.alias).map(([name, target]) => [
    name, target.startsWith('./') || target.startsWith('../') ? resolve(root, 'apps/api', target) : target,
  ]))
  worker.assets.directory = resolve(directory, 'web')
  for (const env of [worker, ...Object.values(worker.env)])
    for (const db of env.d1_databases ?? []) db.migrations_dir = resolve(root, 'apps/api', db.migrations_dir)
  const site = structuredClone(landing)
  site.assets.directory = resolve(directory, 'landing')
  return { worker, landing: site }
}
export async function verifyRelease(id, { rollback = false } = {}) {
  const directory = releaseDirectory(id)
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'))
  assert.ok(['noqueue-production-release-v2', 'noqueue-production-release-v3'].includes(manifest.format))
  if (manifest.format === 'noqueue-production-release-v3') assert.deepEqual(manifest.migrations, migrationPlan(), 'Migration inventory changed; rebuild release')
  assert.equal(manifest.id, id)
  const profile = releaseProfile(manifest.profile)
  assert.deepEqual(manifest.profile, profile)
  assert.deepEqual(manifest.buildEnv, buildEnvironment(profile))
  const trackedSources = manifest.format === 'noqueue-production-release-v2' && !('apps/api/migrations' in manifest.sources)
    ? sourcePaths.filter(path => path !== 'apps/api/migrations') : sourcePaths
  assert.deepEqual(Object.keys(manifest.sources).sort(), [...trackedSources].sort())
  if (!rollback) for (const path of trackedSources)
    assert.equal(await treeDigest(resolve(root, path)), manifest.sources[path], `Source changed: ${path}; rebuild release`)
  const artifacts = ['web', 'landing', 'api', 'worker.json', 'landing.json']
  assert.deepEqual(Object.keys(manifest.digests).sort(), artifacts.sort())
  for (const path of artifacts)
    assert.equal(await treeDigest(resolve(directory, path)), manifest.digests[path], `Release artifact changed: ${path}`)
  const configs = wranglerConfigs(await readConfig(), JSON.parse(await readFile(resolve(root, 'apps/landing/wrangler.jsonc'), 'utf8')), profile, directory)
  assert.deepEqual(JSON.parse(await readFile(resolve(directory, 'worker.json'), 'utf8')), configs.worker)
  assert.deepEqual(JSON.parse(await readFile(resolve(directory, 'landing.json'), 'utf8')), configs.landing)
  return { directory, manifest, profile }
}
