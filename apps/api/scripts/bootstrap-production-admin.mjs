// Remote execution is opt-in and requires an explicitly supplied token/account/database.
// Password input is stdin only; SQL stays in memory, never in argv or CLI logs.
import { hashPassword } from 'better-auth/crypto'
import { readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { initialAdminStatements } from './production-initialization.mjs'
import { productionD1 } from './production-d1.mjs'
import { readConfig, assertProductionConfig } from '../../../scripts/production/config.mjs'

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean' }, 'confirm-empty-production': { type: 'boolean' },
    'database-id': { type: 'string' }, username: { type: 'string' }, name: { type: 'string' },
  } })
  if (!values.apply || !values['confirm-empty-production'])
    throw new Error('Requires --apply --confirm-empty-production --database-id UUID --username NAME --name LABEL; password via stdin only')
  const config = await readConfig()
  assertProductionConfig(config, { provisioned: true })
  if (values['database-id'] !== config.env.production.d1_databases[0].database_id ||
      process.env.CLOUDFLARE_ACCOUNT_ID !== config.account_id || !process.env.CLOUDFLARE_API_TOKEN)
    throw new Error('Explicit production database/account/API token required')
  if (!values.username || !/^[a-z0-9_.]{3,30}$/.test(values.username) || !values.name?.trim() || values.name.length > 120)
    throw new Error('Invalid username/name')
  const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const execute = productionD1({ accountId: config.account_id, databaseId: values['database-id'], token: process.env.CLOUDFLARE_API_TOKEN })
  let statements
  try {
    // Existing exact administrator is a no-op, never a password reset or role upgrade.
    const preliminary = initialAdminStatements({ username: values.username, name: values.name, passwordHash: 'unused', tables: ['user', 'account', 'privacy_consent_receipt', 'metrics_control'] })
    const existing = (await execute(preliminary.verify))[0]?.results ?? []
    if (existing.length) {
      if (existing.length !== 1 || existing[0].role !== 'platform_admin' || existing[0].banned !== 0 || existing[0].credentials !== 1)
        throw new Error('Existing account is not the expected administrator; no changes made')
      console.log('Administrator already exists; credentials unchanged.')
      return
    }
    const applied = (await execute('SELECT name FROM d1_migrations'))[0]?.results
    const expected = (await readdir(join(apiRoot, 'migrations'))).filter((file) => file.endsWith('.sql')).sort()
    if (!Array.isArray(applied) || expected.some((name) => !applied.some((row) => row.name === name)))
      throw new Error('Apply the complete repository migration inventory before initialization')
    if (process.stdin.isTTY) throw new Error('Supply password through stdin from a secure secret source')
    let password = ''
    for await (const chunk of process.stdin) {
      password += chunk
      if (password.length > 130) throw new Error('Invalid password length')
    }
    password = password.replace(/\r?\n$/, '')
    if (password.length < 15 || password.length > 128) throw new Error('Invalid password length')
    const passwordHash = await hashPassword(password)
    password = ''
    const inventory = (await execute("SELECT name FROM sqlite_master WHERE type='table'"))[0]?.results
    if (!Array.isArray(inventory)) throw new Error('Cannot inspect production schema')
    statements = initialAdminStatements({ username: values.username, name: values.name, passwordHash, tables: inventory.map((row) => row.name) })
    await execute(statements.create)
    await execute(statements.insert)
    const verification = (await execute(statements.verify))[0]?.results?.[0]
    if (verification?.role !== 'platform_admin' || verification?.banned !== 0 || verification?.credentials !== 1)
      throw new Error('Administrator verification failed')
    console.log('Initial production administrator verified. No demo business data retained.')
  } finally {
    if (statements) await execute(statements.drop)
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Initialization failed'); process.exitCode = 1 })
