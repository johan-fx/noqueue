// Explicit local-only bootstrap. Password is read from stdin, never command arguments.
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const [username, name, role = 'commercial_operator', ...extra] =
  process.argv.slice(2)
if (
  !username ||
  !name ||
  extra.length ||
  !/^[a-z0-9_.]{3,30}$/.test(username) ||
  !['commercial_operator', 'platform_admin'].includes(role)
) {
  console.error(
    'Usage (LOCAL ONLY): pnpm auth:bootstrap username name [commercial_operator|platform_admin]',
  )
  process.exit(1)
}
if (process.stdin.isTTY) {
  console.error(
    'Pipe the password through stdin using a secure local secret source (15–128 characters).',
  )
  process.exit(1)
}
let password = ''
for await (const chunk of process.stdin) {
  password += chunk
  if (password.length > 130) process.exit(1)
}
password = password.replace(/\r?\n$/, '')
if (password.length < 15 || password.length > 128) {
  console.error('Invalid password length')
  process.exit(1)
}
const digest = await hashPassword(password)
password = ''
const id = randomUUID()
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`
const now = new Date().toISOString(),
  folder = await mkdtemp(join(tmpdir(), 'noqueue-bootstrap-')),
  file = join(folder, 'bootstrap.sql')
try {
  await writeFile(
    file,
    `INSERT INTO user(id,name,email,username,displayUsername,emailVerified,createdAt,updatedAt,role,banned) VALUES (${[id, name, `${id}@accounts.noqueue.invalid`, username, username].map(sqlString).join(',')},0,${sqlString(now)},${sqlString(now)},${sqlString(role)},0);
INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (${[randomUUID(), id, 'credential', id, digest, now, now].map(sqlString).join(',')});`,
    { mode: 0o600 },
  )
  const result = spawnSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--file', file],
    { stdio: 'inherit' },
  )
  process.exitCode = result.status ?? 1
} finally {
  await rm(folder, { recursive: true, force: true })
}
