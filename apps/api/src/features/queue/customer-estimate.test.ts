// Explicit v1 fixtures retain rollback regressions; default v2 is covered by adaptive-estimator.test.ts.
import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import { loadQueueState, recalculateQueue, commitQueueTransition } from './projection'
import { readEntrySnapshot } from './entries'
import { hash } from './crypto'
import { publicService } from './public-context'
import { publicCustomerAverage } from './customer-estimate'
import { assignmentContext } from '../staff/assignment'
import { serviceWindow } from '../staff/availability'

afterEach(() => vi.restoreAllMocks())
async function fixture(type: 'reception' | 'restaurant' = 'reception', count = 3) {
  const now = Date.now(), queueId = crypto.randomUUID(), actor = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Test',?,datetime('now'),datetime('now'),'user')").bind(actor, `${actor}@test.invalid`).run()
  await env.DB.prepare("INSERT OR IGNORE INTO tenant_account(organization_id,created_by,status) VALUES ('demo-org',?,'active')").bind(actor).run()
  const config = {
    name: 'Minimum estimate', estimatorVersion: 1 as const, type, capacity: 99, averageMinutes: 4,
    graceMinutes: 5, cutoffMinutes: 0, twentyFourHours: true, schedules: [],
    receptionServices: ['other' as const], stations: 3,
    estimationMode: 'active' as const, resourceStateKnown: true,
    spaces: type === 'restaurant' ? [{ id: 'room', name: 'Room', tables: 3, tableTypes: [{ seats: 4, count: 3, averageMinutes: 4 }] }] : [],
  }
  await env.DB.prepare("INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes,open) VALUES (?,'demo-venue','Minimum',?,99,4,1)").bind(queueId, JSON.stringify(config)).run()
  await env.DB.prepare('INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,? ,\'active\',?)').bind(queueId, serviceWindow(config, 'Europe/Madrid', new Date(now)).windowId, now).run()
  const ids = Array.from({ length: count }, () => crypto.randomUUID())
  for (const [i, id] of ids.entries())
    await env.DB.prepare("INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,service_window_id) VALUES (?,?,?,?,?,?,2,'en',?,?,'continuous')").bind(id, queueId, id, id, await hash(id), id, now, i + 1).run()
  return { now, queueId, config, ids, read: (i: number) => readEntrySnapshot(env, ids[i]!) }
}
it.each([
  [
    'rounds a fractional mean like the reported 5.223 minutes down',
    { sum: 5.223045783132531, count: 1, provisional: false, waiting: 1, active: true, configuredMinutes: 4, adaptive: true },
    5,
    'estimated',
  ],
  [
    'rounds an exact half-minute upward',
    { sum: 5.5, count: 1, provisional: false, waiting: 1, active: true, configuredMinutes: 4, adaptive: true },
    6,
    'estimated',
  ],
  [
    'preserves the one-minute minimum for a counted sub-minute adaptive mean',
    { sum: 0.25, count: 1, provisional: false, waiting: 1, active: true, configuredMinutes: 4, adaptive: true },
    1,
    'estimated',
  ],
  [
    'rounds a fractional adaptive configured fallback without counted turns',
    { sum: 0, count: 0, provisional: false, waiting: 0, active: true, configuredMinutes: 5.223045783132531, adaptive: true },
    5,
    'provisional',
  ],
  [
    'rounds an exact half-minute adaptive configured fallback upward',
    { sum: 0, count: 0, provisional: false, waiting: 0, active: true, configuredMinutes: 5.5, adaptive: true },
    6,
    'provisional',
  ],
  [
    'rounds the legacy configured fallback to the nearest minute',
    { sum: 0, count: 0, provisional: false, waiting: 0, active: true, configuredMinutes: 5.223045783132531, adaptive: false },
    5,
    'provisional',
  ],
  [
    'preserves unknown when a queue has waiters but no credible estimate',
    { sum: 0, count: 0, provisional: false, waiting: 1, active: true, configuredMinutes: 5.223045783132531, adaptive: true },
    null,
    'unknown',
  ],
])('%s', (_name, input, averageWaitMinutes, averageWaitQuality) => {
  expect(publicCustomerAverage(input)).toEqual({ averageWaitMinutes, averageWaitQuality })
})
it('uses the same serial 4/8/12 forecast for customers and staff regardless of resource inventory', async () => {
  const f = await fixture()
  await recalculateQueue(env, f.queueId, f.now)
  expect((await Promise.all(f.ids.map((_, i) => f.read(i)))).map(e => e?.etaMinutes)).toEqual([4, 8, 12])
  expect((await loadQueueState(env, f.queueId, f.now)).projections.map(p => p.etaMinutes)).toEqual([4, 8, 12])
  expect((await loadQueueState(env, f.queueId, f.now)).resources).toEqual([])
  expect((await f.read(0))?.initialEtaMinutes).toBe(4)
})
it('approaches at the inclusive threshold before any assignment safety review is due', async () => {
  const f = await fixture('reception', 5)
  const config = { ...f.config, averageMinutes: 50, approachMinutes: 249 }
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queueId).run()
  await recalculateQueue(env, f.queueId, f.now)
  expect(await f.read(4)).toMatchObject({ etaMinutes: 250, customer: { phase: 'waiting' } })
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 60000)
  await recalculateQueue(env, f.queueId, Date.now())
  expect(await f.read(4)).toMatchObject({ etaMinutes: 249, customer: { phase: 'approaching' } })
})
it('keeps occupied historical inventory out of both the estimate and assignment gate', async () => {
  const f = await fixture('restaurant')
  for (let i = 0;i < 3;i++) await env.DB.prepare('INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?, ?, ?,4,?)').bind(f.queueId, `room:4:${i}`, 'room', f.now).run()
  await recalculateQueue(env, f.queueId, f.now)
  expect(await f.read(0)).toMatchObject({ etaMinutes: 4, estimateQuality: 'provisional', predictedAt: f.now + 240000 })
  const state = await loadQueueState(env, f.queueId, f.now)
  expect(state.allocations).toEqual([])
  expect(state.resources).toEqual([])
  expect((await assignmentContext(state, f.ids[0]!, f.now)).available).toBe(true)
})
it('keeps deadlines stable on clock refresh and adjusts only changed configured work', async () => {
  const f = await fixture()
  await recalculateQueue(env, f.queueId, f.now)
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 60000)
  await recalculateQueue(env, f.queueId, f.now + 60000)
  expect((await f.read(1))?.predictedAt).toBe(f.now + 8 * 60000)
  const before = await loadQueueState(env, f.queueId, f.now + 60000)
  await commitQueueTransition(env, f.queueId, before, { ...before, parties: before.parties.slice(1) }, [env.DB.prepare("UPDATE queue_entry SET status='cancelled' WHERE id=?").bind(f.ids[0])], f.now + 60000)
  expect((await f.read(1))?.predictedAt).toBe(f.now + 4 * 60000)
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 2 * 60000)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await f.read(1))?.predictedAt).toBe(f.now + 4 * 60000)
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 20 * 60000)
  await recalculateQueue(env, f.queueId, f.now + 20 * 60000)
  expect((await f.read(1))?.predictedAt).toBe(f.now + 30 * 60000)
  expect((await env.DB.prepare('SELECT delay_reason FROM queue_adaptive_projection WHERE entry_id=?').bind(f.ids[1]).first())?.delay_reason).toBe('safety')
  await recalculateQueue(env, f.queueId, f.now + 20 * 60000)
  expect((await f.read(1))?.predictedAt).toBe(f.now + 30 * 60000)
})
it('returns public mean customer waits and the configured minimum for empty active queues', async () => {
  const f = await fixture('reception', 2)
  await recalculateQueue(env, f.queueId, f.now)
  expect(await publicService(env, f.queueId)).toMatchObject({ averageWaitMinutes: 6, averageWaitQuality: 'provisional' })
  await env.DB.prepare("UPDATE queue_entry SET status='cancelled' WHERE queue_id=?").bind(f.queueId).run()
  expect(await publicService(env, f.queueId)).toMatchObject({ averageWaitMinutes: 4, averageWaitQuality: 'provisional' })
})
it('keeps serial deadlines stable until a safety review and never advances them by resource slots', async () => {
  const f = await fixture()
  const config = { ...f.config, stations: 1 }
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queueId).run()
  await recalculateQueue(env, f.queueId, f.now)
  const anchor = await env.DB.prepare('SELECT predicted_at FROM queue_forecast_anchor WHERE entry_id=?').bind(f.ids[1]).first()
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 60000)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await f.read(1))?.predictedAt).toBe(f.now + 8 * 60000)
  expect((await f.read(1))?.etaMinutes).toBe(7)
  // With no assignments by the first slot's deadline, safety review protects
  // downstream estimates rather than letting the queue run into zero.
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 4 * 60000)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await f.read(1))?.predictedAt).toBe(f.now + 12 * 60000)
  expect((await env.DB.prepare('SELECT delay_reason FROM queue_adaptive_projection WHERE entry_id=?').bind(f.ids[1]).first())?.delay_reason).toBe('safety')
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await f.read(1))?.predictedAt).toBe(f.now + 12 * 60000)
  expect(await env.DB.prepare('SELECT predicted_at FROM queue_forecast_anchor WHERE entry_id=?').bind(f.ids[1]).first()).toEqual(anchor)
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE entry_id=? AND kind IN ('delayed','improved','ready')").bind(f.ids[1]).first())?.n).toBe(0)
})
it('keeps legacy unknown backfill silent and does not rewrite historical anchors', async () => {
  const f = await fixture('restaurant', 1)
  for (let i = 0;i < 3;i++) await env.DB.prepare('INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?, ?, ?,4,?)').bind(f.queueId, `room:4:${i}`, 'room', f.now).run()
  await env.DB.prepare("INSERT INTO queue_projection(entry_id,position,eta_minutes,predicted_at,quality,resource_id,callable,revision,updated_at) VALUES (?,1,0,NULL,'unknown',NULL,0,2,?)").bind(f.ids[0], f.now - 3600000).run()
  await env.DB.prepare("INSERT INTO consent VALUES (?,?, 'demo-org','queue_updates','test-only',?,NULL)").bind(crypto.randomUUID(), f.ids[0], f.now).run()
  await env.DB.prepare('INSERT INTO queue_forecast_anchor(entry_id,predicted_at,created_at,legacy_eta_minutes) VALUES (?,?,?,0)').bind(f.ids[0], f.now - 3600000, f.now - 3600000).run()
  await recalculateQueue(env, f.queueId, f.now)
  expect(await f.read(0)).toMatchObject({ etaMinutes: 4, estimateQuality: 'provisional' })
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE entry_id=?').bind(f.ids[0]).first())?.n).toBe(0)
  expect((await env.DB.prepare('SELECT predicted_at FROM queue_forecast_anchor WHERE entry_id=?').bind(f.ids[0]).first())?.predicted_at).toBe(f.now - 3600000)
})
it('starts a new joined turn and its frozen WhatsApp at the same minimum, approaches only once', async () => {
  const { joinQueue } = await import('./entries')
  const f = await fixture('reception', 0)
  // Opening/activating the service initializes v2 before the first customer;
  // this prevents first-join activation from being mistaken for migration.
  await recalculateQueue(env, f.queueId, f.now)
  const result = await joinQueue(env, f.queueId, crypto.randomUUID(), { partySize: 1, locale: 'en', whatsapp: { consent: true, phone: '+34600000000', version: 'whatsapp-queue-updates-v1' } })
  expect(result.status).toBe(201)
  expect(result.body).toMatchObject({ etaMinutes: 4, initialEtaMinutes: 4, estimateQuality: 'provisional' })
  const rows = (await env.DB.prepare("SELECT n.kind,n.payload_snapshot FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id=? ORDER BY n.rowid").bind(f.queueId).all<{ kind: string; payload_snapshot: string }>()).results
  expect(rows.map(r => r.kind)).toEqual(['queue_joined', 'approaching'])
  expect(JSON.parse(rows[0]!.payload_snapshot)).toMatchObject({ etaMinutes: 4, estimateQuality: 'provisional' })
  for (let i = 1;i <= 30;i++) await recalculateQueue(env, f.queueId, f.now + i * 60000)
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id=? AND n.kind='approaching'").bind(f.queueId).first())?.n).toBe(1)
})
it('rolls back minimum initialization with projection and operational changes', async () => {
  const f = await fixture()
  const before = await loadQueueState(env, f.queueId, f.now)
  await expect(commitQueueTransition(env, f.queueId, before, { ...before, config: { ...f.config, averageMinutes: 8 } }, [env.DB.prepare('INSERT INTO customer_command(entry_id,request_key,request_hash,result,created_at) VALUES (NULL,NULL,NULL,NULL,NULL)')], f.now)).rejects.toThrow()
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM queue_projection WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)').bind(f.queueId).first())?.n).toBe(0)
})
it('uses configured cadence changes, not historic occupancy, to rebase estimates', async () => {
  const f = await fixture('restaurant', 1)
  const occupied = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,2,'en',?,0,'completed')").bind(occupied, f.queueId, occupied, occupied, occupied, occupied, f.now).run()
  for (let i = 1;i < 3;i++) await env.DB.prepare('INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?, ?, ?,4,?)').bind(f.queueId, `room:4:${i}`, 'room', f.now).run()
  await env.DB.prepare("INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,?,'room:4:0','room',4,?,?)").bind(occupied, f.queueId, f.now, f.now).run()
  const config = { ...f.config, spaces: [{ ...f.config.spaces[0]!, tableTypes: [{ seats: 4, count: 3, averageMinutes: 20 }] }] }
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queueId).run()
  await recalculateQueue(env, f.queueId, f.now)
  expect(await f.read(0)).toMatchObject({ etaMinutes: 20 })
  const firstPrediction = (await f.read(0))?.predictedAt
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 60000)
  const before = await loadQueueState(env, f.queueId, Date.now())
  const next = { ...config, spaces: [{ ...config.spaces[0]!, tableTypes: [{ seats: 4, count: 3, averageMinutes: 40 }] }] }
  await commitQueueTransition(env, f.queueId, before, { ...before, config: next }, [env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(next), f.queueId)], Date.now())
  expect(await f.read(0)).toMatchObject({ etaMinutes: 39 })
  expect((await f.read(0))?.predictedAt).toBe(firstPrediction! + 20 * 60000)
  expect((await loadQueueState(env, f.queueId, Date.now())).resources).toEqual([])
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM queue_allocation WHERE entry_id=?').bind(occupied).first())?.n).toBe(1)
})
it('corrects configured-work changes when raw scheduling stays unchanged, and obsoletes compensated intents', async () => {
  const f = await fixture()
  await env.DB.prepare("INSERT INTO consent VALUES (?,?,'demo-org','queue_updates','test-only',?,NULL)").bind(crypto.randomUUID(), f.ids[1], f.now).run()
  const { encryptPhone } = await import('./crypto')
  await env.DB.prepare('INSERT INTO queue_entry_contact VALUES (?,?,?)').bind(f.ids[1], await encryptPhone(env.PII_ENCRYPTION_KEY, '+34600000000'), 'test-only-hash').run()
  await recalculateQueue(env, f.queueId, f.now)
  await env.DB.prepare('INSERT INTO queue_notification_state(entry_id,last_accepted_predicted_at,updated_at,last_accepted_operational_delta_ms,last_accepted_customer_minimum_at) VALUES (?,?,?,0,?)').bind(f.ids[1], f.now + 8 * 60000, f.now, f.now + 8 * 60000).run()
  const change = async (minutes: number) => {
    const before = await loadQueueState(env, f.queueId, f.now)
    const config = { ...f.config, averageMinutes: minutes }
    await commitQueueTransition(env, f.queueId, before, { ...before, config }, [env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queueId)], f.now)
  }
  await change(8)
  expect(await f.read(1)).toMatchObject({ etaMinutes: 16 })
  expect((await env.DB.prepare('SELECT operational_forecast_delta_ms FROM queue_projection WHERE entry_id=?').bind(f.ids[1]).first())?.operational_forecast_delta_ms).toBe(0)
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE entry_id=? AND kind='delayed'").bind(f.ids[1]).first())?.n).toBe(1)
  const obsolete = await env.DB.prepare("SELECT id FROM notification_outbox WHERE entry_id=? AND kind='delayed'").bind(f.ids[1]).first<{ id: string }>()
  await change(4)
  const { dispatchNotificationSerialized } = await import('./notifications')
  await dispatchNotificationSerialized(env, obsolete!.id)
  expect(await env.DB.prepare('SELECT status,attempts FROM notification_outbox WHERE id=?').bind(obsolete!.id).first()).toEqual({ status: 'cancelled', attempts: 0 })
  expect(await f.read(1)).toMatchObject({ etaMinutes: 8 })
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE entry_id=? AND kind='improved'").bind(f.ids[1]).first())?.n).toBe(0)
})
it('ignores legacy availability adjustments when estimating a serial queue', async () => {
  const f = await fixture('restaurant', 1)
  for (let i = 0;i < 3;i++) await env.DB.prepare('INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?, ?, ?,4,?)').bind(f.queueId, `room:4:${i}`, 'room', f.now).run()
  await recalculateQueue(env, f.queueId, f.now)
  const before = await loadQueueState(env, f.queueId, f.now + 60000)
  const next = { ...f.config, adjustments: [{ spaceId: 'room', seats: 4, kind: 'availability' as const, minutes: 10, reason: 'Test known release', expiresAt: f.now + 15 * 60000 }] }
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 60000)
  await commitQueueTransition(env, f.queueId, before, { ...before, config: next }, [env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(next), f.queueId)], Date.now())
  expect(await f.read(0)).toMatchObject({ etaMinutes: 3, predictedAt: f.now + 4 * 60000 })
  expect(await env.DB.prepare('SELECT predicted_at,cadence_ms FROM queue_adaptive_projection WHERE entry_id=?').bind(f.ids[0]).first()).toMatchObject({ predicted_at: f.now + 4 * 60000, cadence_ms: 4 * 60000 })
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 2 * 60000)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await f.read(0))?.predictedAt).toBe(f.now + 4 * 60000)
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM queue_external_occupancy WHERE queue_id=?').bind(f.queueId).first())?.n).toBe(3)
})
it('ignores a legacy availability hold before the no-progress safety review', async () => {
  const f = await fixture('reception', 1)
  await recalculateQueue(env, f.queueId, f.now)
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 60000)
  const before = await loadQueueState(env, f.queueId, Date.now())
  const config = { ...f.config, adjustments: [{ spaceId: 'reception', seats: 100, kind: 'availability' as const, minutes: 40, reason: 'Legacy resource hold', expiresAt: f.now + 15 * 60000 }] }
  await commitQueueTransition(env, f.queueId, before, { ...before, config }, [env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queueId)], Date.now())
  expect(await f.read(0)).toMatchObject({ predictedAt: f.now + 4 * 60000, etaMinutes: 3 })
  expect((await env.DB.prepare('SELECT operational_forecast_delta_ms FROM queue_projection WHERE entry_id=?').bind(f.ids[0]).first())?.operational_forecast_delta_ms).toBe(0)
  expect((await env.DB.prepare('SELECT cadence_ms FROM queue_adaptive_projection WHERE entry_id=?').bind(f.ids[0]).first())?.cadence_ms).toBe(4 * 60000)
})
it('preserves historical occupancy but does not let it create an ETA floor', async () => {
  const f = await fixture('restaurant', 1)
  await recalculateQueue(env, f.queueId, f.now)
  const initialDeadline = (await f.read(0))?.predictedAt
  const anchor = await env.DB.prepare('SELECT predicted_at FROM queue_forecast_anchor WHERE entry_id=?').bind(f.ids[0]).first()
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 60000)
  const before = await loadQueueState(env, f.queueId, Date.now())
  const holds = [0, 1, 2].map(i => ({ resource_id: `room:4:${i}`, space_id: 'room', seats: 4 }))
  await commitQueueTransition(env, f.queueId, before, { ...before, holds }, holds.map(h => env.DB.prepare('INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?,?,?,?,?)').bind(f.queueId, h.resource_id, h.space_id, h.seats, Date.now())), Date.now())
  expect((await f.read(0))?.predictedAt).toBe(initialDeadline)
  vi.spyOn(Date, 'now').mockReturnValue(f.now + 2 * 60000)
  const unknown = await loadQueueState(env, f.queueId, Date.now())
  const config = { ...f.config, adjustments: [{ spaceId: 'room', seats: 4, kind: 'availability' as const, minutes: 10, reason: 'New credible availability', expiresAt: f.now + 50 * 60000 }] }
  await commitQueueTransition(env, f.queueId, unknown, { ...unknown, config }, [env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queueId)], Date.now())
  expect((await f.read(0))?.predictedAt).toBe(initialDeadline)
  expect((await env.DB.prepare('SELECT operational_forecast_delta_ms FROM queue_projection WHERE entry_id=?').bind(f.ids[0]).first())?.operational_forecast_delta_ms).toBe(0)
  expect((await env.DB.prepare('SELECT predicted_at FROM queue_forecast_anchor WHERE entry_id=?').bind(f.ids[0]).first())?.predicted_at).toEqual(anchor?.predicted_at)
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM queue_external_occupancy WHERE queue_id=?').bind(f.queueId).first())?.n).toBe(3)
  expect((await loadQueueState(env, f.queueId, Date.now())).resources).toEqual([])
})
