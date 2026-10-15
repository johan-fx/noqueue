// Staging-only operator command. No Worker/HTTP maintenance endpoint is exposed.
// node scripts/reclassify-historical-metrics.mjs /absolute/manifest.json [--apply]
// Manifest: { venueId, entryIds, capturedSince }. Default is a read-only plan.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getPlatformProxy } from 'wrangler'

const args = process.argv.slice(2)
if (!args[0] || args.length > 2 || (args[1] && args[1] !== '--apply'))
  throw new Error(
    'Usage: node reclassify-historical-metrics.mjs manifest.json [--apply]'
  )
const manifest = JSON.parse(await fs.readFile(args[0], 'utf8'))
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'noqueue-metrics-repair-'))
const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('wrangler'))('esbuild')
let proxy
try {
  const configPath = path.join(temp, 'wrangler.json')
  await fs.writeFile(
    configPath,
    JSON.stringify({
      name: 'noqueue-api-staging',
      account_id: 'fa5fab4df1b0f12c946a3ea47fab96eb',
      compatibility_date: '2026-09-10',
      vars: { APP_ENV: 'staging' },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'noqueue-staging',
          database_id: '73a50d85-e53f-4a54-b164-07b80a39d1a8',
          remote: true,
        },
      ],
    })
  )
  const outfile = path.join(temp, 'repair.mjs')
  await build({
    entryPoints: [
      path.join(root, 'src/features/metrics/repair-historical-service.ts'),
    ],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const { repairHistoricalService } = await import(pathToFileURL(outfile).href)
  proxy = await getPlatformProxy({
    configPath,
    remoteBindings: true,
    persist: false,
    envFiles: [],
  })
  console.log(
    JSON.stringify(
      await repairHistoricalService(proxy.env, {
        venueId: manifest.venueId,
        entryIds: manifest.entryIds,
        capturedSince: manifest.capturedSince,
        apply: args[1] === '--apply',
      })
    )
  )
} finally {
  await proxy?.dispose()
  await fs.rm(temp, { recursive: true, force: true })
}
