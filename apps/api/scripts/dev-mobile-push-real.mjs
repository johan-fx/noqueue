// Operator-only real push smoke. Never deploy; never load normal .dev.vars.
import { readFile, writeFile, mkdtemp, rm, realpath, stat, mkdir } from 'node:fs/promises'
import { createServer as httpsServer } from 'node:https'
import { createServer as httpServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createTestHarness } from 'wrangler'
import { createWorkerServer } from './http-worker.mjs'
import { mobileNetwork } from './mobile-network.mjs'
import { checkCredential } from './check-fcm-credential.mjs'

assert.equal(process.env.NOQUEUE_REAL_PUSH_SMOKE, 'only-my-iphone', 'Explicit real-push opt-in required')
assert.ok(process.env.NOQUEUE_LOCAL_HOST, 'Private LAN host required')
process.umask(0o077)
const root = fileURLToPath(new URL('../', import.meta.url)), repo = path.resolve(root, '../..')
const network = mobileNetwork(process.env, repo)
const filename = await realpath(process.env.NOQUEUE_FCM_CREDENTIAL ?? '')
assert.ok(!filename.startsWith(repo + path.sep), 'Credential must remain outside repository')
assert.equal((await stat(filename)).mode & 0o077, 0, 'Private credential permissions required')
assert.equal((await stat(path.dirname(filename))).mode & 0o077, 0, 'Private credential directory required')
const credential = JSON.parse(await readFile(filename, 'utf8')); checkCredential(credential)
const directory = await mkdtemp(path.join(tmpdir(), 'noqueue-real-push-'))
const reportDir = path.join(repo, 'reports/ios-device/push-real')
await mkdir(reportDir, { recursive: true, mode: 0o700 })
const controlFile = path.join(reportDir, 'control.json'), controlToken = randomBytes(32).toString('hex')
const config = JSON.parse(await readFile(path.join(root, 'test/wrangler.json'), 'utf8'))
config.name = 'noqueue-local-real-push-only'
config.main = path.join(root, 'test/mobile-push-real-worker.ts')
for (const db of config.d1_databases) { if (db.migrations_dir) db.migrations_dir = path.join(root, 'migrations'); db.remote = false }
config.vars = { ...config.vars, PUBLIC_APP_ORIGIN: network.origin,
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), PII_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  PHONE_HASH_KEY: randomBytes(32).toString('hex'), RECOVERY_TOKEN_KEY: randomBytes(32).toString('hex'),
  WHATSAPP_ENABLED: 'false', CONFIRMATION_EXPERIMENT_ENABLED: 'false', MOBILE_PUSH_ENABLED: 'true',
  FCM_IOS_ENABLED: 'true', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios', MOBILE_PUSH_TOKEN_KEY: randomBytes(32).toString('hex'),
  FCM_PROJECT_ID: credential.project_id, FCM_CLIENT_EMAIL: credential.client_email, FCM_PRIVATE_KEY: credential.private_key,
}
// Temporary private config outside Git. Removed at shutdown, never printed.
const configPath = path.join(directory, 'wrangler.json')
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
const harness = createTestHarness({ root, workers: [{ configPath }] })
let api, control, DB, closing = false, timeout
const observations = { noticeResolved: 0, turnReadAfterNotice: 0 }
async function evidence() {
  const counts = {}
  for (const table of ['queue_entry','mobile_entry_installation','queue_entry_contact','consent','notification_outbox','mobile_push_registration','mobile_push_outbox'])
    counts[table] = (await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n
  return { at: new Date().toISOString(), localOnly: true, whatsappEnabled: false, counts,
    entries: (await DB.prepare('SELECT code,status,version FROM queue_entry').all()).results,
    registrations: (await DB.prepare('SELECT platform,provider,enabled FROM mobile_push_registration').all()).results,
    outbox: (await DB.prepare('SELECT kind,status,attempts,last_error FROM mobile_push_outbox').all()).results,
    guard: await DB.prepare('SELECT remaining,oauth_remaining,attempted_at FROM local_push_guard WHERE id=1').first(), observations }
}
async function close() {
  if (closing) return; closing = true; clearTimeout(timeout)
  if (DB) await writeFile(path.join(reportDir, 'result.json'), JSON.stringify(await evidence(), null, 2)).catch(() => {})
  for (const server of [api, control]) { server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)) }
  try { await harness.close() }
  finally { await rm(controlFile, { force: true }); await rm(directory, { recursive: true, force: true }) }
}
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close())
try {
  await harness.listen()
  const worker = harness.getWorker(); await worker.applyD1Migrations('DB')
  const bindings = await worker.getEnv(); DB = bindings.DB
  // No migration: smoke-only guard never exists remotely.
  await DB.exec(`CREATE TABLE local_push_guard (id INTEGER PRIMARY KEY CHECK(id=1), installation_hash TEXT NOT NULL, token_hash TEXT NOT NULL, entry_id TEXT NOT NULL, expires_at INTEGER NOT NULL, remaining INTEGER NOT NULL CHECK(remaining IN (0,1)), oauth_remaining INTEGER NOT NULL, notice_id TEXT, attempted_at INTEGER)`)
  const actor = crypto.randomUUID(), org = crypto.randomUUID(), venue = crypto.randomUUID(), queue = crypto.randomUUID()
  const settings = { name: 'Restaurante local', type: 'restaurant', capacity: 99, averageMinutes: 30, graceMinutes: 30,
    cutoffMinutes: 0, twentyFourHours: true, schedules: [], receptionServices: [], estimationMode: 'active', resourceStateKnown: true,
    approachTurns: 0, approachMinutes: 0, stations: 1,
    spaces: [{ id: 'terrace', name: 'Terraza', tables: 1, tableTypes: [{ seats: 4, count: 1 }] }] }
  await DB.batch([
    DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,'now','now')").bind(actor, 'Local owner', `${actor}@test.invalid`),
    DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(org, 'Local push smoke'),
    DB.prepare('INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)').bind(org, actor),
    DB.prepare('INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)').bind(venue, org, 'Establecimiento local'),
    DB.prepare("INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,'owner','now')").bind(crypto.randomUUID(), org, actor),
    DB.prepare("INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,?,'owner')").bind(actor, venue),
    DB.prepare("INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,99,30,1,'Restaurante local',?)").bind(queue, venue, JSON.stringify(settings)),
    DB.prepare("INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)")
      .bind(queue, `continuous:${JSON.stringify(['Europe/Madrid', 'restaurant', true, 0, []])}`, Date.now()),
  ])
  await DB.prepare("UPDATE venue SET address_formatted='Calle de pruebas 1',latitude=40.416,longitude=-3.704,location_provider='geoapify',location_provider_id='local-fixture',location_attribution='[]',location_confirmed_at=? WHERE id=?").bind(Date.now(), venue).run()
  await DB.prepare('INSERT INTO service_directory_config(queue_id,source_config,normalized_config) SELECT id,config,config FROM queue WHERE id=?').bind(queue).run()
  const transport = createWorkerServer(async (url, init) => {
    const response = await worker.fetch(url, init), pathname = new URL(url).pathname
    if (init.method === 'GET' && response.ok) {
      if (/^\/api\/v1\/mobile\/push\/notices\/[a-f0-9]{32}$/.test(pathname)) observations.noticeResolved++
      if (observations.noticeResolved && /^\/api\/v1\/mobile\/entries\//.test(pathname)) observations.turnReadAfterNotice++
    }
    return response
  }, network.origin)
  api = httpsServer({ key: await readFile(network.key), cert: await readFile(network.cert) }, transport.listeners('request')[0])
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(8788, network.host, resolve) })
  // Operator controls are loopback-only, bearer-protected, never exposed over LAN.
  control = httpServer(async (req, res) => {
    const reply = (status, value) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value))
    if (req.headers.authorization !== `Bearer ${controlToken}`) return reply(404, {})
    try {
      if (req.method === 'GET' && req.url === '/evidence') return reply(200, await evidence())
      if (req.method !== 'POST') return reply(404, {})
      let input = ''; for await (const chunk of req) { input += chunk; assert.ok(input.length < 512) }
      const body = JSON.parse(input || '{}')
      if (req.url === '/call-once') {
        assert.match(body.code ?? '', /^[A-Z0-9]{6}$/)
        assert.equal((await DB.prepare('SELECT count(*) AS n FROM queue_entry').first()).n, 1)
        assert.equal((await DB.prepare('SELECT count(*) AS n FROM mobile_push_registration').first()).n, 1)
        const row = await DB.prepare(`SELECT e.id,e.version,m.installation_hash,r.token_hash FROM queue_entry e
          JOIN mobile_entry_installation m ON m.entry_id=e.id JOIN mobile_push_registration r ON r.installation_hash=m.installation_hash
          WHERE e.code=? AND e.queue_id=? AND e.status='waiting' AND r.platform='ios' AND r.provider='fcm' AND r.enabled=1`).bind(body.code, queue).first()
        assert.ok(row, 'Exactly one confirmed iPhone turn/registration required')
        // INSERT, never upsert: a session can authorize just one provider attempt.
        await DB.prepare('INSERT INTO local_push_guard(id,installation_hash,token_hash,entry_id,expires_at,remaining,oauth_remaining) VALUES (1,?,?,?,?,1,1)')
          .bind(row.installation_hash, row.token_hash, row.id, Date.now() + 120000).run()
        const stub = bindings.QUEUE_COORDINATOR.getByName(queue)
        const result = await stub.staffCommand(actor, queue, crypto.randomUUID(), { action: 'call', entryId: row.id, version: row.version, arrivalMode: 'notify' })
        assert.equal(result.status, 200)
        return reply(200, { called: true, maxProviderAttempts: 1 })
      }
      if (req.url === '/disarm') {
        await DB.batch([DB.prepare('UPDATE local_push_guard SET remaining=0,oauth_remaining=0'), DB.prepare('DELETE FROM mobile_push_registration'), DB.prepare("UPDATE mobile_push_outbox SET status='discarded',last_error='local_smoke_closed' WHERE status IN ('pending','sending')")])
        return reply(200, { disarmed: true })
      }
      if (req.url === '/shutdown') {
        await DB.batch([DB.prepare('UPDATE local_push_guard SET remaining=0,oauth_remaining=0'), DB.prepare('DELETE FROM mobile_push_registration')])
        reply(200, { closing: true })
        // Prefer explicit close: Wrangler also handles SIGINT and can end the
        // runtime before our asynchronous evidence/secret-file cleanup finishes.
        setImmediate(() => void close())
        return
      }
      return reply(404, {})
    } catch { return reply(409, { error: 'smoke_control_rejected' }) }
  })
  await new Promise((resolve, reject) => { control.once('error', reject); control.listen(8789, '127.0.0.1', resolve) })
  await writeFile(controlFile, JSON.stringify({ port: 8789, token: controlToken }), { mode: 0o600 })
  // No crons; initial sends come only from the real coordinator. A guard is mandatory.
  timeout = setTimeout(() => void close(), 90 * 60000)
  console.log(`Local real-push API ready at ${network.origin}; no recipient armed; one iPhone / one attempt maximum; WhatsApp OFF.`)
} catch {
  await close(); console.error('Local push smoke startup failed (details suppressed to protect credentials)'); process.exitCode = 1
}
