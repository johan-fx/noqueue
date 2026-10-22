import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:https'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createTestHarness } from 'wrangler'
import { createWorkerServer } from './http-worker.mjs'
import { mobileNetwork } from './mobile-network.mjs'

// No named environment, remote bindings, real secrets, or production config.
const root = fileURLToPath(new URL('../', import.meta.url))
const network = mobileNetwork(process.env, path.resolve(root, '../..'))
const { origin } = network
const lifecycle = process.env.NOQUEUE_LOCAL_LIFECYCLE === '1'
assert.ok(!lifecycle || network.host === '127.0.0.1', 'Lifecycle control is loopback-only')
const controlToken = randomBytes(32).toString('hex')
const controlFile = path.resolve(root, '../../reports/android-local/lifecycle-control.json')
const parent = path.join(root, '.wrangler/mobile-runs')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(path.join(parent, 'run-'))
const config = JSON.parse(await readFile(path.join(root, 'test/wrangler.json'), 'utf8'))
config.name = 'noqueue-mobile-local-only'
config.main = path.join(root, 'test/mobile-local-worker.ts')
for (const db of config.d1_databases) {
  if (db.migrations_dir) db.migrations_dir = path.join(root, 'migrations')
  db.remote = false
}
config.vars = { ...config.vars, PUBLIC_APP_ORIGIN: origin,
  BETTER_AUTH_SECRET: 'mobile-local-only-secret-at-least-32-characters',
  PII_ENCRYPTION_KEY: '11'.repeat(32), PHONE_HASH_KEY: '22'.repeat(32), RECOVERY_TOKEN_KEY: '33'.repeat(32),
  WHATSAPP_ENABLED: 'false', MOBILE_PUSH_ENABLED: 'false', FCM_IOS_ENABLED: 'false', CONFIRMATION_EXPERIMENT_ENABLED: 'false',
}
const configPath = path.join(directory, 'wrangler.json')
await writeFile(configPath, JSON.stringify(config))
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
const harness = createTestHarness({ root, workers: [{ configPath }] })
let server
let closing = false
async function close() {
  if (closing) return
  closing = true
  server?.closeAllConnections()
  if (server?.listening) await new Promise(resolve => server.close(resolve))
  if (lifecycle) await rm(controlFile, { force: true })
  await harness.close()
}
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
try {
  await harness.listen()
  const worker = harness.getWorker()
  await worker.applyD1Migrations('DB')
  const { DB, QUEUE_COORDINATOR } = await worker.getEnv()
  const actor = crypto.randomUUID(), org = crypto.randomUUID(), venue = crypto.randomUUID(), service = crypto.randomUUID()
  const settings = { name: 'Recepción Android local', type: 'reception', capacity: 99, averageMinutes: 30,
    graceMinutes: lifecycle ? 2 : 5, cutoffMinutes: 0, twentyFourHours: true, schedules: [], receptionServices: ['check_in'],
    estimationMode: 'active', resourceStateKnown: true, approachTurns: 0, approachMinutes: 0, stations: 1, spaces: [] }
  await DB.batch([
    DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,'now','now')").bind(actor, 'Local owner', `${actor}@test.invalid`),
    DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(org, 'Local organization'),
    DB.prepare('INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)').bind(org, actor),
    DB.prepare('INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)').bind(venue, org, 'Establecimiento local'),
    DB.prepare("INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,99,30,1,'Recepción Android local',?)").bind(service, venue, JSON.stringify(settings)),
  ])
  if (lifecycle) {
    await DB.batch([
      DB.prepare("INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,'owner','now')").bind(crypto.randomUUID(), org, actor),
      DB.prepare("INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,?,'owner')").bind(actor, venue),
    ])
    await writeFile(controlFile, JSON.stringify({ token: controlToken }), { mode: 0o600 })
  }
  // Additive fixtures: keep `service` (reception) for the existing smoke suites.
  const services = { reception: service, restaurant: crypto.randomUUID(), pool: crypto.randomUUID() }
  for (const type of ['restaurant', 'pool']) {
    const name = type === 'restaurant' ? 'Restaurante local' : 'Piscina local'
    const config = { ...settings, name, type, receptionServices: [],
      spaces: type === 'restaurant' ? [
        { id: 'terrace', name: 'Terraza', tables: 1, tableTypes: [{ seats: 4, count: 1 }] },
        { id: 'room', name: 'Salón', tables: 1, tableTypes: [{ seats: 6, count: 1 }] },
      ] : [] }
    await DB.prepare('INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,99,30,1,?,?)')
      .bind(services[type], venue, name, JSON.stringify(config)).run()
    if (type === 'restaurant') {
      // Explicitly active 24h fixture: restaurant admission is not auto-started.
      const windowId = `continuous:${JSON.stringify(['Europe/Madrid', type, true, 0, []])}`
      await DB.prepare("INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)")
        .bind(services[type], windowId, Date.now()).run()
    }
  }
  // Synthetic, already-confirmed location and directory snapshots for native
  // discovery tests. Never call a geocoder or mutate an existing environment.
  await DB.prepare("UPDATE venue SET address_formatted='Calle de pruebas 1',latitude=40.416,longitude=-3.704,location_provider='geoapify',location_provider_id='local-fixture',location_attribution='[]',location_confirmed_at=? WHERE id=?")
    .bind(Date.now(), venue).run()
  await DB.prepare('INSERT INTO service_directory_config(queue_id,source_config,normalized_config) SELECT id,config,config FROM queue WHERE venue_id=?').bind(venue).run()
  // Reuse the same one-request/one-dispatch transport over TLS, no POST retry.
  const transport = createWorkerServer((url, init) => worker.fetch(url, init), origin)
  const handler = transport.listeners('request')[0]
  server = createServer({
    key: await readFile(network.key),
    cert: await readFile(network.cert),
  }, async (request, response) => {
    if (request.url?.startsWith('/__local/lifecycle/')) {
      if (!lifecycle || request.method !== 'POST' || request.headers.authorization !== `Bearer ${controlToken}`) {
        response.writeHead(404).end('{}'); return
      }
      try {
        const action = request.url.split('/').at(-1)
        assert.ok(['call', 'complete', 'expire'].includes(action))
        let waitMs = 0
        for (const type of ['restaurant', 'pool']) {
          const queue = services[type]
          const stub = QUEUE_COORDINATOR.get(QUEUE_COORDINATOR.idFromName(queue))
          const rows = (await DB.prepare('SELECT id,status,version,arrival_deadline_at FROM queue_entry WHERE queue_id=? ORDER BY sequence,id').bind(queue).all()).results
          assert.equal(rows.length, 2, 'Exactly two local fixture tickets required')
          if (action === 'expire') {
            waitMs = Math.max(waitMs, ...rows.filter(e => e.status === 'called').map(e => e.arrival_deadline_at - Date.now() + 250))
            // Actual wall clock + production maintenance; no SQL status/deadline writes.
            await stub.refresh(queue)
          } else {
            for (const entry of action === 'call' ? rows : rows.slice(0, 1)) {
              const result = await stub.staffCommand(actor, queue, crypto.randomUUID(), action === 'call' && type === 'pool' ? { action: 'assign_next' } : {
                action, entryId: entry.id, version: entry.version,
                ...(action === 'call' ? { arrivalMode: 'notify' } : {}),
              })
              assert.equal(result.status, 200, `Local ${action}: ${result.body.error ?? 'failed'}`)
            }
          }
        }
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: true, waitMs: Math.max(0, waitMs) }))
      } catch (error) {
        console.error('Local lifecycle control failed:', error.message)
        response.writeHead(500).end('{"error":"local_control_failed"}')
      }
      return
    }
    if (request.method === 'GET' && request.url === '/__local/evidence') {
      try {
        const counts = {}
        for (const table of ['queue_entry', 'mobile_entry_installation', 'queue_entry_contact', 'consent', 'notification_outbox', 'mobile_push_registration', 'mobile_push_outbox']) {
          counts[table] = (await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n
        }
        const statuses = await DB.prepare('SELECT status, count(*) AS n FROM queue_entry GROUP BY status ORDER BY status').all()
        const byService = await DB.prepare("SELECT json_extract(q.config,'$.type') AS type,e.status,count(*) AS n FROM queue_entry e JOIN queue q ON q.id=e.queue_id GROUP BY type,e.status ORDER BY type,e.status").all()
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ service, services, venue, counts, statuses: statuses.results, byService: byService.results }))
      } catch { response.writeHead(500).end() }
      return
    }
    void handler(request, response)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(network.port, network.host, resolve)
  })
  console.log(`Mobile local API: ${origin}; service: ${service}; Push OFF; WhatsApp OFF; outbound network blocked.`)
} catch (error) {
  await close()
  throw error
}
