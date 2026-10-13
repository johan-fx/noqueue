import { assignmentContext } from '../staff/assignment'
import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { loadQueueState, recalculateQueue } from './projection'
import { readEntrySnapshot } from './entries'
import { runQueueCommand } from '../staff/commands'
import { runCustomerCommand } from './customer'
import { serviceWindow } from '../staff/availability'
import { topology } from './opening-state'
import { hash } from './crypto'
import {
  cadenceFactor,
  contextKey,
  resolveEstimateContext,
  forecastInterval,
  compatibleSuccessor,
} from './adaptive-model'
const minute = 60000
afterEach(() => vi.restoreAllMocks())
async function fixture(
  count = 3,
  type: 'reception' | 'restaurant' = 'restaurant',
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
  await recalculateQueue(env, queueId, now)
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

async function configure(f: Awaited<ReturnType<typeof fixture>>) {
  f.config.averageMinutes = 8
  f.config.spaces = [
    {
      id: 'inside',
      name: 'Interior',
      tables: 2,
      tableTypes: [
        { seats: 2, count: 1, averageMinutes: 4 },
        { seats: 4, count: 1, averageMinutes: 6 },
      ],
    },
    {
      id: 'outside',
      name: 'Terraza',
      tables: 2,
      tableTypes: [
        { seats: 2, count: 1, averageMinutes: 4 },
        { seats: 4, count: 1, averageMinutes: 12 },
      ],
    },
  ]
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify(f.config), f.queueId)
    .run()
}
async function assign(
  f: Awaited<ReturnType<typeof fixture>>,
  i: number,
  at: number,
  zone: string | null,
  size = 2,
) {
  f.clock(at)
  await env.DB.prepare(
    'UPDATE queue_entry SET preferred_space_id=?,party_size=? WHERE id=?',
  )
    .bind(zone, size, f.ids[i]!)
    .run()
  await runQueueCommand(
    env,
    f.actor,
    f.queueId,
    crypto.randomUUID(),
    { action: 'call', entryId: f.ids[i]!, version: 0 },
    Date.now(),
  )
}
it('resolves the smallest fitting requested type, falls back generally and never asserts a predicted zone', async () => {
  const f = await fixture()
  await configure(f)
  expect(
    resolveEstimateContext(
      { partySize: 3, preferredSpaceId: 'inside' },
      f.config,
      8,
    ),
  ).toEqual({
    spaceId: 'inside',
    seats: 4,
    baselineMinutes: 6,
    provenance: 'inferred',
  })
  expect(
    resolveEstimateContext(
      { partySize: 10, preferredSpaceId: 'inside' },
      f.config,
      8,
    ),
  ).toEqual({
    spaceId: 'inside',
    seats: null,
    baselineMinutes: 8,
    provenance: 'general',
  })
  for (const preferredSpaceId of [null, 'fastest']) {
    expect(
      resolveEstimateContext({ partySize: 2, preferredSpaceId }, f.config, 8),
    ).toEqual({
      spaceId: null,
      seats: null,
      baselineMinutes: 8,
      provenance: 'general',
    })
    expect(
      forecastInterval({ partySize: 2, preferredSpaceId }, f.config, 8, {
        service: 1,
        learned: false,
        zones: new Map(),
        types: new Map(),
      }).cadenceMs,
    ).toBe(4 * minute)
  }
  expect(
    compatibleSuccessor(
      { partySize: 2 },
      { partySize: 1, preferredSpaceId: 'inside' },
      { spaceId: null, seats: null, baselineMinutes: 8, provenance: 'general' },
    ),
  ).toBe(false)
})
it('learns hierarchical contexts from consecutive human service assignments, not separated same-zone timestamps', async () => {
  const f = await fixture(14)
  await configure(f)
  const minutes = [0, 1, 9, 10, 18, 19, 27, 28, 36]
  for (const [i, t] of minutes.entries())
    await assign(f, i, t * minute, i % 2 ? 'inside' : 'outside')
  const rows = (
    await env.DB.prepare(
      'SELECT source,provenance,space_id,seats,interval_ms,ratio,resource_id FROM queue_assignment_observation WHERE queue_id=? ORDER BY assigned_at',
    )
      .bind(f.queueId)
      .all<{
        space_id: string
        ratio: number | null
        interval_ms: number | null
      }>()
  ).results
  expect(rows).toHaveLength(9)
  expect(rows[0]!.ratio).toBeNull()
  expect(rows.slice(1).map((r) => r.interval_ms)).toEqual(
    [1, 8, 1, 8, 1, 8, 1, 8].map((t) => t * minute),
  )
  expect(rows[1]).toMatchObject({
    source: 'staff',
    provenance: 'inferred',
    space_id: 'inside',
    seats: 2,
    resource_id: null,
    ratio: 0.25,
  })
  const state = await loadQueueState(env, f.queueId, Date.now())
  const service = cadenceFactor([0.25, 2, 0.25, 2, 0.25, 2, 0.25, 2])
  const zone = cadenceFactor([0.25, 0.25, 0.25, 0.25], service)
  expect(state.adaptive!.factors.service).toBeCloseTo(service)
  expect(state.adaptive!.factors.zones.get('inside')).toBeCloseTo(zone)
  expect(
    state.adaptive!.factors.types.get(contextKey('inside', 2)),
  ).toBeCloseTo(cadenceFactor([0.25, 0.25, 0.25, 0.25], zone))
  expect(
    state.adaptive!.factors.types.get(contextKey('inside', 4)),
  ).toBeCloseTo(zone)
  expect(state.adaptive!.factors.zones.get('outside')).toBeGreaterThan(zone)
  await recalculateQueue(env, f.queueId, Date.now() + 1000)
  expect(
    (await env.DB.prepare(
      'SELECT count(*) AS n FROM queue_assignment_observation WHERE queue_id=?',
    )
      .bind(f.queueId)
      .first<{ n: number }>())!.n,
  ).toBe(9)
})
it('uses only the last 30 valid observations at each level including sparse types', async () => {
  const f = await fixture(101)
  await configure(f)
  // Old outliers must not affect the most recent type window or its parent.
  for (let i = 0; i < 100; i++)
    await env.DB.prepare(
      `INSERT INTO queue_assignment_observation(entry_id,call_cycle,queue_id,episode_id,assigned_at,space_id,seats,baseline_ms,interval_ms,ratio,source,provenance,model_revision)
    VALUES (?,1,?,'test',?,'inside',?,240000,240000,?,'staff','inferred',2)`,
    )
      .bind(f.ids[i]!, f.queueId, f.now + i, i % 2 ? 2 : 4, i < 20 ? 100 : 1)
      .run()
  const state = await loadQueueState(env, f.queueId, f.now + 1000)
  expect(state.adaptive!.factors.service).toBe(1)
  expect(state.adaptive!.factors.zones.get('inside')).toBe(1)
  expect(state.adaptive!.factors.types.get(contextKey('inside', 2))).toBe(1)
  expect(state.adaptive!.factors.types.get(contextKey('inside', 4))).toBe(1)
})
it('hands off the assigned context atomically without creating a capacity sample or moving the human progress anchor', async () => {
  const f = await fixture(4)
  await configure(f)
  await env.DB.prepare(
    "UPDATE queue_entry SET preferred_space_id='inside' WHERE queue_id=?",
  )
    .bind(f.queueId)
    .run()
  await env.DB.prepare('UPDATE queue_entry SET party_size=3 WHERE id=?')
    .bind(f.ids[1]!)
    .run()
  await assign(f, 0, minute, 'inside', 3)
  const before = await env.DB.prepare(
    'SELECT last_assignment_at FROM queue_cadence_state WHERE queue_id=?',
  )
    .bind(f.queueId)
    .first()
  f.clock(2 * minute)
  const key = crypto.randomUUID()
  await runCustomerCommand(
    env,
    f.queueId,
    f.ids[0]!,
    key,
    { action: 'yield', version: 1 },
    Date.now(),
  )
  await runCustomerCommand(
    env,
    f.queueId,
    f.ids[0]!,
    key,
    { action: 'yield', version: 1 },
    Date.now(),
  )
  expect(
    await env.DB.prepare(
      'SELECT source,ratio,space_id,seats FROM queue_assignment_observation WHERE entry_id=?',
    )
      .bind(f.ids[1]!)
      .first(),
  ).toEqual({ source: 'handoff', ratio: null, space_id: 'inside', seats: 4 })
  expect(
    await env.DB.prepare(
      'SELECT last_assignment_at FROM queue_cadence_state WHERE queue_id=?',
    )
      .bind(f.queueId)
      .first(),
  ).toEqual(before)
  expect(
    await env.DB.prepare(
      'SELECT status,sequence,arrival_deadline_at FROM queue_entry WHERE id=?',
    )
      .bind(f.ids[1]!)
      .first(),
  ).toEqual({
    status: 'called',
    sequence: 1,
    arrival_deadline_at: f.now + 7 * minute,
  })
  await assign(f, 2, 3 * minute, 'inside')
  expect(
    await env.DB.prepare(
      'SELECT interval_ms FROM queue_assignment_observation WHERE entry_id=?',
    )
      .bind(f.ids[2]!)
      .first(),
  ).toEqual({ interval_ms: 2 * minute })
})
it('never attributes no-preference service evidence to the fastest forecast zone', async () => {
  const f = await fixture(5)
  await configure(f)
  for (let i = 0; i < 4; i++) await assign(f, i, i * minute, null)
  const rows = (
    await env.DB.prepare(
      'SELECT space_id,seats,baseline_ms,provenance FROM queue_assignment_observation WHERE queue_id=?',
    )
      .bind(f.queueId)
      .all()
  ).results
  expect(rows).toHaveLength(4)
  for (const row of rows)
    expect(row).toEqual({
      space_id: null,
      seats: null,
      baseline_ms: 8 * minute,
      provenance: 'general',
    })
  const factors = (await loadQueueState(env, f.queueId, Date.now())).adaptive!
    .factors
  expect(factors.zones.get('inside')).toBe(factors.service)
})
it('transitions once, preserving mixed entry states and call deadlines, without a migration notice burst', async () => {
  const f = await fixture(4)
  await configure(f)
  await assign(f, 1, minute, 'inside')
  await assign(f, 2, 2 * minute, 'inside')
  await runQueueCommand(
    env,
    f.actor,
    f.queueId,
    crypto.randomUUID(),
    { action: 'complete', entryId: f.ids[2]!, version: 1 },
    Date.now(),
  )
  const entries = (
    await env.DB.prepare(
      'SELECT id,status,sequence,arrival_deadline_at FROM queue_entry WHERE queue_id=? ORDER BY sequence',
    )
      .bind(f.queueId)
      .all()
  ).results
  await env.DB.prepare(
    'UPDATE queue_cadence_state SET model_revision=1,last_assignment_at=? WHERE queue_id=?',
  )
    .bind(f.now + minute, f.queueId)
    .run()
  await env.DB.prepare(
    'UPDATE queue_projection SET predicted_at=? WHERE entry_id=?',
  )
    .bind(f.now + 100 * minute, f.ids[0]!)
    .run()
  const staleWait = crypto.randomUUID(),
    ready = crypto.randomUUID(),
    expired = crypto.randomUUID(),
    joined = crypto.randomUUID()
  for (const [id, entry, kind] of [
    [staleWait, f.ids[0], 'delayed'],
    [ready, f.ids[1], 'ready'],
    [expired, f.ids[2], 'expired'],
    [joined, f.ids[0], 'queue_joined'],
  ])
    await env.DB.prepare(
      `INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind,payload_version,payload_snapshot,revision)
      VALUES (?,?,?,'pending',?,?,2,?,0)`,
    )
      .bind(
        id,
        entry,
        id,
        f.now,
        kind,
        JSON.stringify({
          schemaVersion: 2,
          estimatorVersion: 2,
          predictedAt: f.now + 100 * minute,
          etaMinutes: 100,
          estimateQuality: 'provisional',
        }),
      )
      .run()
  const noticeCount = async () =>
    (await env.DB.prepare(
      "SELECT count(*) AS n FROM notification_outbox WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?) AND kind IN ('approaching','delayed','improved') AND status='pending'",
    )
      .bind(f.queueId)
      .first<{ n: number }>())!.n
  f.clock(3 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  expect(await noticeCount()).toBe(0)
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
      .bind(staleWait)
      .first(),
  ).toEqual({ status: 'cancelled' })
  for (const id of [ready, expired])
    expect(
      await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
        .bind(id)
        .first(),
    ).toEqual({ status: 'pending' })
  const current = (await readEntrySnapshot(env, f.ids[0]!))!.predictedAt
  expect(
    JSON.parse(
      (await env.DB.prepare(
        'SELECT payload_snapshot FROM notification_outbox WHERE id=?',
      )
        .bind(joined)
        .first<{ payload_snapshot: string }>())!.payload_snapshot,
    ).predictedAt,
  ).toBe(current)
  expect(
    (
      await env.DB.prepare(
        'SELECT id,status,sequence,arrival_deadline_at FROM queue_entry WHERE queue_id=? ORDER BY sequence',
      )
        .bind(f.queueId)
        .all()
    ).results,
  ).toEqual(entries)
  const first = await readEntrySnapshot(env, f.ids[0]!)
  await recalculateQueue(env, f.queueId, Date.now() + 1000)
  expect((await readEntrySnapshot(env, f.ids[0]!))?.predictedAt).toBe(
    first?.predictedAt,
  )
  expect(
    await env.DB.prepare(
      'SELECT model_revision FROM queue_cadence_state WHERE queue_id=?',
    )
      .bind(f.queueId)
      .first(),
  ).toEqual({ model_revision: 2 })
  expect(
    JSON.parse(
      (await env.DB.prepare('SELECT config FROM queue WHERE id=?')
        .bind(f.queueId)
        .first<{ config: string }>())!.config,
    ).averageMinutes,
  ).toBe(8)
})
it('retains historical reservations verbatim through assignment, arrival and expiry', async () => {
  const f = await fixture(3)
  await configure(f)
  await env.DB.prepare(
    "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,?,'inside:2:0','inside',2,?,?)",
  )
    .bind(f.ids[0]!, f.queueId, f.now - 1000, f.now - 500)
    .run()
  const original = await env.DB.prepare(
    'SELECT * FROM queue_allocation WHERE entry_id=?',
  )
    .bind(f.ids[0]!)
    .first()
  await assign(f, 0, minute, 'inside')
  await runQueueCommand(
    env,
    f.actor,
    f.queueId,
    crypto.randomUUID(),
    { action: 'complete', entryId: f.ids[0]!, version: 1 },
    Date.now(),
  )
  await assign(f, 1, 2 * minute, 'inside')
  f.clock(7 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  expect(
    await env.DB.prepare('SELECT * FROM queue_allocation WHERE entry_id=?')
      .bind(f.ids[0]!)
      .first(),
  ).toEqual(original)
  expect(
    await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
      .bind(f.ids[0]!)
      .first(),
  ).toEqual({ status: 'completed' })
  expect(
    await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
      .bind(f.ids[1]!)
      .first(),
  ).toEqual({ status: 'expired' })
  expect(
    (await env.DB.prepare(
      'SELECT count(*) AS n FROM queue_assignment_observation WHERE queue_id=?',
    )
      .bind(f.queueId)
      .first<{ n: number }>())!.n,
  ).toBe(2)
})

it('assignment tokens depend on entry state/version, not catalogue quantities or historical occupancy', async () => {
  const f = await fixture(2)
  const before = await loadQueueState(env, f.queueId, f.now)
  const token = await assignmentContext(before, f.ids[0]!, f.now)
  const config = {
    ...f.config,
    resourceStateKnown: false,
    spaces: f.config.spaces.map((s) => ({
      ...s,
      tables: 9,
      tableTypes: s.tableTypes?.map((t) => ({ ...t, count: 9 })),
    })),
  }
  const after = await loadQueueState(env, f.queueId, f.now, { config })
  expect((await assignmentContext(after, f.ids[0]!, f.now)).token).toBe(
    token.token,
  )
  await env.DB.prepare('UPDATE queue_entry SET version=version+1 WHERE id=?')
    .bind(f.ids[0]!)
    .run()
  const changed = await loadQueueState(env, f.queueId, f.now)
  expect((await assignmentContext(changed, f.ids[0]!, f.now)).token).not.toBe(
    token.token,
  )
})

it('updates catalogue quantities without echoing or mutating retired inventory fields', async () => {
  const f = await fixture()
  const legacy = {
    ...f.config,
    adjustments: [
      {
        spaceId: 'room',
        seats: 4,
        minutes: 30,
        reason: 'Historical correction',
        expiresAt: f.now + minute,
      },
    ],
  }
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify(legacy), f.queueId)
    .run()
  const version = await env.DB.prepare('SELECT version FROM queue WHERE id=?')
    .bind(f.queueId)
    .first<{ version: number }>()
  const { resourceStateKnown: _known, ...config } = f.config
  const { configureQueue } = await import('../staff/commands')
  expect(
    await configureQueue(env, f.actor, f.queueId, {
      ...config,
      open: true,
      version: version!.version,
      spaces: [
        {
          ...config.spaces[0]!,
          tables: 1,
          tableTypes: [{ seats: 4, count: 1, averageMinutes: 4 }],
        },
      ],
    }),
  ).toEqual({ ok: true })
  const row = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
    .bind(f.queueId)
    .first<{ config: string }>()
  expect(JSON.parse(row!.config)).toMatchObject({
    resourceStateKnown: true,
    adjustments: legacy.adjustments,
    spaces: [{ tables: 1, tableTypes: [{ seats: 4, count: 1 }] }],
  })
})
