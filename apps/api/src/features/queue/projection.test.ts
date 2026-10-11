// Explicit v1 fixtures retain rollback regressions; default v2 is covered by adaptive-estimator.test.ts.
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { loadQueueState, recalculateQueue } from './projection'
it('persists shared projections and deduplicated intents without delivery', async () => {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,'demo-venue',20,30,1,'Resources',?)",
  )
    .bind(
      id,
      JSON.stringify({
        name: 'Resources',
        estimatorVersion: 1 as const,
        type: 'restaurant',
        capacity: 20,
        averageMinutes: 30,
        graceMinutes: 5,
        cutoffMinutes: 0,
        twentyFourHours: true,
        schedules: [],
        receptionServices: [],
        estimationMode: 'active',
        resourceStateKnown: true,
        spaces: [
          {
            id: 'terrace',
            name: 'Terrace',
            tables: 1,
            tableTypes: [{ seats: 4, count: 1, averageMinutes: 70 }],
          },
          {
            id: 'salon',
            name: 'Salon',
            tables: 1,
            tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
          },
        ],
      }),
    )
    .run()
  for (let i = 1; i <= 3; i++)
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,?,2,'en',?,?)",
    )
      .bind(
        crypto.randomUUID(),
        id,
        crypto.randomUUID(),
        'hash',
        crypto.randomUUID(),
        crypto.randomUUID(),
        Date.now(),
        i,
      )
      .run()
  const state = await loadQueueState(env, id)
  expect(state.resources.map((r) => r.averageMinutes)).toEqual([70, 20])
  await recalculateQueue(env, id)
  await recalculateQueue(env, id)
  const rows = await env.DB.prepare(
    'SELECT * FROM queue_projection WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?) ORDER BY position',
  )
    .bind(id)
    .all<{ eta_minutes: number }>()
  expect(rows.results.map((r) => r.eta_minutes)).toEqual([0, 0, 20])
  expect(
    (
      await env.DB.prepare(
        'SELECT COUNT(*) n FROM queue_estimate_intent WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)',
      )
        .bind(id)
        .first<{ n: number }>()
    )?.n,
  ).toBe(3)
  const policyStates = await env.DB.prepare(
    'SELECT DISTINCT status FROM queue_estimate_intent WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)',
  )
    .bind(id)
    .all<{ status: string }>()
  expect(policyStates.results.map((row) => row.status)).toEqual([
    'policy_evaluated',
  ])
})

it('keeps unknown legacy spaces provisional and inherits size defaults independently', async () => {
  const { normalizeConfig } = await import('./projection')
  const config = normalizeConfig({
    name: 'Legacy',
    estimatorVersion: 1 as const,
        type: 'restaurant',
    capacity: 90,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: [],
    spaces: [
      { name: 'Terrace', tables: 1, tableTypes: [{ seats: 4, count: 1 }] },
      { name: 'Salon', tables: 1, tableTypes: [{ seats: 4, count: 1 }] },
      { name: 'Old', tables: 9 },
    ],
    queueBySeat: [{ seats: 4, averageMinutes: 45, capacity: 50 }],
    assignmentPreference: 'Salon',
  })
  expect(config.spaces.map((s) => s.id)).toEqual([
    'legacy-0',
    'legacy-1',
    'legacy-2',
  ])
  expect(
    config.spaces.slice(0, 2).map((s) => s.tableTypes?.[0]?.averageMinutes),
  ).toEqual([45, 45])
  expect(config.assignmentPreference).toBe('legacy-1')
  expect(config.queueBySeat?.[0]?.capacity).toBe(50)
})

it('recalculates an expired group adjustment without a queue event and never frees overdue actual occupancy', async () => {
  const now = Date.now(),
    id = crypto.randomUUID(),
    entryId = crypto.randomUUID()
  const config = {
    name: 'Expiry',
    estimatorVersion: 1 as const,
        type: 'restaurant',
    capacity: 99,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: ['check_in'],
    spaces: [
      {
        id: 'reception',
        name: 'Room',
        tables: 1,
        tableTypes: [{ seats: 100, count: 1 }],
      },
    ],
    stations: 1,
    estimationMode: 'active',
    resourceStateKnown: true,
    adjustments: [
      {
        spaceId: 'reception',
        seats: 100,
        minutes: 60,
        reason: 'Temporary delay',
        expiresAt: now + 60000,
      },
    ],
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,'demo-venue',99,30,1,'Expiry',?)",
  )
    .bind(id, JSON.stringify(config))
    .run()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,2,'en',?,1,'completed')",
  )
    .bind(entryId, id, entryId, 'hash', entryId, entryId, now)
    .run()
  await env.DB.prepare(
    "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,?,'reception:100:0','reception',100,?,?)",
  )
    .bind(entryId, id, now, now)
    .run()
  const before = await recalculateQueue(env, id, now)
  expect(before.resources[0]?.averageMinutes).toBe(60)
  const after = await recalculateQueue(env, id, now + 60000)
  expect(after.resources[0]?.averageMinutes).toBe(30)
  const overdue = await recalculateQueue(env, id, now + 31 * 60000)
  expect(overdue.resources[0]?.availableAt).toBeNull()
  expect(overdue.allocations[0]?.released_at).toBeNull()
})
it('emits approaching on the time threshold even inside the legacy position cutoff', async () => {
  const start = 1_800_000_000_000
  const queueId = crypto.randomUUID()
  const activeEntryId = crypto.randomUUID()
  const waitingEntryIds = Array.from({ length: 3 }, () => crypto.randomUUID())
  const config = {
    name: 'Approach threshold',
    estimatorVersion: 1 as const,
        type: 'restaurant',
    capacity: 20,
    averageMinutes: 3,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: [],
    estimationMode: 'active',
    resourceStateKnown: true,
    approachTurns: 2,
    approachMinutes: 8,
    spaces: [
      {
        id: 'desk',
        name: 'Desk',
        tables: 1,
        tableTypes: [{ seats: 100, count: 1, averageMinutes: 3 }],
      },
    ],
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,'demo-venue',20,3,1,'Approach threshold',?)",
  )
    .bind(queueId, JSON.stringify(config))
    .run()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,1,'en',?,0,'arrived')",
  )
    .bind(activeEntryId, queueId, activeEntryId, 'hash', activeEntryId, 'ACTIVE', start)
    .run()
  for (const [index, entryId] of waitingEntryIds.entries())
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,1,'en',?,?,'waiting')",
    )
      .bind(entryId, queueId, entryId, 'hash', entryId, `WAIT${index}`, start, index + 1)
      .run()
  await env.DB.prepare(
    'INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,? ,\'desk:100:0\',\'desk\',100,?,?)',
  )
    .bind(activeEntryId, queueId, start - 60_000, start - 60_000)
    .run()
  const venue = await env.DB.prepare(
    'SELECT organization_id FROM venue WHERE id=\'demo-venue\'',
  ).first<{ organization_id: string }>()
  await env.DB.prepare('INSERT INTO consent VALUES (?,?,?,?,?,?,NULL)')
    .bind(
      crypto.randomUUID(),
      waitingEntryIds[2],
      venue!.organization_id,
      'queue_updates',
      'test-explicit-consent',
      start,
    )
    .run()

  const before = await recalculateQueue(env, queueId, start)
  const targetBefore = before.projections.find(
    (projection) => projection.id === waitingEntryIds[2],
  )
  expect(targetBefore?.position).toBe(3)
  expect(targetBefore?.predictedAt).toBe(start + 8 * 60_000)
  expect(targetBefore?.etaMinutes).toBe(8)
  const atThreshold = await recalculateQueue(env, queueId, start + 60_000)
  expect(
    atThreshold.projections.find(
      (projection) => projection.id === waitingEntryIds[2],
    )?.etaMinutes,
  ).toBe(7)
  const emitted = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notification_outbox WHERE entry_id=? AND kind='approaching'",
  )
    .bind(waitingEntryIds[2])
    .first<{ n: number }>()
  expect(emitted?.n).toBe(1)

  await recalculateQueue(env, queueId, start + 60_000)
  const stillDeduplicated = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notification_outbox WHERE entry_id=? AND kind='approaching'",
  )
    .bind(waitingEntryIds[2])
    .first<{ n: number }>()
  expect(stillDeduplicated?.n).toBe(1)
})
it('preserves legacy group identities when an older client reorders spaces without IDs', async () => {
  const { normalizeConfig } = await import('./projection')
  const original = {
    name: 'Old client',
    estimatorVersion: 1 as const,
        type: 'restaurant' as const,
    capacity: 20,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: [],
    spaces: [
      { name: 'Terrace', tables: 1 },
      { name: 'Salon', tables: 1 },
    ],
  }
  const previous = normalizeConfig(original)
  const reordered = normalizeConfig(
    { ...original, spaces: [original.spaces[1]!, original.spaces[0]!] },
    previous,
  )
  expect(reordered.spaces.map((s) => s.id)).toEqual(['legacy-1', 'legacy-0'])
})

it('records duration-adjustment expiry as an operational improvement at fixed current time', async () => {
  const start = 1_900_000_000_000,
    queueId = crypto.randomUUID()
  const config = {
    name: 'Desk',
    estimatorVersion: 1 as const,
    type: 'reception',
    capacity: 99,
    averageMinutes: 30,
    graceMinutes: 2,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: ['other'],
    spaces: [],
    adjustments: [
      {
        spaceId: 'reception',
        seats: 100,
        minutes: 60,
        reason: 'Temporary duration',
        expiresAt: start + 60_000,
      },
    ],
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes) VALUES (?,'demo-venue','Desk',?,99,30)",
  )
    .bind(queueId, JSON.stringify(config))
    .run()
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  for (const [i, id] of ids.entries())
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,service_window_id) VALUES (?,?,?,?,?,?,1,'en',?,?,'continuous:test')",
    )
      .bind(id, queueId, id, id, id, id, start, i + 1)
      .run()
  await recalculateQueue(env, queueId, start)
  await recalculateQueue(env, queueId, start + 60_000)
  expect(
    (
      await env.DB.prepare(
        'SELECT operational_forecast_delta_ms FROM queue_projection WHERE entry_id=?',
      )
        .bind(ids[1])
        .first()
    )?.operational_forecast_delta_ms,
  ).toBe(-30 * 60_000)
})

it('accumulates signed fixed-time changes and never increments on clock refresh', async () => {
  const { commitQueueTransition } = await import('./projection')
  const start = 1_900_000_000_000,
    queueId = crypto.randomUUID()
  const config = {
    name: 'Desk',
    estimatorVersion: 1 as const,
    type: 'reception' as const,
    capacity: 99,
    averageMinutes: 60,
    graceMinutes: 2,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: ['other' as const],
    spaces: [],
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes) VALUES (?,'demo-venue','Desk',?,99,60)",
  )
    .bind(queueId, JSON.stringify(config))
    .run()
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  for (const [i, id] of ids.entries())
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,service_window_id) VALUES (?,?,?,?,?,?,1,'en',?,?,'continuous:test')",
    )
      .bind(id, queueId, id, id, id, id, start, i + 1)
      .run()
  await recalculateQueue(env, queueId, start)
  for (const elapsed of [20, 40, 60])
    await recalculateQueue(env, queueId, start + elapsed * 60_000)
  const row = () =>
    env.DB.prepare(
      'SELECT operational_forecast_delta_ms,revision FROM queue_projection WHERE entry_id=?',
    )
      .bind(ids[1])
      .first<{ operational_forecast_delta_ms: number; revision: number }>()
  expect(await row()).toMatchObject({
    operational_forecast_delta_ms: 0,
    revision: 1,
  })
  for (const minutes of [62, 64, 66, 60]) {
    const now = start + 65 * 60_000
    const before = await loadQueueState(env, queueId, now)
    const next = { ...config, averageMinutes: minutes }
    await commitQueueTransition(
      env,
      queueId,
      before,
      {
        config: next,
        allocations: before.allocations,
        parties: before.parties,
        holds: before.holds,
      },
      [
        env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(
          JSON.stringify(next),
          queueId,
        ),
      ],
      now,
    )
    expect((await row())?.operational_forecast_delta_ms).toBe(
      (minutes - 60) * 60_000,
    )
  }
})

it('rolls back legacy quick-allocation retirement when canonical projection persistence fails', async () => {
  const start = 1_900_000_000_000,
    queueId = crypto.randomUUID(),
    waiting = crypto.randomUUID(),
    legacy = crypto.randomUUID()
  const config = {
    name: 'Legacy desk',
    estimatorVersion: 1 as const,
    type: 'reception',
    capacity: 99,
    averageMinutes: 30,
    graceMinutes: 2,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: ['other'],
    spaces: [],
    estimationMode: 'active',
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes) VALUES (?,'demo-venue','Legacy desk',?,99,30)"
  )
    .bind(queueId, JSON.stringify(config))
    .run()
  for (const [index, id] of [waiting, legacy].entries())
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status,service_window_id) VALUES (?,?,?,?,?,?,1,'en',?,?,?,'continuous:test')"
    )
      .bind(
        id,
        queueId,
        id,
        id,
        id,
        id,
        start,
        index + 1,
        index ? 'completed' : 'waiting'
      )
      .run()
  await recalculateQueue(env, queueId, start)
  await env.DB.prepare(
    "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,?,'reception:100:0','reception',100,?,?)"
  )
    .bind(legacy, queueId, start, start)
    .run()
  const DB = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'batch')
        return (statements: D1PreparedStatement[]) =>
          target.batch([
            ...statements,
            target.prepare(
              'INSERT INTO customer_command(entry_id,request_key,request_hash,result,created_at) VALUES (NULL,NULL,NULL,NULL,NULL)'
            ),
          ])
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  await expect(
    recalculateQueue({ ...env, DB }, queueId, start + 1000)
  ).rejects.toThrow()
  expect(
    (
      await env.DB.prepare(
        'SELECT released_at FROM queue_allocation WHERE entry_id=?'
      )
        .bind(legacy)
        .first()
    )?.released_at
  ).toBeNull()
  expect(
    (
      await env.DB.prepare(
        'SELECT updated_at FROM queue_projection WHERE entry_id=?'
      )
        .bind(waiting)
        .first()
    )?.updated_at
  ).toBe(start)
  await recalculateQueue(env, queueId, start + 1000)
  expect(
    (
      await env.DB.prepare(
        'SELECT released_at FROM queue_allocation WHERE entry_id=?'
      )
        .bind(legacy)
        .first()
    )?.released_at
  ).toBe(start + 1000)
  expect(
    (
      await env.DB.prepare(
        'SELECT operational_forecast_delta_ms FROM queue_projection WHERE entry_id=?'
      )
        .bind(waiting)
        .first()
    )?.operational_forecast_delta_ms
  ).toBe(0)
})
