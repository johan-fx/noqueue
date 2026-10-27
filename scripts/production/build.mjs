// Immutable local release snapshots. Never publishes or contacts analytics/messaging providers.
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { randomBytes } from 'node:crypto'
import { readConfig, resolveBuildProfile, buildEnvironment } from './config.mjs'
import { root, releaseDirectory, wranglerConfigs } from './release.mjs'
import { treeDigest, sourcePaths } from './artifacts.mjs'
import { migrationPlan } from './migrations.mjs'
const { values } = parseArgs({ options: { profile: { type: 'string' }, analytics: { type: 'string' }, whatsapp: { type: 'string' }, push: { type: 'string' }, automation: { type: 'string' } } })
const profile = resolveBuildProfile(values)
const config = await readConfig()
const id = `${new Date().toISOString().replace(/[^0-9]/g, '')}-${profile.analytics}-wa-${profile.whatsapp}-${randomBytes(3).toString('hex')}`
const directory = releaseDirectory(id)
const configs = wranglerConfigs(config, JSON.parse(await readFile(resolve(root, 'apps/landing/wrangler.jsonc'), 'utf8')), profile, directory)
await mkdir(resolve(root, 'queue-reports/production/releases'), { recursive: true })
await mkdir(directory) // Never overwrite an earlier rollback artifact.
await rm(resolve(root, 'queue-reports/production/manifest.json'), { force: true })
const buildEnv = buildEnvironment(profile)
const env = { ...process.env, ...buildEnv, CLOUDFLARE_ACCOUNT_ID: config.account_id, WRANGLER_SEND_METRICS: 'false' }
function run(args) {
  const result = spawnSync('pnpm', args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(['--filter', '@noqueue/web', 'build'])
run(['--filter', '@noqueue/landing', 'build'])
await cp(resolve(root, 'apps/web/dist'), resolve(directory, 'web'), { recursive: true })
await cp(resolve(root, 'apps/landing/dist'), resolve(directory, 'landing'), { recursive: true })
for (const [name, value] of Object.entries(configs))
  await writeFile(resolve(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
run(['--filter', '@noqueue/api', 'exec', 'wrangler', 'deploy', '--config', resolve(directory, 'worker.json'), '--env', 'production', '--env-file', '/dev/null', '--dry-run', '--minify', '--outdir', resolve(directory, 'api')])
const digests = {}, sources = {}
for (const path of ['web', 'landing', 'api', 'worker.json', 'landing.json']) digests[path] = await treeDigest(resolve(directory, path))
for (const path of sourcePaths) sources[path] = await treeDigest(resolve(root, path))
const manifest = { format: 'noqueue-production-release-v3', id, environment: 'production', profile, analytics: profile.analytics !== 'off', buildEnv, digests, sources, migrations: migrationPlan() }
await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
// Compatibility pointer for working-dist OFF tests. Deployment always takes an explicit release ID.
await writeFile(resolve(root, 'queue-reports/production/manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ release: id, profile, directory, published: false }))
