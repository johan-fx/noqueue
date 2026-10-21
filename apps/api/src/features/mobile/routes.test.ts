import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'
import { app } from '../../app'
import { fixture } from '../../../test/whatsapp-v4-fixture'
import { hash } from '../queue/crypto'
import { joinQueue } from '../queue/entries'
import { joinedEntrySchema } from '@noqueue/contracts/queue'

const input = { displayName: 'Guest', partySize: 1, receptionService: 'check_in', locale: 'es' } as const
let secret: string, ip: string
beforeEach(() => { secret = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''); ip = crypto.randomUUID() })
function request(path: string, init: RequestInit = {}, identity = secret, bindings = env) {
  const headers = new Headers({ Origin: 'capacitor://localhost', Authorization: `Bearer ${identity}`, 'CF-Connecting-IP': ip })
  new Headers(init.headers).forEach((value, name) => headers.set(name, value))
  return app.request(`https://app.example/api/v1${path}`, { ...init, headers }, bindings)
}
function join(queue: string, key = crypto.randomUUID(), body: unknown = input, identity = secret) {
  return request(`/mobile/services/${queue}/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }, identity)
}
async function joined(queue: string) {
  const response = await join(queue)
  expect(response.status).toBe(201)
  return joinedEntrySchema.parse(await response.json())
}
it('admits production mobile with WhatsApp OFF and creates no WA contact, consent or notification', async () => {
  const { queue } = await fixture()
  const bindings = { ...env, APP_ENV: 'production', WHATSAPP_ENABLED: 'false' } as CloudflareBindings
  const installationHash = await hash(`mobile-installation:v1:${secret}`)
  const key = crypto.randomUUID()
  const mobile = await joinQueue(bindings, queue, key, { ...input, whatsapp: { consent: false } }, false, undefined, 'mobile-app', installationHash)
  expect(mobile.status).toBe(201)
  expect(joinedEntrySchema.parse(mobile.body).notification).toBe('disabled')
  const replay = await joinQueue(bindings, queue, key, { ...input, whatsapp: { consent: false } }, false, undefined, 'mobile-app', installationHash)
  expect(replay.status).toBe(200)
  expect(replay.body).toMatchObject({ recoveryToken: joinedEntrySchema.parse(mobile.body).recoveryToken })
  for (const table of ['queue_entry_contact', 'consent', 'notification_outbox']) {
    expect(await env.DB.prepare(`SELECT 1 FROM ${table} n JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id=?`).bind(queue).first()).toBeNull()
  }
  expect(await env.DB.prepare('SELECT installation_hash FROM mobile_entry_installation m JOIN queue_entry e ON e.id=m.entry_id WHERE e.queue_id=?').bind(queue).first()).toEqual({ installation_hash: installationHash })
  const web = await joinQueue(bindings, queue, crypto.randomUUID(), { ...input, whatsapp: { consent: false } }, false, undefined, 'public-service')
  expect(web).toMatchObject({ status: 503, body: { error: 'whatsapp_unavailable' } })
})
it('uses the real coordinator for idempotent mobile join and isolates installations sharing a key', async () => {
  const { queue } = await fixture(), key = crypto.randomUUID()
  const responses = await Promise.all([join(queue, key), join(queue, key)])
  expect(responses.map(r => r.status).sort()).toEqual([200, 201])
  const first = joinedEntrySchema.parse(await responses[0]!.json())
  expect(joinedEntrySchema.parse(await responses[1]!.json()).recoveryToken).toBe(first.recoveryToken)
  expect((await join(queue, key, { ...input, displayName: 'Changed' })).status).toBe(409)
  const other = await join(queue, key, input, 'ab'.repeat(32))
  expect(other.status).toBe(201)
  expect(joinedEntrySchema.parse(await other.json()).recoveryToken).not.toBe(first.recoveryToken)
})
it('recovers active turns only for the secret owner, never from an installation hash', async () => {
  const { queue } = await fixture(), entry = await joined(queue)
  const list = await request('/mobile/entries')
  expect(list.headers.get('Cache-Control')).toBe('no-store')
  expect(list.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(await list.json()).toEqual({ entries: [{ serviceId: queue, locale: 'es', recoveryToken: entry.recoveryToken }] })
  expect(await (await request('/mobile/entries', {}, crypto.randomUUID().replaceAll('-', '').repeat(2))).json()).toEqual({ entries: [] })
  const path = `/mobile/entries/${entry.recoveryToken}`
  expect((await request(path)).status).toBe(200)
  expect((await request(path, {}, 'ab'.repeat(32))).status).toBe(404)
  expect((await request(path, {}, await hash(`mobile-installation:v1:${secret}`))).status).toBe(404)
  expect((await request(`/mobile/entries/${'00'.repeat(32)}`)).status).toBe(404)
})
it('authorizes versioned cancel commands, rejects other installations, preserves retry and removes inactive turns from recovery', async () => {
  const { queue } = await fixture(), entry = await joined(queue)
  const path = `/mobile/entries/${entry.recoveryToken}/commands`
  const command = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ action: 'cancel', version: entry.customer!.version }) }
  expect((await request(path, command, 'ab'.repeat(32))).status).toBe(404)
  expect((await request(path, command)).status).toBe(200)
  expect((await request(path, command)).status).toBe(200)
  expect(await (await request('/mobile/entries')).json()).toEqual({ entries: [] })
  expect(await (await request(`/mobile/entries/${entry.recoveryToken}`)).json()).toMatchObject({ status: 'cancelled' })
})
it.each([
  { whatsapp: { consent: false } }, { phone: '+34600000000' }, { installationId: 'fake' }, { source: 'mobile-app' }, { displayName: '' }, { partySize: 0 },
])('rejects invalid or injected mobile payload %j', async extra => {
  const { queue } = await fixture()
  expect((await join(queue, crypto.randomUUID(), { ...input, ...extra })).status).toBe(400)
})
it('requires a secret, bounds body and returns safe malformed JSON errors', async () => {
  expect((await request('/mobile/entries', { headers: { Authorization: '' } })).status).toBe(401)
  expect((await request('/mobile/entries', {}, 'guessable')).status).toBe(401)
  const { queue } = await fixture()
  expect((await request(`/mobile/services/${queue}/entries`, { method: 'POST', body: '{' })).status).toBe(400)
  expect((await request(`/mobile/services/${queue}/entries`, { method: 'POST', body: 'a'.repeat(2049) })).status).toBe(413)
})
it('allows only native preflights and never changes the web Origin guard', async () => {
  for (const origin of ['capacitor://localhost', 'https://localhost']) {
    const response = await request('/mobile/entries', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, idempotency-key' } })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  }
  expect((await request('/mobile/entries', { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
  expect((await request('/mobile/entries', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } })).status).toBe(403)
  const { queue } = await fixture()
  const response = await request(`/public/services/${queue}/entries`, { method: 'POST', body: JSON.stringify(input) })
  expect(response.status).toBe(403)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
})
it('retains reception/pool constraints and rejects closed services', async () => {
  const { queue } = await fixture()
  expect((await join(queue, crypto.randomUUID(), { ...input, receptionService: undefined })).status).toBe(400)
  const row = await env.DB.prepare('SELECT config FROM queue WHERE id=?').bind(queue).first<{ config: string }>()
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify({ ...JSON.parse(row!.config), type: 'pool', receptionServices: [] }), queue).run()
  expect((await join(queue, crypto.randomUUID(), { displayName: 'Guest', locale: 'es', partySize: 2 })).status).toBe(400)
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify({ ...JSON.parse(row!.config), twentyFourHours: false, schedules: [{ day: (new Date().getUTCDay() + 1) % 7, from: '00:00', to: '01:00' }] }), queue).run()
  expect((await join(queue, crypto.randomUUID(), input)).status).toBe(409)
})
it('limits enrollment by IP even if anonymous secrets rotate', async () => {
  const { queue } = await fixture()
  for (let i = 0; i < 10; i++)
    expect((await join(queue, crypto.randomUUID(), { ...input, phone: 'rejected' }, i.toString(16).padStart(64, '0'))).status).toBe(400)
  expect((await join(queue, crypto.randomUUID(), input, 'ff'.repeat(32))).status).toBe(429)
})
it('does not expose or admit services belonging to inactive tenants', async () => {
  const { queue } = await fixture(), entry = await joined(queue)
  await env.DB.prepare("UPDATE tenant_account SET status='suspended' WHERE organization_id=(SELECT v.organization_id FROM venue v JOIN queue q ON q.venue_id=v.id WHERE q.id=?)").bind(queue).run()
  expect((await join(queue)).status).toBe(404)
  expect((await request(`/mobile/services/${queue}`)).status).toBe(404)
  expect((await request(`/mobile/entries/${entry.recoveryToken}`)).status).toBe(404)
  expect(await (await request('/mobile/entries')).json()).toEqual({ error: 'active_turn_unavailable' })
})
it('does not allow the internal mobile source without an installation binding or with WhatsApp consent', async () => {
  const { queue } = await fixture()
  const base = { ...input, whatsapp: { consent: false as const } }
  expect((await joinQueue(env, queue, crypto.randomUUID(), base, false, undefined, 'mobile-app')).status).toBe(400)
  expect((await joinQueue(env, queue, crypto.randomUUID(), { ...input, whatsapp: { consent: true, phone: '+34600000000', version: 'whatsapp-public-service-updates-v1' } }, false, undefined, 'mobile-app', 'ab'.repeat(32))).status).toBe(400)
})
it('keeps committed mobile retries available after capacity changes, but rejects fresh joins', async () => {
  const { queue } = await fixture(), key = crypto.randomUUID()
  expect((await join(queue, key)).status).toBe(201)
  await env.DB.prepare('UPDATE queue SET capacity=1 WHERE id=?').bind(queue).run()
  expect((await join(queue, key)).status).toBe(200)
  expect((await join(queue)).status).toBe(409)
})
it('atomically admits only one concurrent turn across different queues and tenants', async () => {
  const a = await fixture(), b = await fixture()
  const results = await Promise.all([join(a.queue), join(b.queue)])
  expect(results.map(r => r.status).sort()).toEqual([201, 409])
  const winner = joinedEntrySchema.parse(await results.find(r => r.status === 201)!.json())
  expect(await results.find(r => r.status === 409)!.json()).toMatchObject({ error: 'active_turn_exists', entry: { recoveryToken: winner.recoveryToken } })
  const count = await env.DB.prepare('SELECT count(*) AS n FROM queue_entry e JOIN mobile_entry_installation m ON m.entry_id=e.id WHERE m.installation_hash=?').bind(await hash(`mobile-installation:v1:${secret}`)).first()
  expect(count).toEqual({ n: 1 })
})
it('replays an old committed key before exclusivity, without replacing the new active turn', async () => {
  const a = await fixture(), b = await fixture(), key = crypto.randomUUID()
  const first = joinedEntrySchema.parse(await (await join(a.queue, key)).json())
  await env.DB.prepare("UPDATE queue_entry SET status='cancelled' WHERE recovery_hash=?").bind(await hash(first.recoveryToken)).run()
  const second = await joined(b.queue)
  const replay = await join(a.queue, key)
  expect(replay.status).toBe(200)
  expect(await replay.json()).toMatchObject({ recoveryToken: first.recoveryToken, status: 'cancelled' })
  expect(await (await request('/mobile/entries')).json()).toMatchObject({ entries: [{ recoveryToken: second.recoveryToken }] })
})
it.each(['cancelled', 'served', 'expired', 'no_show', 'completed'])('releases exclusivity after %s', async status => {
  const a = await fixture(), b = await fixture()
  await joined(a.queue)
  await env.DB.prepare('UPDATE queue_entry SET status=? WHERE queue_id=?').bind(status, a.queue).run()
  expect((await join(b.queue)).status).toBe(201)
})
it('prevents reactivation of a previous terminal turn while another is active', async () => {
  const a = await fixture(), b = await fixture()
  await joined(a.queue)
  await env.DB.prepare("UPDATE queue_entry SET status='cancelled' WHERE queue_id=?").bind(a.queue).run()
  await joined(b.queue)
  await expect(env.DB.prepare("UPDATE queue_entry SET status='waiting' WHERE queue_id=?").bind(a.queue).run()).rejects.toThrow('mobile_active_turn_exists')
})
it('a suspended active turn blocks another admission without leaking its reference', async () => {
  const a = await fixture(), b = await fixture()
  await joined(a.queue)
  await env.DB.prepare("UPDATE tenant_account SET status='suspended' WHERE organization_id=(SELECT v.organization_id FROM venue v JOIN queue q ON q.venue_id=v.id WHERE q.id=?)").bind(a.queue).run()
  const response = await join(b.queue)
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'active_turn_unavailable' })
})
