import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import {
  loadQueueState,
  recalculateQueue,
  commitQueueTransition,
  readProjection,
} from './projection'
import { readEntrySnapshot, joinQueue } from './entries'
import { runQueueCommand } from '../staff/commands'
import { serviceWindow } from '../staff/availability'
import { topology } from './opening-state'
import { publicService } from './public-context'
import { hash } from './crypto'

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
async function adaptive(id: string) {
  return (await env.DB.prepare(
    'SELECT a.*,p.revision,p.quality FROM queue_adaptive_projection a JOIN queue_projection p ON p.entry_id=a.entry_id WHERE a.entry_id=?',
  )
    .bind(id)
    .first<{
      predicted_at: number
      safety_review_at: number | null
      cadence_ms: number
      revision: number
      delay_reason: string | null
      delay_baseline_at: number | null
      safety_revision: number
      approach_episode: number
      approach_armed: number
    }>())!
}
async function observations(queue: string) {
  return (
    await env.DB.prepare(
      'SELECT * FROM queue_assignment_observation WHERE queue_id=? ORDER BY assigned_at,rowid',
    )
      .bind(queue)
      .all<{
        entry_id: string
        ratio: number | null
        interval_ms: number | null
        episode_id: string
      }>()
  ).results
}
async function call(
  f: Awaited<ReturnType<typeof fixture>>,
  i: number,
  at: number,
  key = crypto.randomUUID(),
) {
  f.clock(at)
  await runQueueCommand(
    env,
    f.actor,
    f.queueId,
    key,
    f.config.type === 'restaurant'
      ? { action: 'call', entryId: f.ids[i]!, version: 0 }
      : { action: 'assign_next' },
    Date.now(),
  )
  return key
}
it('starts at 4/8/12 with three free tables and preserves absolute dates on reads', async () => {
  const f = await fixture(3, 'restaurant')
  expect(
    (await Promise.all(f.ids.map((_, i) => f.read(i)))).map(
      (e) => e?.etaMinutes,
    ),
  ).toEqual([4, 8, 12])
  expect(await f.read(0)).toMatchObject({
    estimatorVersion: 2,
    safetyReviewAt: f.now + 3 * minute,
  })
  for (const seconds of [1, 30, 60, 119]) {
    f.clock(seconds * 1000)
    await recalculateQueue(env, f.queueId, Date.now())
    expect((await f.read(0))?.predictedAt).toBe(f.now + 4 * minute)
  }
  expect(
    (await loadQueueState(env, f.queueId, Date.now())).resources.every(
      (r) => r.callable,
    ),
  ).toBe(true)
  expect(await observations(f.queueId)).toHaveLength(0)
})
it('learns gradual cadence from real commands, including simultaneous assignments, exactly once', async () => {
  const f = await fixture(7)
  await call(f, 0, 10_000)
  const key = await call(f, 1, 10_000)
  await call(f, 1, 10_000, key)
  await call(f, 2, 10_000)
  expect(
    (await loadQueueState(env, f.queueId, Date.now())).adaptive?.factor,
  ).toBe(1)
  await call(f, 3, 10_000)
  const state = await loadQueueState(env, f.queueId, Date.now())
  expect(state.adaptive?.factor).toBeCloseTo(5 / 8.3)
  expect((await observations(f.queueId)).map((o) => o.ratio)).toEqual([
    null,
    0,
    0,
    0,
  ])
  expect((await adaptive(f.ids[6]!)).predicted_at - f.now).toBeLessThan(
    12 * minute,
  )
  expect((await adaptive(f.ids[6]!)).cadence_ms).toBeCloseTo(
    (4 * minute * 5) / 8.3,
  )
})
it('protects before zero, propagates delay, and replay neither extends nor duplicates intents', async () => {
  const f = await fixture()
  for (const id of f.ids)
    await env.DB.prepare(
      "INSERT INTO consent VALUES (?,?,'demo-org','queue_updates','test-only',?,NULL)",
    )
      .bind(crypto.randomUUID(), id, f.now)
      .run()
  const initial = await adaptive(f.ids[0]!)
  f.clock(3 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  const extended = await adaptive(f.ids[0]!)
  expect(extended.predicted_at).toBe(f.now + 7 * minute)
  expect(extended.delay_reason).toBe('safety')
  expect(extended.safety_review_at).toBe(f.now + 6 * minute)
  expect((await adaptive(f.ids[1]!)).predicted_at).toBe(f.now + 11 * minute)
  expect((await adaptive(f.ids[1]!)).delay_reason).toBe('safety')
  await recalculateQueue(env, f.queueId, Date.now())
  expect(await adaptive(f.ids[0]!)).toEqual(extended)
  expect(extended.revision).toBeGreaterThan(initial.revision)
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM notification_outbox WHERE entry_id=? AND kind='delayed'",
      )
        .bind(f.ids[0])
        .first()
    )?.n,
  ).toBe(1)
  for (let i = 0; i < 6; i++) {
    const next = await adaptive(f.ids[0]!)
    f.clock(next.safety_review_at! - f.now)
    await recalculateQueue(env, f.queueId, Date.now())
    expect((await adaptive(f.ids[0]!)).predicted_at).toBeGreaterThan(Date.now())
    expect((await f.read(0))?.status).toBe('waiting')
  }
  expect(await observations(f.queueId)).toHaveLength(0)
})
it('cancellation advances estimates but never trains cadence', async () => {
  const f = await fixture()
  f.clock(minute)
  const before = await loadQueueState(env, f.queueId, Date.now())
  await commitQueueTransition(
    env,
    f.queueId,
    before,
    { parties: before.parties.slice(1) },
    [
      env.DB.prepare(
        "UPDATE queue_entry SET status='cancelled' WHERE id=?",
      ).bind(f.ids[0]),
    ],
    Date.now(),
  )
  expect((await adaptive(f.ids[1]!)).predicted_at).toBe(f.now + 4 * minute)
  expect(await observations(f.queueId)).toHaveLength(0)
  expect((await adaptive(f.ids[0]!)).safety_review_at).toBeNull()
})
it('never learns across paused or empty demand episodes', async () => {
  const f = await fixture(3)
  await call(f, 0, 10_000)
  let before = await loadQueueState(env, f.queueId, Date.now())
  await commitQueueTransition(
    env,
    f.queueId,
    before,
    { demandActive: false },
    [
      env.DB.prepare(
        "UPDATE queue_admission SET override_state='paused' WHERE queue_id=?",
      ).bind(f.queueId),
    ],
    Date.now(),
  )
  expect((await adaptive(f.ids[1]!)).safety_review_at).toBeNull()
  f.clock(30 * minute)
  before = await loadQueueState(env, f.queueId, Date.now())
  await commitQueueTransition(
    env,
    f.queueId,
    before,
    { demandActive: true },
    [
      env.DB.prepare(
        "UPDATE queue_admission SET override_state='active' WHERE queue_id=?",
      ).bind(f.queueId),
    ],
    Date.now(),
  )
  await call(f, 1, 30 * minute)
  await call(f, 2, 31 * minute)
  const obs = await observations(f.queueId)
  expect(obs.map((o) => o.ratio)).toEqual([null, null, 0.25])
  expect(obs[0]!.episode_id).not.toBe(obs[1]!.episode_id)
  expect(
    (
      await env.DB.prepare(
        'SELECT episode_id FROM queue_cadence_state WHERE queue_id=?',
      )
        .bind(f.queueId)
        .first()
    )?.episode_id,
  ).toBeNull()
})
it('unknown occupancy is provisional and never makes an occupied resource callable', async () => {
  const f = await fixture(3, 'restaurant')
  const before = await loadQueueState(env, f.queueId, f.now)
  const holds = before.resources.map((r) => ({
    resource_id: r.id,
    space_id: r.spaceId,
    seats: r.seats,
  }))
  await commitQueueTransition(
    env,
    f.queueId,
    before,
    { holds },
    holds.map((h) =>
      env.DB.prepare(
        'INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?,?,?,?,?)',
      ).bind(f.queueId, h.resource_id, h.space_id, h.seats, f.now),
    ),
    f.now,
  )
  expect(await f.read(0)).toMatchObject({
    etaMinutes: 4,
    estimateQuality: 'provisional',
  })
  const state = await loadQueueState(env, f.queueId, f.now)
  expect(
    state.resources.every((r) => !r.callable && r.occupancyMinutes === null),
  ).toBe(true)
  f.clock(3 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  expect(
    (await loadQueueState(env, f.queueId, Date.now())).resources.every(
      (r) => !r.callable,
    ),
  ).toBe(true)
})
it('real assignment wins over a due safety review and preserves arrival deadline', async () => {
  const f = await fixture(1)
  await call(f, 0, 3 * minute)
  const entry = await env.DB.prepare(
    'SELECT arrival_deadline_at FROM queue_entry WHERE id=?',
  )
    .bind(f.ids[0])
    .first()
  expect(entry?.arrival_deadline_at).toBe(f.now + 8 * minute)
  expect((await adaptive(f.ids[0]!)).safety_review_at).toBeNull()
  await recalculateQueue(env, f.queueId, Date.now())
  expect(
    await env.DB.prepare(
      'SELECT arrival_deadline_at FROM queue_entry WHERE id=?',
    )
      .bind(f.ids[0])
      .first(),
  ).toEqual(entry)
  expect(await observations(f.queueId)).toHaveLength(1)
})
it('activation is silent, preserves historical anchors, and rollback retains observations', async () => {
  const f = await fixture(2, 'reception', 1)
  // Simulate a genuinely pre-v2 durable state: legacy projections without
  // adaptive rows or cadence metadata. Config v1 alone is not a legacy model
  // marker because v1 configs already run the operational v2 estimator.
  await env.DB.prepare('DELETE FROM queue_adaptive_projection WHERE entry_id IN (?,?)').bind(...f.ids).run()
  await env.DB.prepare('DELETE FROM queue_cadence_state WHERE queue_id=?').bind(f.queueId).run()
  await env.DB.prepare('UPDATE queue_projection SET estimator_version=1 WHERE entry_id IN (?,?)').bind(...f.ids).run()
  const anchor = await env.DB.prepare(
    'SELECT * FROM queue_forecast_anchor WHERE entry_id=?',
  )
    .bind(f.ids[0])
    .first()
  for (const id of f.ids)
    await env.DB.prepare(
      "INSERT INTO consent VALUES (?,?,'demo-org','queue_updates','test-only',?,NULL)",
    )
      .bind(crypto.randomUUID(), id, f.now)
      .run()
  const before = await loadQueueState(env, f.queueId, f.now)
  const config = {
    ...f.config,
    estimatorVersion: 2 as const,
    approachMinutes: 10,
  }
  await commitQueueTransition(
    env,
    f.queueId,
    before,
    { config },
    [
      env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(
        JSON.stringify(config),
        f.queueId,
      ),
    ],
    f.now,
  )
  await recalculateQueue(env, f.queueId, f.now + 1)
  expect(
    (
      await env.DB.prepare(
        'SELECT COUNT(*) n FROM notification_outbox WHERE entry_id IN (?,?)',
      )
        .bind(...f.ids)
        .first()
    )?.n,
  ).toBe(0)
  expect(
    await env.DB.prepare('SELECT * FROM queue_forecast_anchor WHERE entry_id=?')
      .bind(f.ids[0])
      .first(),
  ).toEqual(anchor)
  await call(f, 0, 10_000)
  const active = await loadQueueState(env, f.queueId, Date.now())
  await commitQueueTransition(
    env,
    f.queueId,
    active,
    { config: f.config },
    [
      env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(
        JSON.stringify(f.config),
        f.queueId,
      ),
    ],
    Date.now(),
  )
  expect(await observations(f.queueId)).toHaveLength(1)
  const safety = await adaptive(f.ids[1]!)
  expect(safety.safety_review_at).toBe(safety.predicted_at - 60_000)
  expect(
    (await readProjection(env, f.ids[1]!, true))?.estimatorVersion,
  ).toBe(2)
})
it('join, public mean and frozen notices use adaptive forecasts without the old floor', async () => {
  const f = await fixture(5)
  for (let i = 0; i < 4; i++) await call(f, i, 10_000)
  const learned = await adaptive(f.ids[4]!)
  const result = await joinQueue(env, f.queueId, crypto.randomUUID(), {
    partySize: 1,
    locale: 'es',
    whatsapp: {
      consent: true,
      phone: '+34600000000',
      version: 'whatsapp-queue-updates-v1',
    },
  })
  expect(result.status).toBe(201)
  const entry = await env.DB.prepare(
    'SELECT id FROM queue_entry WHERE queue_id=? ORDER BY sequence DESC LIMIT 1',
  )
    .bind(f.queueId)
    .first<{ id: string }>()
  const current = await readProjection(env, entry!.id, true)
  const outbox = await env.DB.prepare(
    "SELECT payload_snapshot FROM notification_outbox WHERE entry_id=? AND kind='queue_joined'",
  )
    .bind(entry!.id)
    .first<{ payload_snapshot: string }>()
  expect(JSON.parse(outbox!.payload_snapshot)).toMatchObject({
    estimatorVersion: 2,
    predictedAt: current?.predictedAt,
    etaMinutes: current?.etaMinutes,
  })
  expect(current?.predictedAt).toBeCloseTo(
    learned.predicted_at + learned.cadence_ms,
  )
  f.clock(70_000)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await publicService(env, f.queueId))?.averageWaitMinutes).toBeLessThan(4)
})
it('rolls back assignment observation and prediction with a failed transaction', async () => {
  const f = await fixture()
  const original = await adaptive(f.ids[0]!),
    before = await loadQueueState(env, f.queueId, f.now)
  await expect(
    commitQueueTransition(
      env,
      f.queueId,
      before,
      {
        parties: before.parties.slice(1),
        assignment: { entryId: f.ids[0]!, callCycle: 1 },
      },
      [
        env.DB.prepare(
          'INSERT INTO customer_command(entry_id,request_key,request_hash,result,created_at) VALUES (NULL,NULL,NULL,NULL,NULL)',
        ),
      ],
      f.now,
    ),
  ).rejects.toThrow()
  expect(await adaptive(f.ids[0]!)).toEqual(original)
  expect(await observations(f.queueId)).toHaveLength(0)
})
it('rearms approach only above A+S and does not emit improved alongside approach', async () => {
  const f = await fixture(1)
  await env.DB.prepare(
    "INSERT INTO consent VALUES (?,?,'demo-org','queue_updates','test-only',?,NULL)",
  )
    .bind(crypto.randomUUID(), f.ids[0], f.now)
    .run()
  f.clock(2 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await adaptive(f.ids[0]!)).approach_armed).toBe(0)
  f.clock(3 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  expect(await adaptive(f.ids[0]!)).toMatchObject({
    approach_armed: 1,
    approach_episode: 1,
  })
  const delay = await adaptive(f.ids[0]!)
  await env.DB.prepare(
    'INSERT INTO queue_notification_state(entry_id,last_accepted_predicted_at,last_correction_accepted_at,last_accepted_safety_revision,updated_at) VALUES (?,?,?,?,?)',
  )
    .bind(
      f.ids[0],
      delay.predicted_at,
      Date.now(),
      delay.safety_revision,
      Date.now(),
    )
    .run()
  await env.DB.prepare(
    "UPDATE notification_outbox SET status='sent' WHERE entry_id=? AND kind='delayed'",
  )
    .bind(f.ids[0])
    .run()
  f.clock(5 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await adaptive(f.ids[0]!)).approach_armed).toBe(0)
  const rows = (
    await env.DB.prepare(
      'SELECT kind,revision,payload_snapshot FROM notification_outbox WHERE entry_id=?',
    )
      .bind(f.ids[0])
      .all<{ kind: string; revision: number; payload_snapshot: string }>()
  ).results
  expect(
    rows
      .filter((r) => r.kind === 'approaching')
      .map((r) => JSON.parse(r.payload_snapshot).approachEpisode),
  ).toEqual([0, 1])
  expect(rows.filter((r) => r.kind === 'improved')).toHaveLength(0)
})
it('records every safety extension inside cooldown and retains all distinct pending events', async () => {
  const f = await fixture(1)
  await env.DB.prepare(
    "INSERT INTO consent VALUES (?,?,'demo-org','queue_updates','test-only',?,NULL)",
  )
    .bind(crypto.randomUUID(), f.ids[0], f.now)
    .run()
  await env.DB.prepare(
    'INSERT INTO queue_notification_state(entry_id,last_accepted_predicted_at,last_correction_accepted_at,updated_at) VALUES (?,?,?,?)',
  )
    .bind(f.ids[0], f.now + 4 * minute, f.now, f.now)
    .run()
  for (const minutes of [3, 6, 9]) {
    f.clock(minutes * minute)
    await recalculateQueue(env, f.queueId, Date.now())
  }
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM notification_outbox WHERE entry_id=? AND kind='delayed'",
      )
        .bind(f.ids[0])
        .first()
    )?.n,
  ).toBe(3)
  f.clock(10 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  const current = await adaptive(f.ids[0]!)
  const notices = (
    await env.DB.prepare(
      "SELECT payload_snapshot FROM notification_outbox WHERE entry_id=? AND kind='delayed' AND status='pending'",
    )
      .bind(f.ids[0])
      .all<{ payload_snapshot: string }>()
  ).results
  expect(notices).toHaveLength(3)
  expect(JSON.parse(notices[2]!.payload_snapshot)).toMatchObject({
    predictedAt: current.predicted_at,
    estimationRevision: current.revision,
    safetyRevision: current.safety_revision,
  })
})
it('records only the explicitly inferred assignment context and ignores historical occupancy', async () => {
  const f = await fixture(4, 'restaurant')
  const before = await loadQueueState(env, f.queueId, f.now)
  const config = {
    ...f.config,
    spaces: [
      {
        ...f.config.spaces[0]!,
        tableTypes: [{ seats: 4, count: 3, averageMinutes: 7 }],
      },
    ],
  }
  await commitQueueTransition(
    env,
    f.queueId,
    before,
    { config },
    [
      env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(
        JSON.stringify(config),
        f.queueId,
      ),
    ],
    f.now,
  )
  await call(f, 0, 1000)
  const obs = await env.DB.prepare(
    'SELECT baseline_ms,space_id,seats FROM queue_assignment_observation WHERE entry_id=?',
  )
    .bind(f.ids[0])
    .first()
  expect(obs).toEqual({ baseline_ms: 4 * minute, space_id: null, seats: null })
  let state = await loadQueueState(env, f.queueId, Date.now())
  expect(state.resources).toEqual([])
  expect(state.allocations).toEqual([])
  // Historic reservations remain stored but cannot become operational state or
  // cadence samples; a completion/release duration is no longer estimator input.
  for (let i = 0; i < 3; i++) {
    const id = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,2,'es',?,?,'served')",
    )
      .bind(id, f.queueId, id, id, id, id, f.now, -i - 1)
      .run()
    await env.DB.prepare(
      "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at,released_at,outcome) VALUES (?,?,'room:4:0','room',4,?,?,?,'served')",
    )
      .bind(id, f.queueId, f.now - 40 * minute, f.now - 30 * minute, f.now)
      .run()
  }
  state = await loadQueueState(env, f.queueId, Date.now())
  expect(state.resources).toEqual([])
  expect(state.allocations).toEqual([])
  expect(
    (
      await env.DB.prepare(
        'SELECT COUNT(*) n FROM queue_allocation WHERE queue_id=?',
      )
        .bind(f.queueId)
        .first()
    )?.n,
  ).toBe(3)
  expect(await observations(f.queueId)).toHaveLength(1)
})
it('new demand after an empty queue starts a fresh episode without an idle-gap sample', async () => {
  const f = await fixture(1)
  await call(f, 0, 1000)
  f.clock(60 * minute)
  const result = await joinQueue(env, f.queueId, crypto.randomUUID(), {
    partySize: 1,
    locale: 'es',
    whatsapp: { consent: false },
  })
  expect(result.status).toBe(201)
  await runQueueCommand(
    env,
    f.actor,
    f.queueId,
    crypto.randomUUID(),
    { action: 'assign_next' },
    Date.now(),
  )
  const obs = await observations(f.queueId)
  expect(obs.map((o) => o.ratio)).toEqual([null, null])
  expect(obs[0]?.episode_id).not.toBe(obs[1]?.episode_id)
  const episodes = (
    await env.DB.prepare(
      'SELECT end_reason FROM queue_demand_episode WHERE queue_id=?',
    )
      .bind(f.queueId)
      .all<{ end_reason: string }>()
  ).results
  expect(episodes.map((e) => e.end_reason)).toEqual(['empty', 'empty'])
})
it('automatically upgrades a configured active queue with no version flag, without another activation step', async () => {
  const f = await fixture(3, 'restaurant', 1)
  await env.DB.prepare(
    "UPDATE queue SET config=json_remove(config,'$.estimatorVersion') WHERE id=?",
  )
    .bind(f.queueId)
    .run()
  await recalculateQueue(env, f.queueId, f.now)
  const state = await loadQueueState(env, f.queueId, f.now)
  expect(state.config?.estimatorVersion).toBe(2)
  expect(state.adaptive?.active).toBe(true)
  expect(await f.read(0)).toMatchObject({
    estimatorVersion: 2,
    predictedAt: f.now + 4 * minute,
    safetyReviewAt: f.now + 3 * minute,
  })
  expect(
    (await Promise.all(f.ids.map((_, i) => f.read(i)))).map(
      (e) => e?.etaMinutes,
    ),
  ).toEqual([4, 8, 12])
})
it('real pause and resume commands terminate learning episodes and safety alarms', async () => {
  const { openingContext, runLifecycleCommand } = await import(
    '../staff/opening'
  )
  const f = await fixture(3, 'restaurant')
  await call(f, 0, 1000)
  await runLifecycleCommand(env, f.actor, f.queueId, crypto.randomUUID(), {
    action: 'pause',
    contextToken: (await openingContext(env, f.queueId)).contextToken,
  })
  expect((await adaptive(f.ids[1]!)).safety_review_at).toBeNull()
  f.clock(3 * minute)
  await runLifecycleCommand(env, f.actor, f.queueId, crypto.randomUUID(), {
    action: 'resume',
    contextToken: (await openingContext(env, f.queueId)).contextToken,
  })
  expect((await adaptive(f.ids[1]!)).safety_review_at).toBeGreaterThan(
    Date.now(),
  )
  await call(f, 1, 3 * minute)
  expect((await observations(f.queueId)).map((o) => o.ratio)).toEqual([
    null,
    null,
  ])
})
it('projects a serial queue without resource-derived unknown future slots', async () => {
  const f = await fixture(2, 'restaurant')
  const before = await loadQueueState(env, f.queueId, f.now)
  const config = {
    ...f.config,
    spaces: [
      {
        ...f.config.spaces[0]!,
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 4 }],
      },
    ],
  }
  const state = await loadQueueState(env, f.queueId, f.now, { config })
  expect(state.projections[0]).toMatchObject({
    predictedAt: f.now + 4 * minute,
    callable: true,
  })
  expect(state.projections[1]).toMatchObject({
    predictedAt: f.now + 8 * minute,
    quality: 'provisional',
    callable: true,
  })
  expect(state.adaptiveProjections.map((p) => p.predictedAt)).toEqual([
    f.now + 4 * minute,
    f.now + 8 * minute,
  ])
  expect(before.resources).toEqual([])
  expect(state.allocations).toEqual([])
})
it('anchors the next cadence to real assignment instead of double-counting elapsed work', async () => {
  const f = await fixture(3)
  f.clock(3 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await adaptive(f.ids[1]!)).predicted_at).toBe(f.now + 11 * minute)
  await call(f, 0, 4 * minute)
  expect((await adaptive(f.ids[1]!)).predicted_at).toBe(f.now + 8 * minute)
  expect((await adaptive(f.ids[2]!)).predicted_at).toBe(f.now + 12 * minute)
  expect((await adaptive(f.ids[1]!)).delay_reason).toBeNull()
  f.clock(5 * minute)
  await recalculateQueue(env, f.queueId, Date.now())
  expect((await adaptive(f.ids[1]!)).predicted_at).toBe(f.now + 8 * minute)
})
