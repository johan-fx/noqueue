import { fixtureLocation } from '../../../test/location-fixture'
import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { provision } from './provision'
import { openingContext, runLifecycleCommand } from './opening'
import { loadQueueState, recalculateQueue } from '../queue/projection'
import { configureQueue, runQueueCommand } from './commands'
import type { ServiceInput } from '@noqueue/contracts/staff'
const config: ServiceInput = {
  name: 'Restaurant',
  type: 'restaurant',
  capacity: 30,
  averageMinutes: 30,
  graceMinutes: 5,
  cutoffMinutes: 0,
  twentyFourHours: true,
  schedules: [],
  receptionServices: [],
  spaces: [
    {
      id: 'terrace',
      name: 'Terraza',
      tables: 2,
      tableTypes: [{ seats: 4, count: 2, averageMinutes: 50 }],
    },
    {
      id: 'salon',
      name: 'Salón',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
    },
  ],
}
async function setup(service = config) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Sales',?,datetime('now'),datetime('now'),'commercial_operator')",
  )
    .bind(id, `${id}@test.invalid`)
    .run()
  const t = await provision(env, id, id, {
    ...(await fixtureLocation(id)),
    organizationName: 'Test',
    slug: id,
    venueName: 'Test',
    timezone: 'Europe/Madrid',
    ownerName: 'Test',
    ownerUsername: 'u' + id.replaceAll('-', '').slice(0, 20),
    ownerPassword: 'test-only-password-long',
    services: [{ ...service, intelligencePolicy: 'automatic' }],
  })
  const q = await env.DB.prepare('SELECT id FROM queue WHERE venue_id=?')
    .bind(t.venueId)
    .first<{ id: string }>()
  if (service.intelligencePolicy === 'disabled')
    await runLifecycleCommand(env, t.userId, q!.id, crypto.randomUUID(), {
      action: 'disable_intelligence',
      contextToken: (await openingContext(env, q!.id)).contextToken,
    })
  return { actor: t.userId, sales: id, queue: q!.id, ...t }
}
async function entry(queue: string, status = 'waiting') {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,4,'es',?,(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?),?)",
  )
    .bind(id, queue, id, id, id, id, Date.now(), queue, status)
    .run()
  const organization = await env.DB.prepare(
    'SELECT v.organization_id FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=?',
  )
    .bind(queue)
    .first<{ organization_id: string }>()
  await env.DB.prepare('INSERT INTO consent VALUES (?,?,?,?,?,?,NULL)')
    .bind(
      crypto.randomUUID(),
      id,
      organization!.organization_id,
      'queue_updates',
      'test-explicit-consent',
      Date.now(),
    )
    .run()
  return id
}
async function open(t: Awaited<ReturnType<typeof setup>>, occupied = 1) {
  const context = await openingContext(env, t.queue)
  const restaurant =
    (await loadQueueState(env, t.queue)).config?.type === 'restaurant'
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'open',
    contextToken: context.contextToken,
    groups: context.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: restaurant
        ? g.count - g.allocated
        : g.spaceId === 'terrace'
        ? occupied
        : 0,
    })),
  })
  // Fixtures first declare genuine full capacity, then explicitly record physical changes.
  if (restaurant)
    for (const group of context.groups) {
      const target = group.spaceId === 'terrace' ? occupied : 0
      if (target !== group.count - group.allocated)
        await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
          action: 'occupancy',
          contextToken: (await openingContext(env, t.queue)).contextToken,
          group: {
            spaceId: group.spaceId,
            seats: group.seats,
            occupied: target,
          },
          reason: 'Fixture physical capacity update',
        })
    }
}

it('assigns quick FIFO once, preserves grace and finishes without a resource', async () => {
  for (const type of ['reception', 'pool'] as const) {
    const t = await setup({
      ...config,
      type,
      spaces: [],
      receptionServices: ['check_in'],
      graceMinutes: 5,
    })
    const first = await entry(t.queue),
      second = await entry(t.queue)
    const key = crypto.randomUUID(),
      now = Date.now()
    await expect(
      runQueueCommand(
        env,
        t.actor,
        t.queue,
        crypto.randomUUID(),
        { action: 'call', entryId: second, version: 0 },
        now,
      ),
    ).rejects.toThrow('unsupported_action')
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      key,
      { action: 'assign_next' },
      now,
    )
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      key,
      { action: 'assign_next' },
      now + 1000,
    )
    const row = await env.DB.prepare(
      'SELECT status,arrival_deadline_at FROM queue_entry WHERE id=?',
    )
      .bind(first)
      .first<{ status: string; arrival_deadline_at: number }>()
    expect(row).toMatchObject({
      status: 'called',
      arrival_deadline_at: now + 300000,
    })
    expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
    await runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'complete', entryId: first, version: 1 },
      now + 1000,
    )
    expect(
      (
        await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
          .bind(first)
          .first()
      )?.status,
    ).toBe('completed')
    expect(
      (
        await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
          .bind(second)
          .first()
      )?.status,
    ).toBe('waiting')
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM notification_outbox WHERE entry_id=? AND kind='ready'",
        )
          .bind(first)
          .first()
      )?.n,
    ).toBe(1)
  }
})
it('seats a present restaurant group atomically without a deadline or notice', async () => {
  const t = await setup(),
    id = await entry(t.queue)
  await open(t, 0)
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'call',
    entryId: id,
    version: 0,
    arrivalMode: 'present',
  })
  expect(
    await env.DB.prepare(
      'SELECT status,arrival_deadline_at FROM queue_entry WHERE id=?',
    )
      .bind(id)
      .first(),
  ).toMatchObject({ status: 'completed', arrival_deadline_at: null })
  expect(
    (await loadQueueState(env, t.queue)).allocations[0]?.arrived_at,
  ).not.toBeNull()
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM notification_outbox WHERE entry_id=? AND kind='ready'",
      )
        .bind(id)
        .first()
    )?.n,
  ).toBe(0)
})
it('blocks only grace changes while a legacy call lacks its immutable deadline', async () => {
  const t = await setup({ ...config, type: 'pool', spaces: [] })
  await entry(t.queue, 'called')
  let q = await env.DB.prepare(
    'SELECT version,open,config FROM queue WHERE id=?',
  )
    .bind(t.queue)
    .first<{ version: number; open: number; config: string }>()
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...JSON.parse(q!.config),
      version: q!.version,
      open: !!q!.open,
      graceMinutes: 2,
    }),
  ).rejects.toThrow('legacy_arrival_deadline')
  await configureQueue(env, t.actor, t.queue, {
    ...JSON.parse(q!.config),
    version: q!.version,
    open: !!q!.open,
    name: 'Updated pool',
  })
  expect((await loadQueueState(env, t.queue)).config?.graceMinutes).toBe(5)
})

it('uses compatible priority, revalidates stale availability, and retains the table after arrival', async () => {
  const { assignmentContext } = await import('./assignment')
  const t = await setup({
    ...config,
    spaces: [
      {
        id: 'small',
        name: 'Small',
        tables: 1,
        tableTypes: [{ seats: 2, count: 1 }],
      },
    ],
  })
  const large = await entry(t.queue),
    small = await entry(t.queue),
    later = await entry(t.queue)
  await env.DB.prepare('UPDATE queue_entry SET party_size=2 WHERE id IN (?,?)')
    .bind(small, later)
    .run()
  await open(t, 0)
  let state = await loadQueueState(env, t.queue)
  expect(
    (await assignmentContext(state, small, Date.now())).priorityRequired,
  ).toBe(false)
  expect(
    (await assignmentContext(state, later, Date.now())).priorityRequired,
  ).toBe(true)
  await expect(
    runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'call',
      entryId: later,
      version: 0,
    }),
  ).rejects.toThrow('oldest_compatible_required')
  const snapshot = await assignmentContext(state, small, Date.now())
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'call',
    entryId: later,
    version: 0,
    overrideReason: 'Priority guest',
  })
  await expect(
    runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'call',
      entryId: small,
      version: 0,
      assignmentToken: snapshot.token,
    }),
  ).rejects.toThrow('assignment_context_changed')
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(small)
        .first()
    )?.status,
  ).toBe('waiting')
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'complete',
    entryId: later,
    version: 1,
  })
  state = await loadQueueState(env, t.queue)
  expect(
    state.allocations.find((a) => a.entry_id === later)?.released_at,
  ).toBeNull()
  expect(
    state.allocations.find((a) => a.entry_id === later)?.arrived_at,
  ).not.toBeNull()
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'release',
    entryId: later,
    version: 2,
  })
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'call',
    entryId: small,
    version: 0,
  })
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'cancel',
    entryId: small,
    version: 1,
  })
  expect(
    (await loadQueueState(env, t.queue)).allocations.every(
      (a) => a.released_at !== null,
    ),
  ).toBe(true)
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(large)
        .first()
    )?.status,
  ).toBe('waiting')
})

it('keeps assigned deadlines immutable through config changes and provider delivery events', async () => {
  const { processWebhook } = await import('../queue/notifications')
  const { expireArrivals } = await import('../queue/customer')
  const t = await setup({
      ...config,
      type: 'pool',
      spaces: [],
      graceMinutes: 2,
    }),
    id = await entry(t.queue),
    now = Date.now()
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'assign_next' },
    now,
  )
  const q = await env.DB.prepare(
    'SELECT version,open,config FROM queue WHERE id=?',
  )
    .bind(t.queue)
    .first<{ version: number; open: number; config: string }>()
  await configureQueue(env, t.actor, t.queue, {
    ...JSON.parse(q!.config),
    version: q!.version,
    open: !!q!.open,
    graceMinutes: 20,
  })
  const notification = await env.DB.prepare(
    "SELECT id FROM notification_outbox WHERE entry_id=? AND kind='ready'",
  )
    .bind(id)
    .first<{ id: string }>()
  await env.DB.prepare(
    "UPDATE notification_outbox SET status='accepted',provider_id=? WHERE id=?",
  )
    .bind(id, notification!.id)
    .run()
  const webhook = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO webhook_event(id,dedupe_key,kind,provider_id,status,occurred_at,received_at) VALUES (?,?,'status',?,'delivered',?,?)",
  )
    .bind(webhook, webhook, id, now + 60000, now + 60000)
    .run()
  await processWebhook(env, webhook)
  expect(
    (
      await env.DB.prepare(
        'SELECT arrival_deadline_at FROM queue_entry WHERE id=?',
      )
        .bind(id)
        .first()
    )?.arrival_deadline_at,
  ).toBe(now + 120000)
  await expireArrivals(env, t.queue, now + 120000)
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(id)
        .first()
    )?.status,
  ).toBe('expired')
})

it('reissues a ready notice with a new call-cycle after expiry, restoration, and recall', async () => {
  const { expireArrivals } = await import('../queue/customer')
  const t = await setup({
      ...config,
      type: 'pool',
      spaces: [],
      graceMinutes: 2,
    }),
    id = await entry(t.queue),
    now = Date.now()
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'assign_next',
  }, now)
  await expireArrivals(env, t.queue, now + 120000)
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'restore',
    entryId: id,
    version: 2,
    overrideReason: 'Customer returned before service ended',
  }, now + 120001)
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'assign_next',
  }, now + 120002)
  const notices = await env.DB.prepare(
    "SELECT call_cycle,payload_version,payload_snapshot FROM notification_outbox WHERE entry_id=? AND kind='ready' ORDER BY call_cycle",
  )
    .bind(id)
    .all<{
      call_cycle: number
      payload_version: number
      payload_snapshot: string
    }>()
  expect(notices.results.map((notice) => notice.call_cycle)).toEqual([1, 2])
  expect(notices.results.every((notice) => notice.payload_version === 2)).toBe(
    true,
  )
  expect(
    JSON.parse(notices.results[0]!.payload_snapshot).resourceName,
  ).toBe('Piscina / bar')
})

it('cancels a pending joined notice atomically when the turn is assigned', async () => {
  const t = await setup({ ...config, type: 'pool', spaces: [] })
  const id = await entry(t.queue)
  const notificationId = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind,payload_version,payload_snapshot) VALUES (?,?,?,'pending',?,'queue_joined',2,'{}')",
  )
    .bind(notificationId, id, `${id}:queue_joined:v2:r0:c0`, Date.now())
    .run()

  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'assign_next',
  })

  expect(
    (
      await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
        .bind(notificationId)
        .first()
    )?.status,
  ).toBe('cancelled')
})

it('suppresses an obsolete approaching intent if the configured threshold no longer applies', async () => {
  const { dispatchNotificationSerialized } = await import(
    '../queue/notifications'
  )
  const t = await setup({
    ...config,
    type: 'pool',
    spaces: [],
    approachTurns: 0,
    approachMinutes: 0,
  })
  await entry(t.queue)
  const id = await entry(t.queue),
    notification = crypto.randomUUID()
  await recalculateQueue(env, t.queue)
  await env.DB.prepare(
    'INSERT INTO queue_entry_contact(entry_id,phone_cipher,phone_hash) VALUES (?,?,?)',
  )
    .bind(
      id,
      await (
        await import('../queue/crypto')
      ).encryptPhone(env.PII_ENCRYPTION_KEY, '+34600000000'),
      id,
    )
    .run()
  await env.DB.prepare(
    "INSERT INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at) VALUES (?,?,?,'approaching',?)",
  )
    .bind(notification, id, notification, Date.now())
    .run()
  await dispatchNotificationSerialized(env, notification)
  expect(
    (
      await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
        .bind(notification)
        .first()
    )?.status,
  ).toBe('cancelled')
})
