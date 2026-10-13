import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, afterAll, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { loadQueueState, recalculateQueue, commitQueueTransition } from './projection'
import { readEntrySnapshot } from './entries'
import { serviceWindow } from '../staff/availability'
import { topology } from './opening-state'
import { hash, encryptPhone, phoneHash } from './crypto'
import { dispatchNotificationSerialized } from './notifications'
import { runQueueCommand } from '../staff/commands'
import { setupNetwork } from '../../../test/fake-network'

const network = setupNetwork()
beforeAll(() => network.enable())
afterAll(() => network.disable())
afterEach(() => network.resetHandlers())
const sendingEnv = { ...env, WHATSAPP_COPY_VERSION: '4' }
const endpoint = 'https://waba-sandbox.360dialog.io/v1/messages'
const minute = 60000
afterEach(() => vi.restoreAllMocks())
async function fixture(
  count = 3,
  type: 'reception' | 'restaurant' = 'reception',
  version: 1 | 2 = 2,
) {
  const now = Date.now(),
    queueId = crypto.randomUUID(),
    actor = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Test',?,datetime('now'),datetime('now'),'user')",
  )
    .bind(actor, `${actor}@test.invalid`)
    .run()
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenant_account(organization_id,created_by,status) VALUES ('demo-org',?,'active')",
  )
    .bind(actor)
    .run()
  await env.DB.prepare(
    "INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,'demo-org',?,'owner',datetime('now'))",
  )
    .bind(crypto.randomUUID(), actor)
    .run()
  await env.DB.prepare(
    "INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,'demo-venue','owner')",
  )
    .bind(actor)
    .run()
  const config: ServiceInput = {
    name: 'Adaptive',
    type,
    capacity: 99,
    averageMinutes: 4,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: ['other'],
    stations: 3,
    estimationMode: 'active',
    resourceStateKnown: true,
    estimatorVersion: version,
    approachMinutes: 2,
    spaces:
      type === 'restaurant'
        ? [
            {
              id: 'room',
              name: 'Room',
              tables: 3,
              tableTypes: [{ seats: 4, count: 3, averageMinutes: 4 }],
            },
          ]
        : [],
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes,open) VALUES (?,'demo-venue','Adaptive',?,99,4,1)",
  )
    .bind(queueId, JSON.stringify(config))
    .run()
  await env.DB.prepare(
    "INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)",
  )
    .bind(
      queueId,
      serviceWindow(config, 'Europe/Madrid', new Date(now)).windowId,
      now,
    )
    .run()
  if (type === 'restaurant')
    await env.DB.prepare(
      'INSERT INTO queue_opening(queue_id,topology,complete,opened_at,actor_id) VALUES (?,?,1,?,?)',
    )
      .bind(queueId, topology(config), now, actor)
      .run()
  const ids = Array.from({ length: count }, () => crypto.randomUUID())
  for (const [i, id] of ids.entries())
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,service_window_id) VALUES (?,?,?,?,?,?,2,'es',?,?,'continuous')",
    )
      .bind(id, queueId, id, id, await hash(id), id, now, i + 1)
      .run()
  await recalculateQueue(sendingEnv, queueId, now)
  for (const id of ids) {
    await env.DB.prepare("INSERT INTO consent VALUES (?,?,'demo-org','queue_updates','test-only',?,NULL)").bind(crypto.randomUUID(), id, now).run()
    await env.DB.prepare('INSERT INTO queue_entry_contact VALUES (?,?,?)').bind(id, await encryptPhone(env.PII_ENCRYPTION_KEY, '+34600000000'), await phoneHash(env, '+34600000000')).run()
  }
  return {
    now,
    queueId,
    actor,
    config,
    ids,
    read: (i: number) => readEntrySnapshot(env, ids[i]!),
    clock: (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(now + ms),
  }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function projection(f: Fixture) {
  return (await env.DB.prepare('SELECT * FROM queue_adaptive_projection WHERE entry_id=?').bind(f.ids[0]!).first<{ predicted_at: number; safety_review_at: number; approach_armed: number }>())!
}
async function notices(f: Fixture, kind = 'delayed') {
  return (await env.DB.prepare('SELECT id,status,attempts,call_cycle,payload_snapshot,next_attempt_at FROM notification_outbox WHERE entry_id=? AND kind=? ORDER BY rowid').bind(f.ids[0]!, kind).all<{ id: string; status: string; attempts: number; call_cycle: number; payload_snapshot: string; next_attempt_at: number }>()).results
}
async function tick(f: Fixture, offset: number) {
  f.clock(offset)
  await recalculateQueue(sendingEnv, f.queueId, Date.now())
}
async function change(f: Fixture, averageMinutes: number) {
  const before = await loadQueueState(sendingEnv, f.queueId, Date.now())
  const config = { ...before.config!, averageMinutes }
  await commitQueueTransition(sendingEnv, f.queueId, before, { config }, [env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queueId)], Date.now())
}
function provider() {
  const bodies: unknown[] = []
  network.use(http.post(endpoint, async ({ request }) => {
    bodies.push(await request.json())
    return HttpResponse.json({ messages: [{ id: `wamid.test.${crypto.randomUUID()}` }] })
  }))
  return bodies
}

it('delivers three safety extensions and subsequent approaches inside the old cooldown without training or duplicate reads', async () => {
  const f = await fixture(1)
  const bodies = provider()
  await tick(f, 2 * minute)
  await dispatchNotificationSerialized(sendingEnv, (await notices(f, 'approaching'))[0]!.id)
  for (let i = 0; i < 3; i++) {
    const next = await projection(f)
    await tick(f, next.safety_review_at - f.now)
    const event = (await notices(f))[i]!
    expect(JSON.parse(event.payload_snapshot).extensionSequence).toBe(i + 1)
    await Promise.all([dispatchNotificationSerialized(sendingEnv, event.id), dispatchNotificationSerialized(sendingEnv, event.id)])
    expect((await notices(f))[i]).toMatchObject({ status: 'accepted', attempts: 1 })
    const after = await projection(f)
    await tick(f, Date.now() - f.now)
    expect(await projection(f)).toEqual(after)
    expect(await notices(f)).toHaveLength(i + 1)
    await tick(f, after.predicted_at - 2 * minute - f.now)
    const approach = (await notices(f, 'approaching')).at(-1)!
    expect(approach.status).toBe('pending')
    await dispatchNotificationSerialized(sendingEnv, approach.id)
  }
  expect(bodies).toHaveLength(7)
  expect(JSON.stringify(bodies)).not.toMatch(/no tienes turnos|0 turnos/)
  expect((await env.DB.prepare('SELECT count(*) n FROM queue_wait_extension WHERE entry_id=?').bind(f.ids[0]!).first())?.n).toBe(3)
  expect((await env.DB.prepare('SELECT count(*) n FROM queue_assignment_observation WHERE queue_id=?').bind(f.queueId).first())?.n).toBe(0)
})

it('retains each queued extension across revisions, delivers in order and refreshes its first-attempt estimate', async () => {
  const f = await fixture(1)
  const bodies = provider()
  for (const m of [3, 6, 9]) await tick(f, m * minute)
  const pending = await notices(f)
  expect(pending.map(n => n.status)).toEqual(['pending', 'pending', 'pending'])
  await env.DB.prepare('UPDATE queue_projection SET revision=revision+7 WHERE entry_id=?').bind(f.ids[0]!).run()
  await dispatchNotificationSerialized(sendingEnv, pending[2]!.id)
  expect(bodies).toHaveLength(0)
  const current = await projection(f)
  for (const n of pending) await dispatchNotificationSerialized(sendingEnv, n.id)
  expect(bodies).toHaveLength(3)
  for (const n of await notices(f)) {
    expect(n.status).toBe('accepted')
    expect(JSON.parse(n.payload_snapshot)).toMatchObject({ predictedAt: current.predicted_at, ahead: 0 })
  }
  expect((await env.DB.prepare('SELECT previous_at,predicted_at FROM queue_wait_extension WHERE entry_id=? ORDER BY extension_sequence').bind(f.ids[0]!).all()).results[0]).toEqual({ previous_at: f.now + 4 * minute, predicted_at: f.now + 7 * minute })
})

it('notifies small configuration increases and an increase after improvement below the last accepted forecast', async () => {
  const f = await fixture(1)
  f.clock(0)
  const bodies = provider()
  await change(f, 5)
  await dispatchNotificationSerialized(sendingEnv, (await notices(f))[0]!.id)
  await change(f, 4)
  await change(f, 5)
  await dispatchNotificationSerialized(sendingEnv, (await notices(f))[1]!.id)
  expect(bodies).toHaveLength(2)
  expect((await notices(f)).every(n => n.status === 'accepted')).toBe(true)
  expect((await env.DB.prepare('SELECT count(*) n FROM queue_wait_extension WHERE entry_id=?').bind(f.ids[0]!).first())?.n).toBe(2)
})

it('cancels a recovered or paused delay before dispatch, without sending stale information', async () => {
  const f = await fixture(1)
  f.clock(0)
  const bodies = provider()
  await change(f, 5)
  await change(f, 4)
  await dispatchNotificationSerialized(sendingEnv, (await notices(f))[0]!.id)
  expect((await notices(f))[0]!.status).toBe('cancelled')
  await change(f, 6)
  await env.DB.prepare("UPDATE queue_admission SET override_state='paused' WHERE queue_id=?").bind(f.queueId).run()
  await dispatchNotificationSerialized(sendingEnv, (await notices(f))[1]!.id)
  expect((await notices(f))[1]!.status).toBe('cancelled')
  expect(bodies).toHaveLength(0)
})

it.each(['called', 'cancelled', 'completed', 'expired'])('retires pending extensions after status %s', async status => {
  const f = await fixture(1)
  const bodies = provider()
  await tick(f, 3 * minute)
  const n = (await notices(f))[0]!
  await env.DB.prepare('UPDATE queue_entry SET status=? WHERE id=?').bind(status, f.ids[0]!).run()
  await dispatchNotificationSerialized(sendingEnv, n.id)
  expect((await notices(f))[0]).toMatchObject({ status: 'cancelled', attempts: 0 })
  expect(bodies).toHaveLength(0)
})

it('preserves rate-limited retry payloads and queues newer extensions behind unresolved attempts', async () => {
  const f = await fixture(1)
  const bodies: unknown[] = []
  network.use(http.post(endpoint, async ({ request }) => {
    bodies.push(await request.json())
    return bodies.length === 1 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json({ messages: [{ id: `wamid.retry.${crypto.randomUUID()}` }] })
  }))
  await tick(f, 3 * minute)
  const first = (await notices(f))[0]!
  await dispatchNotificationSerialized(sendingEnv, first.id)
  const retry = (await notices(f))[0]!
  expect(retry.status).toBe('pending')
  expect(retry.attempts).toBe(1)
  await tick(f, 6 * minute)
  const second = (await notices(f))[1]!
  await dispatchNotificationSerialized(sendingEnv, second.id)
  expect(bodies).toHaveLength(1)
  await dispatchNotificationSerialized(sendingEnv, first.id)
  expect((await notices(f))[0]!.payload_snapshot).toBe(retry.payload_snapshot)
  expect(bodies[1]).toEqual(bodies[0])
  await dispatchNotificationSerialized(sendingEnv, second.id)
  expect(bodies).toHaveLength(3)
})

it('never resends unknown outcomes, but still delivers a distinct later extension; consent and cycles remain enforced', async () => {
  const f = await fixture(1)
  const bodies = provider()
  await tick(f, 3 * minute)
  const n = (await notices(f))[0]!
  await env.DB.prepare("UPDATE notification_outbox SET status='unknown',attempts=1 WHERE id=?").bind(n.id).run()
  await dispatchNotificationSerialized(sendingEnv, n.id)
  expect(bodies).toHaveLength(0)
  await tick(f, 6 * minute)
  const next = (await notices(f))[1]!
  await dispatchNotificationSerialized(sendingEnv, next.id)
  expect(bodies).toHaveLength(1)
  expect((await notices(f))[0]!.status).toBe('unknown')
  await tick(f, 9 * minute)
  const third = (await notices(f))[2]!
  await env.DB.prepare('UPDATE consent SET revoked_at=? WHERE entry_id=?').bind(Date.now(), f.ids[0]!).run()
  await dispatchNotificationSerialized(sendingEnv, third.id)
  expect(bodies).toHaveLength(1)
  await env.DB.prepare('UPDATE queue_entry SET call_cycle=call_cycle+1 WHERE id=?').bind(f.ids[0]!).run()
  await dispatchNotificationSerialized(sendingEnv, third.id)
  expect((await notices(f))[2]!.status).toBe('cancelled')
})

it('does not replay existing forecasts and rolls back extension events with the forecast transaction', async () => {
  const f = await fixture(1)
  f.clock(0)
  await recalculateQueue(sendingEnv, f.queueId, Date.now())
  expect(await notices(f)).toHaveLength(0)
  const before = await loadQueueState(sendingEnv, f.queueId, Date.now())
  const config = { ...before.config!, averageMinutes: 6 }
  await expect(commitQueueTransition(sendingEnv, f.queueId, before, { config }, [env.DB.prepare('INSERT INTO customer_command(entry_id,request_key,request_hash,result,created_at) VALUES (NULL,NULL,NULL,NULL,NULL)')], Date.now())).rejects.toThrow()
  expect(await notices(f)).toHaveLength(0)
  expect((await env.DB.prepare('SELECT count(*) n FROM queue_wait_extension WHERE entry_id=?').bind(f.ids[0]!).first())?.n).toBe(0)
  expect((await projection(f)).predicted_at).toBe(f.now + 4 * minute)
})

it('does not extend the arrival deadline when a human assigns and then confirms arrival', async () => {
  const f = await fixture(1)
  await tick(f, 3 * minute)
  const bodies = provider()
  await runQueueCommand(sendingEnv, f.actor, f.queueId, crypto.randomUUID(), { action: 'assign_next' }, Date.now())
  const called = await f.read(0)
  const deadline = f.now + 8 * minute
  expect(called?.customer?.arrivalDeadlineAt).toBe(deadline)
  await dispatchNotificationSerialized(sendingEnv, (await notices(f))[0]!.id)
  expect(bodies).toHaveLength(0)
  await runQueueCommand(sendingEnv, f.actor, f.queueId, crypto.randomUUID(), { action: 'complete', entryId: f.ids[0]!, version: 1 }, Date.now())
  expect((await f.read(0))?.status).toBe('completed')
  expect((await env.DB.prepare('SELECT arrival_deadline_at FROM queue_entry WHERE id=?').bind(f.ids[0]!).first())?.arrival_deadline_at).toBe(deadline)
})
