import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialSecretsFile } from './secrets.mjs'
test('initial secrets allow only private security/provider settings, never analytics vars or live WhatsApp credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'noqueue-secrets-test-'))
  const path = join(directory, 'synthetic.json')
  const valid = Object.fromEntries(['BETTER_AUTH_SECRET', 'PII_ENCRYPTION_KEY', 'PHONE_HASH_KEY', 'RECOVERY_TOKEN_KEY'].map((key) => [key, 'a'.repeat(64)]))
  try {
    await writeFile(path, JSON.stringify(valid), { mode: 0o600 })
    assert.equal(await initialSecretsFile(path), path)
    for (const changes of [{ WHATSAPP_ENABLED: 'true' }, { D360DIALOG_API_KEY: 'synthetic' }, { LOCAL_DEV_TOKEN: 'synthetic' }, { AUTH_EMAIL_FROM: 'synthetic@example.invalid' }, { PII_ENCRYPTION_KEY: 'short' }]) {
      await writeFile(path, JSON.stringify({ ...valid, ...changes }))
      await assert.rejects(() => initialSecretsFile(path))
    }
    await writeFile(path, JSON.stringify(valid))
    await chmod(path, 0o644)
    await assert.rejects(() => initialSecretsFile(path), /private/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
