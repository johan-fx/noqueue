import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
export const repository = new URL('../../', import.meta.url)
export const accountId = 'fa5fab4df1b0f12c946a3ea47fab96eb'
export const readConfig = async () => JSON.parse(await readFile(new URL('apps/api/wrangler.jsonc', repository), 'utf8'))
export const productionBuildEnv = Object.freeze({
  VITE_PUBLIC_APP_ORIGIN: 'https://app.noqueue-app.com',
  VITE_API_URL: '', VITE_APP_ENV: 'production', VITE_ANALYTICS_ENABLED: 'false', VITE_GA4_MEASUREMENT_ID: '',
  LANDING_APP_ENV: 'production', LANDING_ANALYTICS_ENABLED: 'false', LANDING_GA4_MEASUREMENT_ID: '',
})
export const productionStreams = Object.freeze({ landing: 'G-QEVCK0TBCF', app: 'G-S905ERLNN9' })
export function releaseProfile({ analytics = 'off', whatsapp = 'off' } = {}) {
  assert.ok(['off', 'landing', 'both'].includes(analytics), 'Expected analytics off|landing|both')
  assert.ok(['off', 'on'].includes(whatsapp), 'Expected whatsapp off|on')
  return Object.freeze({ analytics, whatsapp })
}
export function buildEnvironment(profile = releaseProfile()) {
  const { analytics } = releaseProfile(profile)
  return { ...productionBuildEnv,
    LANDING_ANALYTICS_ENABLED: String(analytics !== 'off'),
    LANDING_GA4_MEASUREMENT_ID: analytics !== 'off' ? productionStreams.landing : '',
    VITE_ANALYTICS_ENABLED: String(analytics === 'both'),
    VITE_GA4_MEASUREMENT_ID: analytics === 'both' ? productionStreams.app : '',
  }
}
// Resource identity is independent of activation: backups must remain usable ON or OFF.
export function assertProductionIdentity(config, { provisioned = false } = {}) {
  const p = config.env?.production
  assert.equal(config.account_id, accountId, 'Unexpected Cloudflare account')
  assert.equal(p?.name, 'noqueue-api-production')
  assert.equal(p.workers_dev, false)
  assert.equal(p.preview_urls, false)
  assert.equal(config.main, 'src/index.ts', 'Never deploy an E2E entrypoint')
  for (const key of ['main', 'assets', 'observability', 'build'])
    assert.equal(p[key], undefined, `Unexpected production override: ${key}`)
  assert.equal(config.build, undefined, 'Do not run an unreviewed deploy-time build')
  assert.deepEqual(p.routes, [{ pattern: 'app.noqueue-app.com', custom_domain: true }])
  assert.equal(p.vars.APP_ENV, 'production')
  assert.equal(p.vars.PUBLIC_APP_ORIGIN, 'https://app.noqueue-app.com')
  assert.equal(p.vars.WHATSAPP_MODE, 'cloud')
  assert.equal(p.vars.WHATSAPP_COPY_VERSION, '4')
  for (const flag of ['STAGING_CONSENT_APPROVED', 'STAGING_EXPERIMENT_APPROVED', 'STAGING_EXPERIMENT_OPEN_RECIPIENTS',
    'CONFIRMATION_EXPERIMENT_ENABLED', 'METRICS_CRON_RECOVERY_ENABLED'])
    assert.equal(p.vars[flag], 'false', `${flag} must stay OFF for the initial release`)
  assert.equal(p.vars.METRICS_SERVICE_SNAPSHOT_CAPTURE_SINCE, undefined, 'Do not copy staging history')
  assert.deepEqual(p.triggers.crons, ['* * * * *', '*/15 * * * *'])
  assert.deepEqual(p.durable_objects.bindings, [{ name: 'QUEUE_COORDINATOR', class_name: 'QueueCoordinator' }])
  assert.deepEqual(p.queues.producers, [
    { binding: 'NOTIFICATIONS', queue: 'noqueue-whatsapp-production' },
    { binding: 'NOTIFICATIONS_DLQ', queue: 'noqueue-whatsapp-production-dlq' },
  ])
  assert.deepEqual(p.queues.consumers, [{ queue: 'noqueue-whatsapp-production', dead_letter_queue: 'noqueue-whatsapp-production-dlq', max_retries: 3, max_batch_size: 10 }])
  assert.deepEqual(p.r2_buckets, [{ binding: 'VENUE_LOGOS', bucket_name: 'noqueue-venue-logos-production', jurisdiction: 'eu' }])
  assert.equal(p.vars.VENUE_LOGOS_PUBLIC_BASE_URL, 'https://assets.noqueue-app.com')
  assert.equal(config.observability.logs.invocation_logs, false)
  assert.equal(config.observability.traces.enabled, false)
  assert.equal(config.assets.directory, '../web/dist')
  assert.equal(config.assets.binding, 'ASSETS')
  assert.deepEqual(config.assets.run_worker_first, ['/api/*', '/assets/*'])
  assert.equal(p.d1_databases.length, 1)
  const db = p.d1_databases[0]
  assert.equal(db.binding, 'DB')
  assert.equal(db.database_name, 'noqueue-production')
  assert.equal(db.migrations_dir, 'migrations')
  assert.match(db.database_id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
  if (provisioned) assert.notEqual(db.database_id, '00000000-0000-0000-0000-000000000000', 'Production D1 is not provisioned; placeholder must not be deployed')
  for (const name of ['sandbox', 'staging'])
    assert.notEqual(db.database_id, config.env[name].d1_databases[0].database_id, 'Never reuse another environment database')
  const templates = Object.entries(p.vars).filter(([key]) => key.startsWith('WHATSAPP_QUEUE_V4_'))
  assert.equal(templates.length, 24)
  assert.ok(templates.every(([, value]) => !value.includes('_staging')))
  assert.equal(Object.keys(p.vars).some((key) => /(?:API_KEY|ENCRYPTION_KEY|HASH_KEY|TOKEN_KEY|SECRET|WEBHOOK_TOKEN|ACCESS_TOKEN)$/.test(key)), false, 'Secrets must not be committed as vars')
  return p
}
export function assertProductionConfig(config, { provisioned = false, whatsapp = 'off' } = {}) {
  releaseProfile({ whatsapp })
  const p = assertProductionIdentity(config, { provisioned })
  for (const flag of ['WHATSAPP_ENABLED', 'PRODUCTION_WHATSAPP_APPROVED', 'WHATSAPP_V4_TEMPLATES_APPROVED'])
    assert.equal(p.vars[flag], String(whatsapp === 'on'), `${flag} differs from the explicit release profile`)
  return p
}
export function withReleaseProfile(config, profile) {
  const { whatsapp } = releaseProfile(profile)
  assertProductionIdentity(config)
  const result = structuredClone(config)
  for (const flag of ['WHATSAPP_ENABLED', 'PRODUCTION_WHATSAPP_APPROVED', 'WHATSAPP_V4_TEMPLATES_APPROVED'])
    result.env.production.vars[flag] = String(whatsapp === 'on')
  assertProductionConfig(result, { whatsapp })
  return result
}
export function assertLandingConfig(config) {
  assert.equal(config.account_id, accountId)
  assert.equal(config.name, 'noqueue-landing')
  assert.equal(config.workers_dev, false)
  assert.equal(config.preview_urls, false)
  assert.deepEqual(config.routes, [{ pattern: 'noqueue-app.com', custom_domain: true }])
  assert.equal(config.assets.directory, './dist')
  assert.equal(config.main, undefined, 'The landing has no executable Worker')
  assert.equal(config.build, undefined)
}
