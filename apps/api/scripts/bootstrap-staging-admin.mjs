// One-time, explicit staging platform-admin bootstrap. Never accepts a password
// through argv or prints it; the generated credential stays in an ignored 0600 file.
import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const accountId = 'fa5fab4df1b0f12c946a3ea47fab96eb'
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const credentialPath = join(apiRoot, '.wrangler', 'staging-platform-admin.json')
const username = 'admin'
const name = 'NoQueue Admin'
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId }

function wrangler(args) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: apiRoot,
    env,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    // Wrangler may include SQL or other private data in errors; do not echo it.
    throw new Error(`Wrangler failed with exit code ${result.status ?? 'unknown'}`)
  }
  return result.stdout
}

const rows = JSON.parse(
  wrangler([
    'd1', 'execute', 'DB', '--remote', '--env', 'staging', '--json',
    '--command', `SELECT COUNT(*) AS n FROM user WHERE username='${username}'`,
  ]),
)
if (rows[0]?.results?.[0]?.n !== 0)
  throw new Error('The admin username already exists in staging')

const password = randomBytes(32).toString('base64url')
const digest = await hashPassword(password)
const id = randomUUID()
const now = new Date().toISOString()
const quote = (value) => `'${value.replaceAll("'", "''")}'`
const sql = `INSERT INTO user(id,name,email,username,displayUsername,emailVerified,createdAt,updatedAt,role,banned) VALUES (${[
  id, name, `${id}@accounts.noqueue.invalid`, username, username,
].map(quote).join(',')},0,${quote(now)},${quote(now)},'platform_admin',0);
INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (${[
  randomUUID(), id, 'credential', id, digest, now, now,
].map(quote).join(',')});`

await mkdir(dirname(credentialPath), { recursive: true })
await writeFile(
  credentialPath,
  JSON.stringify({ accountId, environment: 'staging', username, name, password }, null, 2),
  { flag: 'wx', mode: 0o600 },
)
const folder = await mkdtemp(join(tmpdir(), 'noqueue-staging-admin-'))
try {
  const sqlPath = join(folder, 'bootstrap.sql')
  await writeFile(sqlPath, sql, { mode: 0o600 })
  wrangler(['d1', 'execute', 'DB', '--remote', '--env', 'staging', '--file', sqlPath, '--yes'])
  const verification = JSON.parse(
    wrangler([
      'd1', 'execute', 'DB', '--remote', '--env', 'staging', '--json',
      '--command', `SELECT u.role,COUNT(a.id) AS accounts FROM user u LEFT JOIN account a ON a.userId=u.id AND a.providerId='credential' WHERE u.username='${username}' GROUP BY u.id`,
    ]),
  )
  const row = verification[0]?.results?.[0]
  if (row?.role !== 'platform_admin' || row.accounts !== 1)
    throw new Error('Staging admin verification failed')
  console.log(`Staging platform admin created; credential stored at ${credentialPath}`)
} finally {
  await rm(folder, { recursive: true, force: true })
}
