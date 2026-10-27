import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
export async function treeDigest(root) {
  if (root instanceof URL) root = fileURLToPath(root)
  const hash = createHash('sha256')
  async function walk(folder, relative = '') {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name), name = `${relative}${entry.name}`
      if (entry.isDirectory()) await walk(path, `${name}/`)
      else if (entry.isFile()) { hash.update(name + '\0'); hash.update(await readFile(path)); hash.update('\0') }
      else throw new Error('Unexpected artifact symlink')
    }
  }
  if ((await stat(root)).isFile()) hash.update(await readFile(root))
  else await walk(root)
  return hash.digest('hex')
}

export const sourcePaths = ['apps/api/src', 'apps/api/migrations', 'apps/api/wrangler.jsonc', 'apps/api/scripts',
  'apps/web/src', 'apps/web/index.html', 'apps/web/vite.config.ts', 'apps/web/package.json',
  'apps/landing/src', 'apps/landing/scripts', 'apps/landing/wrangler.jsonc', 'apps/landing/package.json',
  'packages/privacy/src', 'packages/privacy/package.json', 'packages/contracts/src', 'scripts/production', 'pnpm-lock.yaml', 'turbo.json']
