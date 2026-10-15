// Explicit v1 fixtures retain rollback regressions; default v2 is covered by adaptive-estimator.test.ts.
import { fixtureLocation } from '../../../test/location-fixture'
declare const process: { env: Record<string, string | undefined> }
import { record as check } from '../../../test/queue-evidence'
import fc from 'fast-check'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { provision } from '../staff/provision'
import { runQueueCommand } from '../staff/commands'
import { openingContext, runLifecycleCommand } from '../staff/opening'
import { expireArrivals } from './customer'
import { loadQueueState } from './projection'

const minute = 60_000
async function setup() {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Sales',?,datetime('now'),datetime('now'),'commercial_operator')",
  )
    .bind(id, `${id}@test.invalid`)
    .run()
  const tenant = await provision(env, id, id, {
    ...(await fixtureLocation(id)),
    organizationName: 'Verification',
    slug: id,
    venueName: 'Verification',
    timezone: 'Europe/Madrid',
    ownerName: 'Owner',
    ownerUsername: 'u' + id.replaceAll('-', '').slice(0, 20),
    ownerPassword: 'test-only-password-long',
    services: [
      {
        name: 'Restaurant',
        estimatorVersion: 1 as const,
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
            tables: 2,
            tableTypes: [
              { seats: 2, count: 1, averageMinutes: 50 },
              { seats: 4, count: 1, averageMinutes: 50 },
            ],
          },
          {
            id: 'salon',
            name: 'Salon',
            tables: 1,
            tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
          },
        ],
      },
    ],
  })
  const queue = (await env.DB.prepare('SELECT id FROM queue WHERE venue_id=?')
    .bind(tenant.venueId)
    .first<{ id: string }>())!.id
  const context = await openingContext(env, queue)
  await runLifecycleCommand(env, tenant.userId, queue, crypto.randomUUID(), {
    action: 'declare_full',
    contextToken: context.contextToken,
  })
  return { queue, actor: tenant.userId }
}
async function entry(queue: string, now: number, size = 4, space = 'terrace') {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,preferred_space_id) VALUES (?,?,?,?,?,?,?,'en',?,(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?),?)",
  )
    .bind(id, queue, id, id, id, id, size, now, queue, space)
    .run()
  return id
}
it('Q-CLOCK preserves assignment/arrival timestamps and treats completion as terminal', async () => {
  const t = await setup(),
    now = 1_800_000_000_000
  const id = await entry(t.queue, now),
    key = crypto.randomUUID()
  const call = { action: 'call' as const, entryId: id, version: 0 }
  await runQueueCommand(env, t.actor, t.queue, key, call, now)
  check(
    'Q-CLOCK',
    'call timestamp',
    now,
    (
      await env.DB.prepare('SELECT called_at FROM queue_entry WHERE id=?')
        .bind(id)
        .first()
    )?.called_at,
    now,
  )
  await runQueueCommand(env, t.actor, t.queue, key, call, now + minute)
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'no_show', entryId: id, version: 1 },
      now + 4 * minute,
    ),
  ).rejects.toThrow('arrival_grace_active')
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'complete', entryId: id, version: 1 },
    now + 2 * minute,
  )
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'release', entryId: id, version: 2 },
      now + 62 * minute,
    ),
  ).rejects.toThrow('operation_retired')
  const state = await loadQueueState(env, t.queue, now + 62 * minute)
  check(
    'Q-CLOCK',
    'inventory is not part of operational state',
    now + 62 * minute,
    state.allocations,
    [],
  )
  check(
    'Q-CLOCK',
    'event timestamps without replay duplication',
    now + 62 * minute,
    (
      await env.DB.prepare(
        'SELECT created_at FROM queue_event WHERE entry_id=? ORDER BY created_at',
      )
        .bind(id)
        .all<{ created_at: number }>()
    ).results.map((e) => e.created_at),
    [now, now + 2 * minute],
  )
  check(
    'Q-CLOCK',
    'arrival completes the turn',
    now + 62 * minute,
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(id)
        .first()
    )?.status,
    'completed',
  )
})
it('Q-COMMAND-LEARNING trains only on human assignments, not arrival or completion', async () => {
  const t = await setup()
  const start = 1_800_000_000_000
  const ids = await Promise.all(Array.from({ length: 4 }, () => entry(t.queue, start)))
  for (let sample = 0; sample < 3; sample++) {
    const now = start + sample * 50 * minute
    const id = ids[sample]!
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'call', entryId: id, version: 0 },
      now,
    )
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'complete', entryId: id, version: 1 },
      now + minute,
    )
    if (sample === 0) {
      const afterFirst = await env.DB.prepare(
        'SELECT COUNT(*) n FROM queue_assignment_observation WHERE queue_id=?',
      ).bind(t.queue).first<{ n: number }>()
      expect(afterFirst?.n).toBe(1)
    }
  }
  const observations = (await env.DB.prepare(
    'SELECT source,space_id,seats,interval_ms,ratio FROM queue_assignment_observation WHERE queue_id=? ORDER BY assigned_at',
  ).bind(t.queue).all<{ source: string; space_id: string | null; seats: number | null; interval_ms: number | null; ratio: number | null }>()).results
  expect(observations).toHaveLength(3)
  expect(observations.map((o) => [o.space_id, o.seats, o.ratio])).toEqual([
    ['terrace', 4, null],
    ['terrace', 4, 1],
    ['terrace', 4, 1],
  ])
  expect(observations.every((o) => o.source === 'staff')).toBe(true)
  const state = await loadQueueState(env, t.queue, start + 101 * minute)
  expect(state.resources).toEqual([])
  expect(state.allocations).toEqual([])
  expect(Number.isFinite(state.adaptive?.factors.service)).toBe(true)
})
it('Q-SEQUENCES generated command sequences preserve a separate FIFO model and replay exactly once', async () => {
  const runs = Number(process.env.QUEUE_SEQUENCE_RUNS ?? 20),
    length = Number(process.env.QUEUE_SEQUENCE_LENGTH ?? 25),
    seed = Number(process.env.QUEUE_SEED ?? 20260929)
  let executed = 0
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom('cancel', 'serve', 'no_show'), {
        minLength: length,
        maxLength: length,
      }),
      async (actions) => {
        const t = await setup()
        let now = 1_800_000_000_000
        const waiting: string[] = []
        for (let i = 0; i < 3; i++) waiting.push(await entry(t.queue, now))
        for (const action of actions) {
          const id = waiting.shift()!
          const row = await env.DB.prepare(
            'SELECT version FROM queue_entry WHERE id=?',
          )
            .bind(id)
            .first<{ version: number }>()
          const key = crypto.randomUUID(),
            command = {
              entryId: id,
              version: row!.version,
              action:
                action === 'serve' || action === 'no_show'
                  ? ('call' as const)
                  : action,
            }
          await runQueueCommand(env, t.actor, t.queue, key, command, now)
          await runQueueCommand(env, t.actor, t.queue, key, command, now)
          if (action === 'serve') {
            await runQueueCommand(
              env,
              t.actor,
              t.queue,
              crypto.randomUUID(),
              { entryId: id, version: row!.version + 1, action: 'complete' },
              now + minute,
            )
          } else if (action === 'no_show') {
            await expect(
              runQueueCommand(
                env,
                t.actor,
                t.queue,
                crypto.randomUUID(),
                { entryId: id, version: row!.version + 1, action: 'no_show' },
                now + 5 * minute - 1,
              ),
            ).rejects.toThrow('arrival_grace_active')
            await expireArrivals(env, t.queue, now + 5 * minute)
            expect(
              (
                await env.DB.prepare(
                  'SELECT status FROM queue_entry WHERE id=?',
                )
                  .bind(id)
                  .first()
              )?.status,
            ).toBe('expired')
          }
          now += 32 * minute
          if (waiting.length < 3) waiting.push(await entry(t.queue, now))
          const state = await loadQueueState(env, t.queue, now)
          check(
            'Q-SEQUENCES',
            `operation ${executed + 1}: ${action}`,
            now,
            {
              order: state.parties.map((p) => p.id),
              inventoryState: state.allocations,
            },
            { order: waiting, inventoryState: [] },
          )
          const events = (
            await env.DB.prepare(
              'SELECT kind FROM queue_event WHERE entry_id=?',
            )
              .bind(id)
              .all<{ kind: string }>()
          ).results
          expect(events.filter((e) => e.kind === 'called')).toHaveLength(
            action === 'cancel' ? 0 : 1,
          )
          executed++
        }
      },
    ),
    {
      numRuns: runs,
      seed,
      ...(process.env.QUEUE_PATH ? { path: process.env.QUEUE_PATH } : {}),
    },
  )
  check(
    'Q-SEQUENCES',
    `seed=${seed}; ${runs} sequences × ${length} real operations`,
    1_800_000_000_000,
    executed,
    runs * length,
  )
  // Extended profile executes 10,000 D1 command operations, not simulated no-ops.
}, 600_000)
it('Q-ANCHOR preserves initial forecast and rejects stale versions and conflicting retries', async () => {
  const t = await setup(),
    now = 1_800_000_000_000,
    id = await entry(t.queue, now)
  const { recalculateQueue } = await import('./projection')
  await recalculateQueue(env, t.queue, now)
  const initial = await env.DB.prepare(
    'SELECT predicted_at,created_at FROM queue_forecast_anchor WHERE entry_id=?',
  )
    .bind(id)
    .first()
  await recalculateQueue(env, t.queue, now + minute)
  check(
    'Q-ANCHOR',
    'recalculation does not rewrite baseline',
    now + minute,
    await env.DB.prepare(
      'SELECT predicted_at,created_at FROM queue_forecast_anchor WHERE entry_id=?',
    )
      .bind(id)
      .first(),
    initial,
  )
  const key = crypto.randomUUID()
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    key,
    { action: 'call', entryId: id, version: 0 },
    now + 2 * minute,
  )
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      key,
      { action: 'cancel', entryId: id, version: 1 },
      now + 3 * minute,
    ),
  ).rejects.toThrow('idempotency_conflict')
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'complete', entryId: id, version: 0 },
      now + 3 * minute,
    ),
  ).rejects.toThrow('version_conflict')
  const evidence = await env.DB.prepare(
    'SELECT predicted_at,error_minutes FROM queue_wait_evidence WHERE entry_id=?',
  )
    .bind(id)
    .first()
  check(
    'Q-ANCHOR',
    'error measured against the contextual initial forecast',
    now + 2 * minute,
    evidence,
    { predicted_at: now + 50 * minute, error_minutes: -48 },
  )
})
it('Q-BOUNDARIES contextual learning uses only the last 30 consecutive assignment ratios', async () => {
  const t = await setup()
  const start = 1_800_000_000_000
  const ids = await Promise.all(Array.from({ length: 32 }, () => entry(t.queue, start)))
  let now = start
  for (let i = 0; i < ids.length; i++) {
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'call', entryId: ids[i]!, version: 0 },
      now,
    )
    // The first valid gap is an outlier; the next thirty equal samples should
    // evict it from the rolling contextual window.
    now += i === 0 ? 500 * minute : 60 * minute
  }
  const observations = (await env.DB.prepare(
    'SELECT ratio FROM queue_assignment_observation WHERE queue_id=? ORDER BY assigned_at',
  ).bind(t.queue).all<{ ratio: number | null }>()).results
  expect(observations).toHaveLength(32)
  expect(observations[0]?.ratio).toBeNull()
  expect(observations[1]?.ratio).toBe(10)
  const state = await loadQueueState(env, t.queue, now)
  check(
    'Q-BOUNDARIES',
    'old outlier evicted after thirty valid gaps',
    now,
    state.adaptive?.factors.service,
    (await import('./adaptive-model')).cadenceFactor(Array(30).fill(60 / 50)),
  )
}, 30_000)

it('Q-PROGRESS keeps canonical serial deadlines positive and stable through polling', async () => {
  const { recalculateQueue } = await import('./projection')
  const t = await setup(),
    now = Date.now()
  const ids = [
    await entry(t.queue, now),
    await entry(t.queue, now),
    await entry(t.queue, now),
  ]
  await recalculateQueue(env, t.queue, now)
  const deadlineQuery = () => env.DB.prepare(
    'SELECT entry_id,predicted_at,cadence_ms FROM queue_adaptive_projection WHERE entry_id IN (?,?,?) ORDER BY predicted_at',
  ).bind(...ids).all<{ entry_id: string; predicted_at: number; cadence_ms: number }>()
  const initial = await deadlineQuery()
  expect(initial.results.map(r => r.predicted_at)).toEqual([
    now + 50 * minute,
    now + 100 * minute,
    now + 150 * minute,
  ])
  expect(initial.results.every(r => r.predicted_at > now && r.cadence_ms > 0)).toBe(true)
  await env.DB.prepare(
    "UPDATE queue SET config=json_set(config,'$.spaces[0].tableTypes[1].averageMinutes',100) WHERE id=?",
  )
    .bind(t.queue)
    .run()
  await recalculateQueue(env, t.queue, now + minute)
  await recalculateQueue(env, t.queue, now + 2 * minute)
  const afterConfiguration = await deadlineQuery()
  expect(afterConfiguration.results.map(r => r.cadence_ms)).toEqual([
    100 * minute,
    100 * minute,
    100 * minute,
  ])
  await recalculateQueue(env, t.queue, now + 3 * minute)
  // D1 timing metadata is not part of deadline stability (duration may vary).
  expect((await deadlineQuery()).results).toEqual(afterConfiguration.results)
})

it('Q-PROGRESS captures grace in the versioned call, replays safely and never resets on restore/new call', async () => {
  const { recalculateQueue } = await import('./projection')
  const t = await setup(),
    now = Date.now(),
    id = await entry(t.queue, now)
  await recalculateQueue(env, t.queue, now)
  const get = () =>
    env.DB.prepare(
      'SELECT progress_initial_eta_minutes AS initial,version,status FROM queue_entry WHERE id=?',
    )
      .bind(id)
      .first()
  expect((await get())?.initial).toBeNull()
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'call', entryId: id, version: 9 },
      now,
    ),
  ).rejects.toThrow('version_conflict')
  expect((await get())?.initial).toBeNull()
  const key = crypto.randomUUID()
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    key,
    { action: 'call', entryId: id, version: 0 },
    now,
  )
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    key,
    { action: 'call', entryId: id, version: 0 },
    now + minute,
  )
  expect(await get()).toEqual({ initial: 5, version: 1, status: 'called' })
  await expireArrivals(env, t.queue, now + 5 * minute)
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    {
      action: 'restore',
      entryId: id,
      version: 2,
      overrideReason: 'Confirmed retry',
    },
    now + 6 * minute,
  )
  await env.DB.prepare(
    "UPDATE queue SET config=json_set(config,'$.graceMinutes',10) WHERE id=?",
  )
    .bind(t.queue)
    .run()
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'call', entryId: id, version: 3 },
    now + 6 * minute,
  )
  check(
    'Q-PROGRESS',
    'same baseline after expiry, restore and longer new grace',
    now + 6 * minute,
    await get(),
    { initial: 5, version: 4, status: 'called' },
  )
})

it('Q-PROGRESS does not capture grace for an already-present arrival', async () => {
  const t = await setup(),
    now = Date.now(),
    id = await entry(t.queue, now)
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'call', entryId: id, version: 0, arrivalMode: 'present' },
    now,
  )
  check(
    'Q-PROGRESS',
    'already-present arrival leaves grace baseline unset',
    now,
    await env.DB.prepare(
      'SELECT progress_initial_eta_minutes AS initial,status FROM queue_entry WHERE id=?',
    )
      .bind(id)
      .first(),
    { initial: null, status: 'completed' },
  )
})
