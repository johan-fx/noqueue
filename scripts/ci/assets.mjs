import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { treeDigest } from '../production/artifacts.mjs'

const paths = { general: ['apps/web/dist'], production: ['queue-reports/production'] }
export async function assetManifest(profile, revision, digest = treeDigest) {
  if (!paths[profile]) throw new Error('Unknown asset profile')
  return { format: 'ci-assets-v1', profile, revision,
    digests: Object.fromEntries(await Promise.all(paths[profile].map(async (path) => [path, await digest(path)]))) }
}
export function verifyAssets(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('CI assets changed or belong to another commit/profile')
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  const [mode, profile] = process.argv.slice(2)
  if (!['write', 'verify'].includes(mode)) throw new Error('Use assets.mjs write|verify general|production')
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const actual = await assetManifest(profile, revision)
  const file = `queue-reports/ci/${profile}-build.json`
  if (mode === 'write') {
    await mkdir('queue-reports/ci', { recursive: true })
    await writeFile(file, JSON.stringify(actual, null, 2))
  } else verifyAssets(JSON.parse(await readFile(file, 'utf8')), actual)
}
