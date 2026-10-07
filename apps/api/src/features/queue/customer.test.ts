import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { runCustomerCommand, customerPhase, expireArrivals } from './customer'
import { hash } from './crypto'

async function fixture() {
  const queueId = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,capacity,average_minutes,name,config) VALUES (?,'demo-venue',99,30,'Restaurant',?)",
  )
    .bind(
      queueId,
      JSON.stringify({
        name: 'Restaurant',
        type: 'restaurant',
        capacity: 99,
        averageMinutes: 30,
        graceMinutes: 5,
        cutoffMinutes: 0,
        twentyFourHours: true,
        schedules: [],
        receptionServices: [],
        spaces: [
          {
            id: 'terrace',
            name: 'Terrace',
            tables: 1,
            tableTypes: [{ seats: 4, count: 1 }],
          },
          {
            id: 'bar',
            name: 'Bar',
            tables: 1,
            tableTypes: [{ seats: 2, count: 1 }],
          },
        ],
      }),
    )
    .run()
  const entries = []
  for (const [index, space] of ['terrace', 'bar', 'terrace'].entries()) {
    const id = crypto.randomUUID(),
      token = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,preferred_space_id) VALUES (?,?,?,?,?,?,2,'es',100,?,?)",
    )
      .bind(id, queueId, id, 'hash', await hash(token), id, index + 1, space)
      .run()
    entries.push({ id, token })
  }
  return { queueId, entries }
}
it('does not interpret unknown estimates as zero for approaching', () => {
  expect(customerPhase('waiting', 5, 0, 'unknown', {})).toBe('waiting')
  expect(customerPhase('waiting', 3, 99, 'estimated', {})).toBe('approaching')
  expect(customerPhase('waiting', 8, 10, 'provisional', {})).toBe('approaching')
  expect(customerPhase('served', 0, 0, 'unknown', {})).toBe('arrived')
})
it('atomically yields to the next compatible group and replays before version validation', async () => {
  const { queueId, entries } = await fixture(),
    key = crypto.randomUUID()
  const command = { action: 'yield' as const, version: 0 }
  await runCustomerCommand(env, queueId, entries[0]!.token, key, command)
  await runCustomerCommand(env, queueId, entries[0]!.token, key, command)
  const rows = (
    await env.DB.prepare(
      'SELECT id,sequence,version FROM queue_entry WHERE queue_id=? ORDER BY sequence',
    )
      .bind(queueId)
      .all()
  ).results
  expect(rows.map((r) => r.id)).toEqual([
    entries[2]!.id,
    entries[1]!.id,
    entries[0]!.id,
  ])
  expect(rows.map((r) => r.version)).toEqual([1, 0, 1])
  await expect(
    runCustomerCommand(env, queueId, entries[0]!.token, crypto.randomUUID(), {
      action: 'yield',
      version: 1,
    }),
  ).rejects.toThrow('no_compatible_successor')
  await expect(
    runCustomerCommand(env, queueId, entries[0]!.token, key, {
      action: 'cancel',
      version: 0,
    }),
  ).rejects.toThrow('idempotency_conflict')
})
it('edits preserve age and order, rejects stale versions and tokens from other queues', async () => {
  const { queueId, entries } = await fixture(),
    entry = entries[0]!
  await runCustomerCommand(env, queueId, entry.token, crypto.randomUUID(), {
    action: 'update',
    version: 0,
    displayName: 'Maria',
    partySize: 4,
    preferredSpaceId: 'terrace',
    locale: 'es',
  })
  expect(
    await env.DB.prepare(
      'SELECT sequence,created_at,party_size,version FROM queue_entry WHERE id=?',
    )
      .bind(entry.id)
      .first(),
  ).toEqual({ sequence: 1, created_at: 100, party_size: 4, version: 1 })
  await expect(
    runCustomerCommand(env, queueId, entry.token, crypto.randomUUID(), {
      action: 'cancel',
      version: 0,
    }),
  ).rejects.toThrow('version_conflict')
  await expect(
    runCustomerCommand(env, 'another-queue', entry.token, crypto.randomUUID(), {
      action: 'cancel',
      version: 1,
    }),
  ).rejects.toThrow('not_found')
})
it('expires at the persisted deadline exactly once and preserves legacy calls', async () => {
  const { queueId, entries } = await fixture()
  await env.DB.prepare(
    "UPDATE queue_entry SET status='called',called_at=100,arrival_deadline_at=1000 WHERE id=?",
  )
    .bind(entries[0]!.id)
    .run()
  await env.DB.prepare(
    "UPDATE queue_entry SET status='called',called_at=100 WHERE id=?",
  )
    .bind(entries[1]!.id)
    .run()
  await env.DB.prepare(
    "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at) VALUES (?,?,'terrace:4:0','terrace',4,100)",
  )
    .bind(entries[0]!.id, queueId)
    .run()
  await expireArrivals(env, queueId, 999)
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(entries[0]!.id)
        .first()
    )?.status,
  ).toBe('called')
  await expireArrivals(env, queueId, 1000)
  await expireArrivals(env, queueId, 1001)
  expect(
    await env.DB.prepare('SELECT status,version FROM queue_entry WHERE id=?')
      .bind(entries[0]!.id)
      .first(),
  ).toEqual({ status: 'expired', version: 1 })
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(entries[1]!.id)
        .first()
    )?.status,
  ).toBe('called')
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM queue_event WHERE entry_id=? AND kind='expired'",
      )
        .bind(entries[0]!.id)
        .first()
    )?.n,
  ).toBe(1)
  expect(
    (
      await env.DB.prepare(
        'SELECT released_at FROM queue_allocation WHERE entry_id=?',
      )
        .bind(entries[0]!.id)
        .first()
    )?.released_at,
  ).toBe(1000)
})

it('runs the durable alarm without a browser and repairs a missing alarm on coordinator refresh', async () => {
  const { runDurableObjectAlarm, runInDurableObject } = await import(
    'cloudflare:test'
  )
  const { queueId, entries } = await fixture()
  const deadline = Date.now() + 60000
  await env.DB.prepare(
    "UPDATE queue_entry SET status='called',arrival_deadline_at=? WHERE id=?",
  )
    .bind(deadline, entries[0]!.id)
    .run()
  const stub = env.QUEUE_COORDINATOR.getByName(queueId)
  await stub.refresh(queueId)
  expect(
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.getAlarm(),
    ),
  ).toBe(deadline)
  await runInDurableObject(stub, (_instance, state) =>
    state.storage.deleteAlarm(),
  )
  await stub.refresh(queueId)
  expect(
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.getAlarm(),
    ),
  ).toBe(deadline)
  await env.DB.prepare(
    'UPDATE queue_entry SET arrival_deadline_at=? WHERE id=?',
  )
    .bind(Date.now() - 1, entries[0]!.id)
    .run()
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(entries[0]!.id)
        .first()
    )?.status,
  ).toBe('expired')
  expect(await runDurableObjectAlarm(stub)).toBe(false)
})

it('projects service-specific waiting actions and no actions for called turns', async () => {
  const context = await import('./public-context')
  const service = {
    id: 'restaurant',
    name: 'Restaurant',
    venueId: 'demo-venue',
    venueName: 'Hotel',
    timezone: 'Europe/Madrid',
    open: 1,
    type: 'restaurant' as 'restaurant' | 'pool',
    receptionServices: [],
    spaces: [],
    averageWaitMinutes: null,
  }
  const publicService = vi
    .spyOn(context, 'publicService')
    .mockImplementation(async () => service)
  const { readEntrySnapshot } = await import('./entries')
  const { queueId, entries } = await fixture()
  await env.DB.prepare(
    "UPDATE queue SET config=json_set(config,'$.approachTurns',0,'$.approachMinutes',0) WHERE id=?",
  )
    .bind(queueId)
    .run()
  const waiting = await readEntrySnapshot(env, entries[2]!.token)
  expect(waiting?.customer?.phase).toBe('waiting')
  expect(waiting?.customer?.actions).toEqual(['update', 'cancel', 'yield'])
  await env.DB.prepare("UPDATE queue_entry SET status='called' WHERE id=?")
    .bind(entries[2]!.id)
    .run()
  expect(
    (await readEntrySnapshot(env, entries[2]!.token))?.customer?.actions,
  ).toEqual([])
  service.type = 'pool'
  expect(
    (await readEntrySnapshot(env, entries[1]!.token))?.customer?.actions,
  ).toEqual(['cancel', 'yield'])
  publicService.mockRestore()
})

it.each(['reception', 'pool'])(
  'supports %s cancellation and synthetic-resource yield, but not editing',
  async (type) => {
    const { queueId, entries } = await fixture()
    await env.DB.prepare(
      "UPDATE queue SET config=json_set(config,'$.type',?,'$.spaces',json('[]'),'$.receptionServices',json('[\"check_in\"]')) WHERE id=?",
    )
      .bind(type, queueId)
      .run()
    await env.DB.prepare(
      'UPDATE queue_entry SET preferred_space_id=NULL WHERE queue_id=?',
    )
      .bind(queueId)
      .run()
    const token = entries[0]!.token
    await expect(
      runCustomerCommand(env, queueId, token, crypto.randomUUID(), {
        action: 'update',
        version: 0,
        displayName: 'Guest',
        partySize: 1,
        preferredSpaceId: 'fastest',
        locale: 'en',
      }),
    ).rejects.toThrow('unsupported_service')
    const key = crypto.randomUUID()
    await runCustomerCommand(env, queueId, token, key, {
      action: 'yield',
      version: 0,
    })
    await runCustomerCommand(env, queueId, token, key, {
      action: 'yield',
      version: 0,
    })
    expect(
      await env.DB.prepare(
        'SELECT sequence,version,party_size FROM queue_entry WHERE id=?',
      )
        .bind(entries[0]!.id)
        .first(),
    ).toEqual({ sequence: 2, version: 1, party_size: 2 })
    await expect(
      runCustomerCommand(env, queueId, token, crypto.randomUUID(), {
        action: 'cancel',
        version: 0,
      }),
    ).rejects.toThrow('version_conflict')
    const cancelKey = crypto.randomUUID()
    await runCustomerCommand(env, queueId, token, cancelKey, {
      action: 'cancel',
      version: 1,
    })
    await runCustomerCommand(env, queueId, token, cancelKey, {
      action: 'cancel',
      version: 1,
    })
    expect(
      await env.DB.prepare('SELECT status,version FROM queue_entry WHERE id=?')
        .bind(entries[0]!.id)
        .first(),
    ).toEqual({ status: 'cancelled', version: 2 })
    await expect(
      runCustomerCommand(env, queueId, entries[2]!.token, crypto.randomUUID(), {
        action: 'yield',
        version: 0,
      }),
    ).rejects.toThrow('no_compatible_successor')
  },
)
