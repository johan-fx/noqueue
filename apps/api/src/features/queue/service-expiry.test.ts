import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => vi.useRealTimers())
import type { ServiceInput } from '@noqueue/contracts/staff'
import { serviceDeadline } from '../staff/availability'
import { maintainServiceEntries } from './service-expiry'

const config: ServiceInput = {
  name: 'Lunch', type: 'reception', capacity: 30, averageMinutes: 10,
  graceMinutes: 2, cutoffMinutes: 15, twentyFourHours: false,
  schedules: [{ day: 1, from: '12:00', to: '15:00' }],
  receptionServices: ['other'], spaces: [],
}
async function fixture(service = config) {
  const queueId = crypto.randomUUID(), actor = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Test',?,datetime('now'),datetime('now'),'user')").bind(actor, `${actor}@test.invalid`).run()
  await env.DB.prepare("INSERT OR IGNORE INTO tenant_account(organization_id,created_by,status) VALUES ('demo-org',?,'active')").bind(actor).run()
  await env.DB.prepare("INSERT INTO queue(id,venue_id,name,capacity,average_minutes,config) VALUES (?,'demo-venue','Lunch',30,10,?)")
    .bind(queueId, JSON.stringify(service)).run()
  return queueId
}
async function ticket(queueId: string, status = 'waiting', end: number | null = null, window: string | null = null) {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status,service_window_id,service_ends_at) VALUES (?,?,?,?,?,?,1,'en',?,(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?),?,?,?)")
    .bind(id, queueId, id, id, id, id, Date.now(), queueId, status, window, end).run()
  return id
}
it('binds adjacent service coverage to the physical end, not admission cutoff', () => {
  const joined = new Date('2026-09-21T10:00:00Z')
  const adjacent = { ...config, schedules: [...config.schedules, { day: 1, from: '15:00', to: '18:00' }] }
  expect(serviceDeadline(adjacent, 'Europe/Madrid', joined)?.endsAt).toBe(Date.parse('2026-09-21T16:00:00Z'))
  expect(serviceDeadline(config, 'Europe/Madrid', new Date('2026-09-21T12:50:00Z'))?.endsAt).toBe(Date.parse('2026-09-21T13:00:00Z'))
  expect(serviceDeadline({ ...config, twentyFourHours: true }, 'Europe/Madrid', joined)?.endsAt).toBeNull()
})
it('handles skipped closing times and both occurrences of repeated closing times', () => {
  const sunday = { ...config, schedules: [{ day: 0, from: '01:00', to: '02:30' }] }
  expect(serviceDeadline(sunday, 'Europe/Madrid', new Date('2026-03-29T00:30:00Z'))?.endsAt).toBe(Date.parse('2026-03-29T01:00:00Z'))
  expect(serviceDeadline(sunday, 'Europe/Madrid', new Date('2026-10-25T00:10:00Z'))?.endsAt).toBe(Date.parse('2026-10-25T00:30:00Z'))
  expect(serviceDeadline(sunday, 'Europe/Madrid', new Date('2026-10-25T01:10:00Z'))?.endsAt).toBe(Date.parse('2026-10-25T01:30:00Z'))
})
it('finds late local closures west of UTC on a DST transition day', () => {
  const sunday = { ...config, schedules: [{ day: 0, from: '00:00', to: '23:59' }] }
  expect(serviceDeadline(sunday, 'America/New_York', new Date('2026-03-08T05:10:00Z'))?.endsAt).toBe(Date.parse('2026-03-09T03:59:00Z'))
  expect(serviceDeadline(sunday, 'America/New_York', new Date('2026-11-01T04:10:00Z'))?.endsAt).toBe(Date.parse('2026-11-02T04:59:00Z'))
})
it('cancels a due waiting turn once, preserves called/completed turns and notification evidence', async () => {
  const queueId = await fixture(), end = Date.parse('2026-09-21T13:00:00Z')
  const id = await ticket(queueId, 'waiting', end, 'snapshot'), called = await ticket(queueId, 'called', end, 'snapshot'), completed = await ticket(queueId, 'completed', end, 'snapshot')
  for (const status of ['pending', 'sending', 'unknown', 'delivered'])
    await env.DB.prepare('INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), id, crypto.randomUUID(), status, end, 'approaching').run()
  await maintainServiceEntries(env, queueId, end)
  await maintainServiceEntries(env, queueId, end + 1)
  expect(await env.DB.prepare('SELECT status,version FROM queue_entry WHERE id=?').bind(id).first()).toEqual({ status: 'cancelled', version: 1 })
  expect((await env.DB.prepare('SELECT kind FROM queue_event WHERE entry_id=?').bind(id).all()).results).toEqual([{ kind: 'service_ended' }])
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id IN (?,?) ORDER BY status').bind(called, completed).all()).results).toEqual([{ status: 'called' }, { status: 'completed' }])
  expect((await env.DB.prepare('SELECT status FROM notification_outbox WHERE entry_id=? ORDER BY status').bind(id).all()).results).toEqual([{ status: 'cancelled' }, { status: 'delivered' }, { status: 'sending' }, { status: 'unknown' }])
})
it('initializes legacy waiting only according to current physical open/closed policy', async () => {
  const queueId = await fixture(), open = Date.parse('2026-09-21T12:50:00Z'), close = Date.parse('2026-09-21T13:00:00Z')
  const id = await ticket(queueId), called = await ticket(queueId, 'called')
  await maintainServiceEntries(env, queueId, open)
  expect(await env.DB.prepare('SELECT status,service_ends_at FROM queue_entry WHERE id=?').bind(id).first()).toEqual({ status: 'waiting', service_ends_at: close })
  const old = await ticket(queueId)
  await maintainServiceEntries(env, queueId, close)
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id IN (?,?)').bind(id, old).all()).results).toEqual([{ status: 'cancelled' }, { status: 'cancelled' }])
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(called).first())?.status).toBe('called')
})
it('preserves bound snapshots across schedule edits, including continuous admission', async () => {
  const queueId = await fixture(), future = Date.parse('2026-09-21T15:00:00Z')
  const finite = await ticket(queueId, 'waiting', future, 'old-window'), continuous = await ticket(queueId, 'waiting', null, 'continuous:old')
  await maintainServiceEntries(env, queueId, Date.parse('2026-09-21T13:30:00Z'))
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id IN (?,?)').bind(finite, continuous).all()).results).toEqual([{ status: 'waiting' }, { status: 'waiting' }])
})
it('coordinator refresh repairs a missing service alarm and races cleanup without duplicate events', async () => {
  const { runInDurableObject, runDurableObjectAlarm } = await import('cloudflare:test')
  const queueId = await fixture({ ...config, twentyFourHours: true })
  const id = await ticket(queueId, 'waiting', Date.now() + 60000, 'snapshot')
  const stub = env.QUEUE_COORDINATOR.getByName(queueId)
  await stub.refresh(queueId)
  expect(await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm())).toBeGreaterThan(Date.now())
  await runInDurableObject(stub, (_instance, state) => state.storage.deleteAlarm())
  await stub.refresh(queueId)
  expect(await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm())).not.toBeNull()
  await env.DB.prepare('UPDATE queue_entry SET service_ends_at=? WHERE id=?').bind(Date.now() - 1, id).run()
  await Promise.all([runDurableObjectAlarm(stub), stub.refresh(queueId)])
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(id).first())?.status).toBe('cancelled')
  expect((await env.DB.prepare("SELECT id FROM queue_event WHERE entry_id=? AND kind='service_ended'").bind(id).all()).results).toHaveLength(1)
})
it('admission metadata excludes overdue snapshots and closed unresolved legacy without writing', async () => {
  const { admissionState } = await import('../staff/availability')
  const queueId = await fixture(), close = Date.parse('2026-09-21T13:00:00Z')
  const legacy = await ticket(queueId), due = await ticket(queueId, 'waiting', close, 'snapshot')
  await ticket(queueId, 'waiting', null, 'continuous:original')
  expect((await admissionState(env, queueId, new Date(close)))?.waitingPeople).toBe(1)
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id IN (?,?)').bind(legacy, due).all()).results).toEqual([{ status: 'waiting' }, { status: 'waiting' }])
})
it('join replay reloads cancelled status and keeps identity while a new key creates a new turn', async () => {
  const { joinQueue } = await import('./entries')
  const queueId = await fixture({ ...config, twentyFourHours: true }), key = crypto.randomUUID()
  const input = { partySize: 1, locale: 'en' as const, whatsapp: { consent: false as const } }
  const first = await joinQueue(env, queueId, key, input)
  expect(first.status).toBe(201)
  await env.DB.prepare("UPDATE queue_entry SET service_window_id='old',service_ends_at=? WHERE queue_id=?").bind(Date.now() - 1, queueId).run()
  const replay = await joinQueue(env, queueId, key, input)
  expect(replay.body).toMatchObject({ status: 'cancelled', recoveryToken: (first.body as { recoveryToken: string }).recoveryToken, customer: { cancellationReason: 'service_ended', actions: [] } })
  expect((await joinQueue(env, queueId, crypto.randomUUID(), input)).status).toBe(201)
})
it('initial join returns persisted cancellation when service closes during its insert', async () => {
  const { joinQueue } = await import('./entries')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-21T12:44:00Z'))
  const queueId = await fixture(), key = crypto.randomUUID()
  const input = { partySize: 1, locale: 'en' as const, whatsapp: { consent: false as const } }
  let crossed = false
  const DB = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
        const result = await target.batch(statements)
        const inserted = await target.prepare('SELECT id FROM queue_entry WHERE queue_id=?').bind(queueId).first()
        if (inserted && !crossed) {
          crossed = true
          vi.setSystemTime(new Date('2026-09-21T13:00:00Z'))
        }
        return result
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const first = await joinQueue({ ...env, DB }, queueId, key, input)
  expect(first.status).toBe(201)
  const stored = await env.DB.prepare('SELECT id,code,status,version FROM queue_entry WHERE queue_id=?').bind(queueId).first<{ id: string; code: string; status: string; version: number }>()
  expect(stored).toMatchObject({ status: 'cancelled', version: 1 })
  expect(first.body).toMatchObject({ code: stored!.code, status: 'cancelled', customer: { phase: 'cancelled', version: 1, cancellationReason: 'service_ended', actions: [] } })
  expect((await env.DB.prepare("SELECT id FROM queue_event WHERE entry_id=? AND kind='service_ended'").bind(stored!.id).all()).results).toHaveLength(1)
  const replay = await joinQueue(env, queueId, key, input)
  expect(replay.body).toMatchObject({ code: stored!.code, status: 'cancelled', recoveryToken: (first.body as { recoveryToken: string }).recoveryToken })
})
it('coordinator scheduled sweep clears due turns without an open browser', async () => {
  const worker = (await import('../../index')).default
  const queueId = await fixture({ ...config, twentyFourHours: true }), id = await ticket(queueId, 'waiting', Date.now() - 1, 'snapshot')
  await worker.scheduled({} as ScheduledController, env)
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(id).first())?.status).toBe('cancelled')
})
it('does not cancel at cutoff or pause, and separates lunch from dinner', async () => {
  const queueId = await fixture({ ...config, schedules: [...config.schedules, { day: 1, from: '19:00', to: '22:00' }] })
  const id = await ticket(queueId), cutoff = Date.parse('2026-09-21T12:50:00Z')
  const { serviceWindow, admissionState } = await import('../staff/availability')
  const source = JSON.parse((await env.DB.prepare('SELECT config FROM queue WHERE id=?').bind(queueId).first<{ config: string }>())!.config) as ServiceInput
  const at = Date.parse('2026-09-21T10:10:00Z')
  await env.DB.prepare("INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'paused',?)").bind(queueId, serviceWindow(source, 'Europe/Madrid', new Date(at)).windowId, at).run()
  await env.DB.prepare('UPDATE queue SET open=0 WHERE id=?').bind(queueId).run()
  await maintainServiceEntries(env, queueId, at)
  expect((await admissionState(env, queueId, new Date(at)))?.blockReason).toBe('paused')
  await maintainServiceEntries(env, queueId, cutoff)
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(id).first())?.status).toBe('waiting')
  await maintainServiceEntries(env, queueId, Date.parse('2026-09-21T17:00:00Z'))
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(id).first())?.status).toBe('cancelled')
})
it('leaves invalid legacy configuration untouched and initializes continuous provenance', async () => {
  const queueId = await fixture({ ...config, twentyFourHours: true }), id = await ticket(queueId)
  await maintainServiceEntries(env, queueId)
  expect((await env.DB.prepare('SELECT service_window_id FROM queue_entry WHERE id=?').bind(id).first())?.service_window_id).toMatch(/^continuous:/)
  const invalid = await ticket(queueId)
  await env.DB.prepare("UPDATE queue SET config='invalid-json' WHERE id=?").bind(queueId).run()
  await maintainServiceEntries(env, queueId)
  expect(await env.DB.prepare('SELECT status,service_window_id FROM queue_entry WHERE id=?').bind(invalid).first()).toEqual({ status: 'waiting', service_window_id: null })
})
it('preserves called grace and restaurant occupied resources after the service deadline', async () => {
  const restaurant = { ...config, type: 'restaurant' as const, twentyFourHours: true, receptionServices: [], spaces: [{ id: 'main', name: 'Main', tables: 1, tableTypes: [{ seats: 2, count: 1 }] }] }
  const queueId = await fixture(restaurant), end = Date.now() - 1
  const called = await ticket(queueId, 'called', end, 'finite'), completed = await ticket(queueId, 'completed', end, 'finite')
  await env.DB.prepare('UPDATE queue_entry SET arrival_deadline_at=? WHERE id=?').bind(Date.now() + 60000, called).run()
  await env.DB.prepare('INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,?,?,\'main\',2,?,?)')
    .bind(completed, queueId, 'main:2:0', end - 10000, end - 5000).run()
  await env.QUEUE_COORDINATOR.getByName(queueId).refresh(queueId)
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(called).first())?.status).toBe('called')
  expect((await env.DB.prepare('SELECT released_at FROM queue_allocation WHERE entry_id=?').bind(completed).first())?.released_at).toBeNull()
})
it('rejects restore outside original validity with version conflicts retaining precedence', async () => {
  const { runQueueCommand } = await import('../staff/commands')
  const queueId = await fixture({ ...config, twentyFourHours: true })
  const actor = (await env.DB.prepare("SELECT created_by FROM tenant_account WHERE organization_id='demo-org'").first<{ created_by: string }>())!.created_by
  await env.DB.prepare("INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,'demo-org',?,'owner',datetime('now'))").bind(crypto.randomUUID(), actor).run()
  await env.DB.prepare("INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,'demo-venue','owner')").bind(actor).run()
  const id = await ticket(queueId, 'expired', Date.now() - 1, 'finite')
  await expect(runQueueCommand(env, actor, queueId, crypto.randomUUID(), { action: 'restore', entryId: id, version: 1, overrideReason: 'Customer returned' })).rejects.toThrow('version_conflict')
  await expect(runQueueCommand(env, actor, queueId, crypto.randomUUID(), { action: 'restore', entryId: id, version: 0, overrideReason: 'Customer returned' })).rejects.toThrow('invalid_transition')
  const continuous = await ticket(queueId, 'expired', null, 'continuous:original')
  await runQueueCommand(env, actor, queueId, crypto.randomUUID(), { action: 'restore', entryId: continuous, version: 0, overrideReason: 'Customer returned' })
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(continuous).first())?.status).toBe('waiting')
})
it('public discovery excludes due and closed legacy counts before cleanup without modifying tickets', async () => {
  const { searchServices } = await import('../discovery/search')
  const { directoryConfigStatement } = await import('../discovery/configuration')
  const queueId = await fixture(), close = Date.parse('2026-09-21T13:00:00Z')
  await env.DB.prepare("UPDATE venue SET address_formatted='Test',latitude=40,longitude=-3,location_confirmed_at=?,location_attribution='[]' WHERE id='demo-venue'").bind(close).run()
  await directoryConfigStatement(env, queueId, JSON.stringify(config)).run()
  const legacy = await ticket(queueId), due = await ticket(queueId, 'waiting', close, 'finite')
  await ticket(queueId, 'waiting', null, 'continuous:original')
  const { publicSearchSchema } = await import('@noqueue/contracts/discovery')
  const result = await searchServices(env, publicSearchSchema.parse({}), close)
  expect(result.items.find((item) => item.id === queueId)?.waitingPeople).toBe(1)
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id IN (?,?)').bind(legacy, due).all()).results).toEqual([{ status: 'waiting' }, { status: 'waiting' }])
})
it('uses non-hour timezone offsets and does not hide an actual overnight schedule gap', () => {
  const nepal = { ...config, schedules: [{ day: 1, from: '12:00', to: '15:00' }] }
  expect(serviceDeadline(nepal, 'Asia/Kathmandu', new Date('2026-09-21T06:30:00Z'))?.endsAt).toBe(Date.parse('2026-09-21T09:15:00Z'))
  const overnight = { ...config, schedules: [{ day: 1, from: '22:00', to: '23:59' }, { day: 2, from: '00:00', to: '02:00' }] }
  expect(serviceDeadline(overnight, 'Europe/Madrid', new Date('2026-09-21T21:00:00Z'))?.endsAt).toBe(Date.parse('2026-09-21T21:59:00Z'))
})

it('snapshots finite admission and preserves it after hours are edited', async () => {
  const { joinQueue } = await import('./entries')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-21T10:00:00Z'))
  const queueId = await fixture()
  const input = { partySize: 1, locale: 'en' as const, whatsapp: { consent: false as const } }
  const first = await joinQueue(env, queueId, crypto.randomUUID(), input)
  expect(first.status).toBe(201)
  const stored = await env.DB.prepare('SELECT service_window_id,service_ends_at FROM queue_entry WHERE queue_id=?').bind(queueId).first<{ service_window_id: string; service_ends_at: number }>()
  expect(stored?.service_window_id).toContain('2026-09-21:12:00:15:00')
  expect(stored?.service_ends_at).toBe(Date.parse('2026-09-21T13:00:00Z'))
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify({ ...config, schedules: [{ day: 1, from: '12:00', to: '13:00' }] }), queueId).run()
  vi.setSystemTime(new Date('2026-09-21T11:30:00Z'))
  await maintainServiceEntries(env, queueId)
  expect((await env.DB.prepare('SELECT status,service_ends_at FROM queue_entry WHERE queue_id=?').bind(queueId).first())).toEqual({ status: 'waiting', service_ends_at: Date.parse('2026-09-21T13:00:00Z') })
})
