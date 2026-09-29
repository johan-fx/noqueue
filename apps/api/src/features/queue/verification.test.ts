declare const process: { env: Record<string, string | undefined> }
import { record as check } from '../../../test/queue-evidence'
import fc from 'fast-check'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { provision } from '../staff/provision'
import { runQueueCommand } from '../staff/commands'
import { openingContext, runLifecycleCommand } from '../staff/opening'
import { loadQueueState } from './projection'

const minute = 60_000
async function setup() {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Sales',?,datetime('now'),datetime('now'),'commercial_operator')"
  )
    .bind(id, `${id}@test.invalid`)
    .run()
  const tenant = await provision(env, id, id, {
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
    action: 'open',
    contextToken: context.contextToken,
    groups: context.groups.map((g) => ({ ...g, occupied: 0 })),
  })
  return { queue, actor: tenant.userId }
}
async function entry(queue: string, now: number, size = 4, space = 'terrace') {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,preferred_space_id) VALUES (?,?,?,?,?,?,?,'en',?,(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?),?)"
  )
    .bind(id, queue, id, id, id, id, size, now, queue, space)
    .run()
  return id
}
it('Q-CLOCK uses one explicit time for calls, events, arrival, release, grace and replay', async () => {
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
    now
  )
  await runQueueCommand(env, t.actor, t.queue, key, call, now + minute)
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'no_show', entryId: id, version: 1 },
      now + 4 * minute
    )
  ).rejects.toThrow('arrival_grace_active')
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'complete', entryId: id, version: 1 },
    now + 2 * minute
  )
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'release', entryId: id, version: 2 },
    now + 62 * minute
  )
  const state = await loadQueueState(env, t.queue, now + 62 * minute)
  check(
    'Q-CLOCK',
    'allocation timeline',
    now + 62 * minute,
    state.allocations.map((a) => [a.reserved_at, a.arrived_at, a.released_at]),
    [[now, now + 2 * minute, now + 62 * minute]]
  )
  check(
    'Q-CLOCK',
    'event timestamps without replay duplication',
    now + 62 * minute,
    (
      await env.DB.prepare(
        'SELECT created_at FROM queue_event WHERE entry_id=? ORDER BY created_at'
      )
        .bind(id)
        .all<{ created_at: number }>()
    ).results.map((e) => e.created_at),
    [now, now + 2 * minute, now + 62 * minute]
  )
})
it('Q-COMMAND-LEARNING real arrival-release durations update only the matching group', async () => {
  const t = await setup()
  let now = 1_800_000_000_000
  for (let sample = 1; sample <= 3; sample++) {
    const id = await entry(t.queue, now)
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'call', entryId: id, version: 0 },
      now
    )
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'complete', entryId: id, version: 1 },
      now + 10 * minute
    )
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'release', entryId: id, version: 2 },
      now + 70 * minute
    )
    now += 71 * minute
    // baseline 50*5 + 60*(1+1.1+1.2), divided by 8.3 -> 54.
    check(
      'Q-COMMAND-LEARNING',
      `completed sample ${sample}`,
      now,
      (await loadQueueState(env, t.queue, now)).resources.map((r) => [
        r.spaceId,
        r.seats,
        r.averageMinutes,
      ]),
      [
        ['terrace', 2, 50],
        ['terrace', 4, sample < 3 ? 50 : 54],
        ['salon', 4, 20],
      ]
    )
  }
})
it('Q-SEQUENCES generated command sequences preserve a separate FIFO model and replay exactly once', async () => {
  const runs = Number(process.env.QUEUE_SEQUENCE_RUNS ?? 20),
    length = Number(process.env.QUEUE_SEQUENCE_LENGTH ?? 25),
    seed = Number(process.env.QUEUE_SEED ?? 20260929)
  let executed = 0
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom('skip', 'cancel', 'serve', 'no_show'), {
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
            'SELECT version FROM queue_entry WHERE id=?'
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
          if (action === 'skip') waiting.push(id)
          else if (action === 'serve') {
            await runQueueCommand(
              env,
              t.actor,
              t.queue,
              crypto.randomUUID(),
              { entryId: id, version: row!.version + 1, action: 'complete' },
              now + minute
            )
            await runQueueCommand(
              env,
              t.actor,
              t.queue,
              crypto.randomUUID(),
              { entryId: id, version: row!.version + 2, action: 'release' },
              now + 31 * minute
            )
          } else if (action === 'no_show') {
            await expect(
              runQueueCommand(
                env,
                t.actor,
                t.queue,
                crypto.randomUUID(),
                { entryId: id, version: row!.version + 1, action: 'no_show' },
                now + 5 * minute - 1
              )
            ).rejects.toThrow('arrival_grace_active')
            await runQueueCommand(
              env,
              t.actor,
              t.queue,
              crypto.randomUUID(),
              { entryId: id, version: row!.version + 1, action: 'no_show' },
              now + 5 * minute
            )
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
              activeAllocations: state.allocations.filter(
                (a) => a.released_at === null
              ).length,
            },
            { order: waiting, activeAllocations: 0 }
          )
          const events = (
            await env.DB.prepare(
              'SELECT kind FROM queue_event WHERE entry_id=?'
            )
              .bind(id)
              .all<{ kind: string }>()
          ).results
          if (action !== 'skip')
            expect(events.filter((e) => e.kind === 'called')).toHaveLength(
              action === 'cancel' ? 0 : 1
            )
          executed++
        }
      }
    ),
    {
      numRuns: runs,
      seed,
      ...(process.env.QUEUE_PATH ? { path: process.env.QUEUE_PATH } : {}),
    }
  )
  check(
    'Q-SEQUENCES',
    `seed=${seed}; ${runs} sequences × ${length} real operations`,
    1_800_000_000_000,
    executed,
    runs * length
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
    'SELECT predicted_at,created_at FROM queue_forecast_anchor WHERE entry_id=?'
  )
    .bind(id)
    .first()
  await recalculateQueue(env, t.queue, now + minute)
  check(
    'Q-ANCHOR',
    'recalculation does not rewrite baseline',
    now + minute,
    await env.DB.prepare(
      'SELECT predicted_at,created_at FROM queue_forecast_anchor WHERE entry_id=?'
    )
      .bind(id)
      .first(),
    initial
  )
  const key = crypto.randomUUID()
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    key,
    { action: 'call', entryId: id, version: 0 },
    now + 2 * minute
  )
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      key,
      { action: 'cancel', entryId: id, version: 1 },
      now + 3 * minute
    )
  ).rejects.toThrow('idempotency_conflict')
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'complete', entryId: id, version: 0 },
      now + 3 * minute
    )
  ).rejects.toThrow('version_conflict')
  const evidence = await env.DB.prepare(
    'SELECT predicted_at,error_minutes FROM queue_wait_evidence WHERE entry_id=?'
  )
    .bind(id)
    .first()
  check(
    'Q-ANCHOR',
    'error measured against initial forecast',
    now + 2 * minute,
    evidence,
    { predicted_at: now, error_minutes: 2 }
  )
})
it('Q-BOUNDARIES D1 learning retains only the last 30 completed durations', async () => {
  const t = await setup()
  let now = 1_800_000_000_000
  for (let sample = 1; sample <= 31; sample++) {
    const id = await entry(t.queue, now),
      duration = sample === 1 ? 1440 : 60
    for (const [action, version, time] of [
      ['call', 0, now],
      ['complete', 1, now + minute],
      ['release', 2, now + (duration + 1) * minute],
    ] as const)
      await runQueueCommand(
        env,
        t.actor,
        t.queue,
        crypto.randomUUID(),
        { action, entryId: id, version },
        time
      )
    now += (duration + 2) * minute
    if (sample === 30 || sample === 31)
      check(
        'Q-BOUNDARIES',
        `completed ${sample}`,
        now,
        (await loadQueueState(env, t.queue, now)).resources.find(
          (r) => r.spaceId === 'terrace' && r.seats === 4
        )?.averageMinutes,
        sample === 30 ? 77 : 59
      )
  }
}, 30_000)
