// Operator-only full lifecycle; authorization required separately for each scenario. Never deploy; never load normal .dev.vars.
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
import { lifecycleOptions, lifecycleWindow } from './local-push-lifecycle-options.mjs'
import { checkCredential } from './check-fcm-credential.mjs'

const { platform, apiPort, controlPort, reportPath, scenario, limits, budget } = lifecycleOptions(process.env)
process.umask(0o077)
const root = fileURLToPath(new URL('../', import.meta.url)), repo = path.resolve(root, '../..')
const network = mobileNetwork(platform === 'android' ? {} : process.env, repo)
network.origin = `https://${network.host}:${apiPort}`
const filename = await realpath(process.env.NOQUEUE_FCM_CREDENTIAL ?? '')
assert.ok(!filename.startsWith(repo + path.sep), 'Credential must remain outside repository')
assert.equal((await stat(filename)).mode & 0o077, 0, 'Private credential permissions required')
assert.equal((await stat(path.dirname(filename))).mode & 0o077, 0, 'Private credential directory required')
const credential = JSON.parse(await readFile(filename, 'utf8')); checkCredential(credential)
const directory = await mkdtemp(path.join(tmpdir(), 'noqueue-lifecycle-push-'))
const reportDir = path.join(repo, reportPath)
await mkdir(reportDir, { recursive: true, mode: 0o700 })
const controlFile = path.join(reportDir, 'control.json'), controlToken = randomBytes(32).toString('hex')
const config = JSON.parse(await readFile(path.join(root, 'test/wrangler.json'), 'utf8'))
config.name = 'noqueue-local-lifecycle-push-only'
config.main = path.join(root, 'test/mobile-push-lifecycle-worker.ts')
for (const db of config.d1_databases) { if (db.migrations_dir) db.migrations_dir = path.join(root, 'migrations'); db.remote = false }
config.vars = { ...config.vars, PUBLIC_APP_ORIGIN: network.origin,
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), PII_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  PHONE_HASH_KEY: randomBytes(32).toString('hex'), RECOVERY_TOKEN_KEY: randomBytes(32).toString('hex'),
  WHATSAPP_ENABLED: 'false', CONFIRMATION_EXPERIMENT_ENABLED: 'false', MOBILE_PUSH_ENABLED: 'true',
  FCM_IOS_ENABLED: platform === 'ios' ? 'true' : 'false', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios', MOBILE_PUSH_TOKEN_KEY: randomBytes(32).toString('hex'),
  FCM_PROJECT_ID: credential.project_id, FCM_CLIENT_EMAIL: credential.client_email, FCM_PRIVATE_KEY: credential.private_key,
}
// Temporary private config outside Git. Removed at shutdown, never printed.
const configPath = path.join(directory, 'wrangler.json')
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
const harness = createTestHarness({ root, workers: [{ configPath }] })
let api, control, DB, closing = false, timeout
const observations = { noticeResolved: 0, turnReadAfterNotice: 0, resolutions: [] }
async function evidence() {
  const counts = {}
  for (const table of ['queue_entry','mobile_entry_installation','queue_entry_contact','consent','notification_outbox','mobile_push_registration','mobile_push_outbox'])
    counts[table] = (await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n
  return { at: new Date().toISOString(), localOnly: true, whatsappEnabled: false, counts,
    entries: (await DB.prepare('SELECT code,status,version FROM queue_entry').all()).results,
    registrations: (await DB.prepare('SELECT platform,provider,enabled FROM mobile_push_registration').all()).results,
    outbox: (await DB.prepare("SELECT id,event_key,kind,json_extract(payload_snapshot,'$.copyVariant') variant,status,attempts,created_at,accepted_at,expires_at,last_error FROM mobile_push_outbox ORDER BY created_at,rowid").all()).results,
    scenario, limits, budget, guard: await DB.prepare('SELECT armed,budget,oauth_remaining,expires_at FROM local_push_lifecycle_guard WHERE id=1').first(),
    attempts: (await DB.prepare('SELECT notice_id,kind,attempted_at FROM local_push_lifecycle_attempt ORDER BY attempted_at').all()).results, observations }
}
async function close() {
  if (closing) return; closing = true; clearTimeout(timeout)
  if (DB) await DB.batch([DB.prepare('UPDATE local_push_lifecycle_guard SET armed=0,oauth_remaining=0'), DB.prepare('DELETE FROM mobile_push_registration'), DB.prepare("UPDATE mobile_push_outbox SET status='discarded',last_error='local_lifecycle_closed' WHERE status IN ('pending','sending')")]).catch(() => {})
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
  await DB.exec(`CREATE TABLE local_push_lifecycle_guard (id INTEGER PRIMARY KEY CHECK(id=1),platform TEXT NOT NULL CHECK(platform IN ('ios','android')),installation_hash TEXT NOT NULL,token_hash TEXT NOT NULL,entry_id TEXT NOT NULL,expires_at INTEGER NOT NULL,budget INTEGER NOT NULL CHECK(budget BETWEEN 1 AND 20),limits TEXT NOT NULL,oauth_remaining INTEGER NOT NULL CHECK(oauth_remaining BETWEEN 0 AND 2),armed INTEGER NOT NULL CHECK(armed IN (0,1)))`)
  await DB.exec('CREATE TABLE local_push_lifecycle_attempt (notice_id TEXT PRIMARY KEY,kind TEXT NOT NULL,attempted_at INTEGER NOT NULL)')
  const actor = crypto.randomUUID(), org = crypto.randomUUID(), venue = crypto.randomUUID(), queue = crypto.randomUUID()
  const window = lifecycleWindow(scenario)
  const settings = { name: 'Restaurante local', type: 'restaurant', capacity: 99, averageMinutes: scenario === 'improvements' ? 6 : 4, graceMinutes: 2, estimatorVersion: 2, etaChangeThresholdMinutes: scenario === 'normal' ? 5 : 1, notificationCooldownMinutes: 10,
    cutoffMinutes: 0, twentyFourHours: window.twentyFourHours, schedules: window.schedules, receptionServices: [], estimationMode: 'active', resourceStateKnown: true,
    approachTurns: 0, approachMinutes: scenario === 'improvements' ? 4 : 2, stations: 1,
    spaces: [{ id: 'terrace', name: 'Terraza', tables: 1, tableTypes: [{ seats: 4, count: 1 }] }] }
  await DB.batch([
    DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,'now','now')").bind(actor, 'Local owner', `${actor}@test.invalid`),
    DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(org, 'Local push smoke'),
    DB.prepare('INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)').bind(org, actor),
    DB.prepare('INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)').bind(venue, org, 'Establecimiento local'),
    DB.prepare("INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,'owner','now')").bind(crypto.randomUUID(), org, actor),
    DB.prepare("INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,?,'owner')").bind(actor, venue),
    DB.prepare("INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,99,4,1,'Restaurante local',?)").bind(queue, venue, JSON.stringify(settings)),
    DB.prepare("INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)")
      .bind(queue, window.windowId, Date.now()),
  ])
  await DB.prepare("UPDATE venue SET address_formatted='Calle de pruebas 1',latitude=40.416,longitude=-3.704,location_provider='geoapify',location_provider_id='local-fixture',location_attribution='[]',location_confirmed_at=? WHERE id=?").bind(Date.now(), venue).run()
  await DB.prepare('INSERT INTO service_directory_config(queue_id,source_config,normalized_config) SELECT id,config,config FROM queue WHERE id=?').bind(queue).run()
  const transport = createWorkerServer(async (url, init) => {
    const response = await worker.fetch(url, init), pathname = new URL(url).pathname
    if (init.method === 'GET' && response.ok) {
      if (/^\/api\/v1\/mobile\/push\/notices\/[a-f0-9]{32}$/.test(pathname)) {
        observations.noticeResolved++
        observations.resolutions.push({ notificationId: pathname.split('/').at(-1), at: new Date().toISOString() })
      }
      if (observations.noticeResolved && /^\/api\/v1\/mobile\/entries\//.test(pathname)) observations.turnReadAfterNotice++
    }
    return response
  }, network.origin)
  api = httpsServer({ key: await readFile(network.key), cert: await readFile(network.cert) }, transport.listeners('request')[0])
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(apiPort, network.host, resolve) })
  // Operator controls are loopback-only, bearer-protected, never exposed over LAN.
  control = httpServer(async (req, res) => {
    const reply = (status, value) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value))
    if (req.headers.authorization !== `Bearer ${controlToken}`) return reply(404, {})
    try {
      if (req.method === 'GET' && req.url === '/evidence') return reply(200, await evidence())
      if (req.method !== 'POST') return reply(404, {})
      let input = ''; for await (const chunk of req) { input += chunk; assert.ok(input.length < 512) }
      const body = JSON.parse(input || '{}')
      if (req.url === '/arm') {
        assert.match(body.code ?? '', /^[A-Z0-9]{6}$/)
        assert.equal((await DB.prepare('SELECT count(*) AS n FROM queue_entry').first()).n, 1)
        assert.equal((await DB.prepare('SELECT count(*) AS n FROM mobile_push_registration').first()).n, 1)
        const row = await DB.prepare(`SELECT e.id,e.version,m.installation_hash,r.token_hash FROM queue_entry e
          JOIN mobile_entry_installation m ON m.entry_id=e.id JOIN mobile_push_registration r ON r.installation_hash=m.installation_hash
          WHERE e.code=? AND e.queue_id=? AND e.status='waiting' AND r.platform=? AND r.provider='fcm' AND r.enabled=1`).bind(body.code, queue, platform).first()
        assert.ok(row, 'Exactly one confirmed platform-matched turn/registration required')
        // A single arming per fresh session, with the declared per-kind budget.
        assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mobile_push_outbox').first()).n, 0, 'Arm before any lifecycle event; restart otherwise')
        await DB.prepare('INSERT INTO local_push_lifecycle_guard VALUES (1,?,?,?,?,?,?,?,2,1)')
          .bind(platform,row.installation_hash,row.token_hash,row.id,Date.now()+90*60000,budget,JSON.stringify(limits)).run()
        return reply(200, { armed: true, scenario, limits, budget })
      }
      if (req.url === '/step') {
        const guard = await DB.prepare('SELECT entry_id FROM local_push_lifecycle_guard WHERE id=1 AND armed=1 AND expires_at>?').bind(Date.now()).first()
        assert.ok(guard, 'Arm a fresh scenario first')
        const row = await DB.prepare('SELECT version,party_size FROM queue_entry WHERE id=?').bind(guard.entry_id).first()
        const stub = bindings.QUEUE_COORDINATOR.getByName(queue)
        let result
        if (body.action === 'companion') {
          assert.equal(scenario,'yield')
          assert.equal((await DB.prepare('SELECT COUNT(*) n FROM queue_entry').first()).n,1)
          const joined=await stub.staffJoin(actor,queue,crypto.randomUUID(),{displayName:'Synthetic companion',partySize:row.party_size,locale:'es',whatsapp:{consent:false}})
          assert.equal(joined.status,201)
          return reply(200,{companionCreated:true,recipientAdded:false})
        } else if (['call','complete','cancel'].includes(body.action)) {
          assert.ok(body.action !== 'cancel' || scenario === 'cancellation')
          assert.ok(body.action !== 'call' || limits.called)
          result = await stub.staffCommand(actor,queue,crypto.randomUUID(),{action:body.action,entryId:guard.entry_id,version:row.version,...(body.action==='call'?{arrivalMode:'notify'}:{})})
        } else if (body.action === 'refresh') {
          result = {status:200,body:await stub.refresh(queue)}
        } else if (body.action === 'average') {
          assert.ok(['extensions','improvements','yield'].includes(scenario))
          assert.ok(Number.isInteger(body.minutes) && body.minutes>=2 && body.minutes<=15)
          const q = await DB.prepare('SELECT version,open,config FROM queue WHERE id=?').bind(queue).first()
          const current = JSON.parse(q.config)
          // Restaurant estimates use the table-type cadence, not only the default.
          const spaces = current.spaces.map(space => ({...space,tableTypes:space.tableTypes?.map(type=>({...type,averageMinutes:body.minutes}))}))
          result = await stub.staffConfigure(actor,queue,{...current,spaces,version:q.version,open:!!q.open,averageMinutes:body.minutes})
        } else throw new Error('Unsupported lifecycle step; customer actions must use the app')
        assert.equal(result.status,200)
        return reply(200,{action:body.action,ok:true})
      }
      if (req.url === '/disarm') {
        await DB.batch([DB.prepare('UPDATE local_push_lifecycle_guard SET armed=0,oauth_remaining=0'), DB.prepare('DELETE FROM mobile_push_registration'), DB.prepare("UPDATE mobile_push_outbox SET status='discarded',last_error='local_smoke_closed' WHERE status IN ('pending','sending')")])
        return reply(200, { disarmed: true })
      }
      if (req.url === '/shutdown') {
        await DB.batch([DB.prepare('UPDATE local_push_lifecycle_guard SET armed=0,oauth_remaining=0'), DB.prepare('DELETE FROM mobile_push_registration')])
        reply(200, { closing: true })
        // Prefer explicit close: Wrangler also handles SIGINT and can end the
        // runtime before our asynchronous evidence/secret-file cleanup finishes.
        setImmediate(() => void close())
        return
      }
      return reply(404, {})
    } catch { return reply(409, { error: 'smoke_control_rejected' }) }
  })
  await new Promise((resolve, reject) => { control.once('error', reject); control.listen(controlPort, '127.0.0.1', resolve) })
  await writeFile(controlFile, JSON.stringify({ port: controlPort, token: controlToken }), { mode: 0o600 })
  // No crons; initial sends come only from the real coordinator. A guard is mandatory.
  timeout = setTimeout(() => void close(), 90 * 60000)
  console.log(`Local real-push API ready at ${network.origin}; no recipient armed; one ${platform}; scenario ${scenario}; explicit bounded per-event budget; WhatsApp OFF.`)
} catch {
  await close(); console.error('Local push smoke startup failed (details suppressed to protect credentials)'); process.exitCode = 1
}
