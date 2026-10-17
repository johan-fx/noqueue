import assert from 'node:assert/strict'
import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// The initial OFF release must not override vars or install a live messaging channel.
const required = ['BETTER_AUTH_SECRET', 'PII_ENCRYPTION_KEY', 'PHONE_HASH_KEY', 'RECOVERY_TOKEN_KEY']
const allowed = new Set([...required, 'D360DIALOG_WEBHOOK_TOKEN', 'GEOAPIFY_API_KEY', 'AUTH_EMAIL_API_KEY', 'AUTH_EMAIL_FROM'])
export async function initialSecretsFile(path) {
  const absolute = resolve(path)
  const info = await lstat(absolute)
  assert.ok(info.isFile() && (info.mode & 0o077) === 0, 'Secrets must be a private regular file (0600), not a symlink')
  let secrets
  try { secrets = JSON.parse(await readFile(absolute, 'utf8')) }
  catch { throw new Error('Invalid private secrets JSON; contents withheld') }
  assert.ok(secrets && typeof secrets === 'object' && !Array.isArray(secrets), 'Expected secrets object')
  assert.ok(Object.entries(secrets).every(([key, value]) => allowed.has(key) && typeof value === 'string' && value.trim()), 'Unsupported or empty secret; no vars or WhatsApp credentials allowed')
  assert.ok(required.every((key) => typeof secrets[key] === 'string'), 'Missing production security secrets')
  for (const key of ['PII_ENCRYPTION_KEY', 'PHONE_HASH_KEY', 'RECOVERY_TOKEN_KEY'])
    assert.ok(/^[a-f0-9]{64}$/i.test(secrets[key]), 'Security keys must be 32-byte hex strings')
  assert.ok(secrets.BETTER_AUTH_SECRET.length >= 32, 'Authentication secret is too short')
  assert.equal(Boolean(secrets.AUTH_EMAIL_API_KEY), Boolean(secrets.AUTH_EMAIL_FROM), 'Configure both email settings or neither')
  return absolute
}
