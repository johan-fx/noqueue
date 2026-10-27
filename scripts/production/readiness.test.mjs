import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig, resolveBuildProfile, releaseProfile, withReleaseProfile, assertProductionConfig } from './config.mjs'
import { assertAppReadiness, assertReleaseApprovals } from './readiness.mjs'
import { migrationInventory } from './migrations.mjs'
const config = await readConfig()
const profile = resolveBuildProfile({ profile: 'mobile-production' })
const secrets = ['D360DIALOG_API_KEY', 'D360DIALOG_PHONE_NUMBER_ID', 'D360DIALOG_WEBHOOK_TOKEN', 'MOBILE_PUSH_TOKEN_KEY', 'FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY']
function fixture({ count = 40, missing, dbId = config.env.production.d1_databases[0].database_id, failure = false, liveWhatsapp = 'true' } = {}) {
  const calls = []
  const request = async (url, options) => {
    calls.push({ url, options })
    const result = url.endsWith('/settings') ? { bindings: [
      { name: 'DB', type: 'd1', id: dbId }, { name: 'WHATSAPP_ENABLED', type: 'plain_text', text: liveWhatsapp },
      ...secrets.filter(name => name !== missing).map(name => ({ name, type: 'secret_text' })),
    ] } : [{ success: true, results: migrationInventory().slice(0, count).map(({ name }) => ({ name })) }]
    return { ok: !failure, json: async () => ({ success: !failure, result }) }
  }
  return { calls, request }
}
test('mobile-production explicitly preserves WA/analytics and enables push/automation without editing baseline', () => {
  assert.deepEqual(profile, { analytics: 'both', whatsapp: 'on', push: 'on', automation: 'on' })
  const before = structuredClone(config), generated = withReleaseProfile(config, profile)
  assertProductionConfig(generated, profile)
  assert.deepEqual(config, before)
  assert.deepEqual(generated.env.staging, before.env.staging)
  const vars = generated.env.production.vars
  assert.equal(vars.QUEUE_AUTO_REPLACEMENT_ENABLED, 'true')
  assert.equal(vars.MOBILE_PUSH_ENABLED, 'true')
  assert.equal(vars.FCM_IOS_ENABLED, 'true')
  assert.equal(vars.WHATSAPP_ENABLED, 'true')
  assert.equal(vars.FCM_IOS_BUNDLE_ID, 'com.noqueue-app.ios')
  assertProductionConfig(config)
  for (const push of ['on', 'off']) for (const automation of ['on', 'off']) {
    const p = { ...profile, push, automation }
    assertProductionConfig(withReleaseProfile(config, p), p)
  }
  for (const key of ['analytics', 'whatsapp', 'push', 'automation']) assert.throws(() => resolveBuildProfile({ profile: 'mobile-production', [key]: 'off' }))
  assert.throws(() => resolveBuildProfile({ profile: 'production' }))
  for (const key of ['push', 'automation']) assert.throws(() => releaseProfile({ [key]: 'true' }))
  generated.env.production.vars.STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP = 'true'
  assert.throws(() => assertProductionConfig(generated, profile), /Silent staging admission/)
})
test('future deploy requires all feature approvals including rollback', () => {
  const values = { target: 'app', 'confirm-production': true, 'confirm-analytics': true, 'confirm-whatsapp': true, 'confirm-push': true, 'confirm-automation': true }
  assertReleaseApprovals(profile, values)
  for (const key of Object.keys(values).filter(key => key.startsWith('confirm-'))) {
    assert.throws(() => assertReleaseApprovals(profile, { ...values, [key]: false, rollback: true }))
  }
})
test('readiness performs only metadata GET and SELECT and never leaks secret values', async () => {
  const f = fixture()
  await assertAppReadiness({ profile, config, token: 'synthetic', request: f.request })
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0].options.method, 'GET')
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { sql: 'SELECT name FROM d1_migrations ORDER BY id' })
  assert.equal(f.calls[1].options.method, 'POST')
})
test('readiness fails closed for pending migration, missing secret, wrong DB or provider error', async () => {
  for (const [options, error] of [[{ count: 28 }, /Apply reviewed migrations/], [{ missing: 'FCM_PRIVATE_KEY' }, /Missing production secret/], [{ missing: 'D360DIALOG_API_KEY' }, /Missing production secret/], [{ dbId: 'staging' }, /identity mismatch/], [{ failure: true }, /Cannot verify/], [{ liveWhatsapp: 'unknown' }, /Cannot verify live WhatsApp/]]) {
    await assert.rejects(assertAppReadiness({ profile, config, token: 'synthetic', request: fixture(options).request }), error)
  }
})
test('default OFF profile cannot accidentally disable live WhatsApp', async () => {
  await assert.rejects(assertAppReadiness({ profile: releaseProfile(), config, token: 'synthetic', request: fixture().request }), /Refusing to disable live WhatsApp/)
  await assertAppReadiness({ profile: releaseProfile(), config, token: 'synthetic', confirmDisableWhatsapp: true, request: fixture().request })
})
