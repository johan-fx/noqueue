// Read-only deployment gates. Importing this module never contacts a provider.
import assert from 'node:assert/strict'
import { accountId, releaseProfile } from './config.mjs'
import { pendingMigrations } from './migrations.mjs'
export function assertReleaseApprovals(profile, values) {
  releaseProfile(profile)
  assert.equal(values['confirm-production'], true, 'Production authorization required')
  if (values.target === 'landing' ? profile.analytics !== 'off' : profile.analytics === 'both')
    assert.equal(values['confirm-analytics'], true, 'Real-Google audit and analytics approval required')
  if (values.target === 'app') for (const feature of ['whatsapp', 'push', 'automation'])
    if (profile[feature] === 'on') assert.equal(values[`confirm-${feature}`], true, `Explicit --confirm-${feature} required`)
}
export async function assertAppReadiness({ profile, config, token, confirmDisableWhatsapp = false, request = fetch }) {
  assert.equal(config.account_id, accountId)
  const production = config.env.production
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`
  async function read(path, sql) {
    let response, body
    try {
      response = await request(base + path, { method: sql ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(sql ? { body: JSON.stringify({ sql }) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) })
      body = await response.json()
    } catch { throw new Error('Production readiness read failed; no deployment permitted') }
    assert.ok(response.ok && body.success === true, 'Cannot verify production readiness; no deployment permitted')
    return body.result
  }
  const settings = await read(`/workers/scripts/${production.name}/settings`)
  assert.ok(Array.isArray(settings.bindings), 'Missing production binding metadata')
  const bindings = settings.bindings
  assert.equal(bindings.find(b => b.name === 'DB' && b.type === 'd1')?.id, production.d1_databases[0].database_id, 'Live production DB identity mismatch')
  const liveWhatsapp = bindings.find(b => b.name === 'WHATSAPP_ENABLED' && b.type === 'plain_text')?.text
  assert.ok(['true', 'false'].includes(liveWhatsapp), 'Cannot verify live WhatsApp activation state')
  if (liveWhatsapp === 'true' && profile.whatsapp !== 'on')
    assert.equal(confirmDisableWhatsapp, true, 'Refusing to disable live WhatsApp without --confirm-disable-whatsapp')
  const requiredSecrets = [
    ...(profile.whatsapp === 'on' ? ['D360DIALOG_API_KEY', 'D360DIALOG_PHONE_NUMBER_ID', 'D360DIALOG_WEBHOOK_TOKEN'] : []),
    ...(profile.push === 'on' ? ['MOBILE_PUSH_TOKEN_KEY', 'FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'] : []),
  ]
  for (const name of requiredSecrets) assert.ok(bindings.some(b => b.name === name && b.type === 'secret_text'), 'Missing production secret binding: ' + name)
  const ledger = await read(`/d1/database/${production.d1_databases[0].database_id}/query`, 'SELECT name FROM d1_migrations ORDER BY id')
  assert.ok(Array.isArray(ledger) && ledger.length === 1 && ledger[0].success === true && Array.isArray(ledger[0].results), 'Invalid migration ledger response')
  const pending = pendingMigrations(ledger[0].results)
  assert.equal(pending.length, 0, `Apply reviewed migrations separately before deploying: ${pending.map(row => row.name).join(', ')}`)
}
