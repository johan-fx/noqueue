import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { createTestHarness } from 'wrangler'
import { createWorkerServer, routeWorkerRequest } from './http-worker.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const port = process.env.NOQUEUE_E2E_PORT ?? '8787'
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error('Invalid NOQUEUE_E2E_PORT')
const parent = path.join(root, '.wrangler', 'e2e-runs')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(path.join(parent, 'run-'))
console.log('Isolated E2E state: ' + directory)
const config = JSON.parse(
  await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'),
)
delete config.env
delete config.triggers
config.name = 'noqueue-e2e-local-only'
config.main = path.join(root, 'test/e2e-worker.ts')
config.assets.directory = path.resolve(root, config.assets.directory)
config.d1_databases[0].migrations_dir = path.join(root, 'migrations')
config.vars = {
  ...config.vars,
  PUBLIC_APP_ORIGIN: `http://127.0.0.1:${port}`,
  BETTER_AUTH_SECRET: 'e2e-only-auth-secret-at-least-32-characters',
  AUTH_EMAIL_API_KEY: 'e2e-only-mail-key',
  GEOAPIFY_API_KEY: 'e2e-only-geocode-key',
  AUTH_EMAIL_FROM: 'test@example.com',
  WHATSAPP_ENABLED: 'true',
  CONFIRMATION_EXPERIMENT_ENABLED: 'true',
  D360DIALOG_API_KEY: 'test-only-key',
  D360DIALOG_WEBHOOK_TOKEN: 'test-webhook-token-at-least-32-characters',
  PII_ENCRYPTION_KEY: '11'.repeat(32),
  PHONE_HASH_KEY: '22'.repeat(32),
  RECOVERY_TOKEN_KEY: '33'.repeat(32),
  PILOT_ACCESS_TOKEN: 'test-pilot-access-at-least-32-characters',
  WHATSAPP_RECIPIENT_ALLOWLIST:
    '+34600000000,+34600000001,+34600000002,+34600000003,+34600000004,+34600000005',
}
const configPath = path.join(directory, 'wrangler.json')
await writeFile(configPath, JSON.stringify(config))
// Keep the real Worker/assets/bindings, but avoid Wrangler's pooled HTTP
// ProxyWorker hop (workers-sdk#14641). It can lose a POST around an idle close.
// getWorker().fetch dispatches to the runtime directly; no mutation is retried.
// createTestHarness allocates ephemeral storage and never loads a named env.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
const harness = createTestHarness({ root, workers: [{ configPath }] })
let server
let closing = false
async function close() {
  if (closing) return
  closing = true
  server?.closeAllConnections()
  if (server) await new Promise((resolve) => server.close(resolve))
  await harness.close()
}
process.once('SIGTERM', () => void close())
process.once('SIGINT', () => void close())
try {
  await harness.listen()
  const worker = harness.getWorker()
  await worker.applyD1Migrations('DB')
  const { ASSETS } = await worker.getEnv()
  server = createWorkerServer(
    routeWorkerRequest(config.assets.run_worker_first, worker, ASSETS),
    config.vars.PUBLIC_APP_ORIGIN,
  )
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(port), '127.0.0.1', resolve)
  })
  console.log(`Isolated E2E worker ready: ${config.vars.PUBLIC_APP_ORIGIN}`)
} catch (error) {
  await close()
  throw error
}
