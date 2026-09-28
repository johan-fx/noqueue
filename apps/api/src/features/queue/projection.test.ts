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
})

it('keeps unknown legacy spaces provisional and inherits size defaults independently', async () => {
  const { normalizeConfig } = await import('./projection')
  const config = normalizeConfig({
    name: 'Legacy',
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
    type: 'reception',
    capacity: 99,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: ['check_in'],
    spaces: [],
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
it('preserves legacy group identities when an older client reorders spaces without IDs', async () => {
  const { normalizeConfig } = await import('./projection')
  const original = {
    name: 'Old client',
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
