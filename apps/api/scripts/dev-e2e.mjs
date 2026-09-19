import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const port = process.env.NOQUEUE_E2E_PORT ?? '8787'
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error('Invalid NOQUEUE_E2E_PORT')
const directory = path.join(root, '.wrangler', 'e2e')
await rm(directory, { recursive: true, force: true })
await mkdir(directory, { recursive: true })
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
const args = [
  '--config',
  configPath,
  '--persist-to',
  path.join(directory, 'state'),
]
function run(commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'wrangler', ...commandArgs], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' },
    })
    const stop = () => child.kill('SIGTERM')
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    child.once('exit', (code) => {
      process.off('SIGTERM', stop)
      process.off('SIGINT', stop)
      code === 0
        ? resolve()
        : reject(new Error(`Local test worker exited (${code})`))
    })
  })
}
await run(['d1', 'migrations', 'apply', 'DB', '--local', ...args])
await run(['dev', '--local', '--port', port, '--inspector-port', '0', ...args])
