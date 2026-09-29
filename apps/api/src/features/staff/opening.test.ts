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
  return id
}
async function open(t: Awaited<ReturnType<typeof setup>>, occupied = 1) {
  const context = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'open',
    contextToken: context.contextToken,
    groups: context.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: g.spaceId === 'terrace' ? occupied : 0,
    })),
  })
}
it('opens active with occupied resources, protects holds, corrects/release counts, and closes without cancelling turns', async () => {
  const t = await setup(),
    e = await entry(t.queue)
  await open(t)
  let state = await loadQueueState(env, t.queue)
  expect(state.config?.estimationMode).toBe('active')
  expect(state.resources.filter((r) => r.callable)).toHaveLength(2)
  expect(state.resources[0]?.availableAt).toBeNull()
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: e,
    version: 0,
    action: 'call',
  })
  state = await loadQueueState(env, t.queue)
  expect(state.allocations[0]?.resource_id).not.toBe('terrace:4:0')
  let ctx = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'occupancy',
    contextToken: ctx.contextToken,
    group: { spaceId: 'terrace', seats: 4, occupied: 0 },
    reason: 'Mesa liberada',
  })
  ctx = await openingContext(env, t.queue)
  expect(ctx.groups.find((g) => g.spaceId === 'terrace')?.occupied).toBe(0)
  const waiting = await entry(t.queue)
  ctx = await openingContext(env, t.queue)
  expect(ctx.pendingCount).toBe(2)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'close',
    contextToken: ctx.contextToken,
  })
  expect((await openingContext(env, t.queue)).open).toBe(false)
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(waiting)
        .first<{ status: string }>()
    )?.status,
  ).toBe('waiting')
  expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(1)
})
it('rejects incomplete counts, stale contexts, bypasses, and keeps idempotent retries deduplicated', async () => {
  const t = await setup(),
    context = await openingContext(env, t.queue)
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'open',
      contextToken: context.contextToken,
      groups: [],
    }),
  ).rejects.toThrow('incomplete_inventory')
  await entry(t.queue)
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'open',
      contextToken: context.contextToken,
      groups: [],
    }),
  ).rejects.toThrow('version_conflict')
  const ctx = await openingContext(env, t.queue),
    key = crypto.randomUUID()
  const body = {
    action: 'open' as const,
    contextToken: ctx.contextToken,
    groups: ctx.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: 0,
    })),
  }
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  const count = await env.DB.prepare(
    "SELECT COUNT(*) n FROM queue_inventory_audit WHERE queue_id=? AND action='open'",
  )
    .bind(t.queue)
    .first<{ n: number }>()
  expect(count?.n).toBe(1)
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, key, {
      action: 'close',
      contextToken: ctx.contextToken,
    }),
  ).rejects.toThrow('idempotency_conflict')
  const current = await openingContext(env, t.queue),
    state = await loadQueueState(env, t.queue)
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...state.config,
      version: current.version,
      open: false,
    }),
  ).rejects.toThrow('lifecycle_command_required')
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...state.config,
      spaces: [
        {
          ...config.spaces[0]!,
          tables: 3,
          tableTypes: [{ seats: 4, count: 3 }],
        },
      ],
      version: current.version,
      open: true,
    }),
  ).rejects.toThrow('close_before_topology_change')
})
it('waits for legacy entries to drain, but does not silently activate existing open queues', async () => {
  const t = await setup(),
    legacy = await entry(t.queue, 'completed')
  await open(t)
  expect((await loadQueueState(env, t.queue)).config?.estimationMode).toBe(
    'shadow',
  )
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: legacy,
    version: 0,
    action: 'release',
  })
  expect((await loadQueueState(env, t.queue)).config?.estimationMode).toBe(
    'active',
  )
  expect((await openingContext(env, t.queue)).groups[0]?.occupied).toBe(1)
  const old = await setup()
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?')
    .bind(old.queue)
    .run()
  await recalculateQueue(env, old.queue)
  expect(
    (await loadQueueState(env, old.queue)).config?.estimationMode,
  ).not.toBe('active')
})
it('opens initially with missing configuration, but rejects commercial-only actors', async () => {
  const t = await setup({
    ...config,
    spaces: [{ id: 'terrace', name: 'Terraza', tables: 2 }],
  })
  await open(t)
  expect((await openingContext(env, t.queue)).readiness.reasons).toEqual(
    expect.arrayContaining(['configuration_missing']),
  )
  await expect(
    runLifecycleCommand(env, t.sales, t.queue, crypto.randomUUID(), {
      action: 'close',
      contextToken: (await openingContext(env, t.queue)).contextToken,
    }),
  ).rejects.toThrow('not_found')
})
it('serializes competing openings and invalidates contexts after new reservations or corrections', async () => {
  const t = await setup(),
    ctx = await openingContext(env, t.queue)
  const coordinator = env.QUEUE_COORDINATOR.getByName(t.queue)
  const body = {
    action: 'open' as const,
    contextToken: ctx.contextToken,
    groups: ctx.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: 0,
    })),
  }
  const results = await Promise.all([
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), body),
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), body),
  ])
  expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  const id = await entry(t.queue),
    beforeCall = await openingContext(env, t.queue)
  await coordinator.staffCommand(t.actor, t.queue, crypto.randomUUID(), {
    entryId: id,
    version: 0,
    action: 'call',
  })
  expect(
    (
      await coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), {
        action: 'occupancy',
        contextToken: beforeCall.contextToken,
        group: { spaceId: 'salon', seats: 4, occupied: 1 },
        reason: 'Count changed',
      })
    ).status,
  ).toBe(409)
  const current = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'occupancy',
    contextToken: current.contextToken,
    group: { spaceId: 'terrace', seats: 4, occupied: 1 },
    reason: 'Count corrected',
  })
  expect((await openingContext(env, t.queue)).contextToken).not.toBe(
    current.contextToken,
  )
})
it('supports all occupied resources without learning false durations and protects them even while closed', async () => {
  const t = await setup(),
    ctx = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'open',
    contextToken: ctx.contextToken,
    groups: ctx.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: g.count,
    })),
  })
  const id = await entry(t.queue)
  await recalculateQueue(env, t.queue)
  let state = await loadQueueState(env, t.queue)
  expect(state.projections[0]?.quality).toBe('unknown')
  expect(state.allocations).toHaveLength(0)
  await expect(
    runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: id,
      version: 0,
      action: 'call',
    }),
  ).rejects.toThrow('no_free_compatible_resource')
  await expect(
    env.DB.prepare(
      "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at) VALUES (?,?,'terrace:4:0','terrace',4,?)",
    )
      .bind(id, t.queue, Date.now())
      .run(),
  ).rejects.toThrow('resource_already_occupied')
  let context = await openingContext(env, t.queue)
  await configureQueue(env, t.actor, t.queue, {
    ...state.config,
    spaces: state.config!.spaces.map((s) => ({
      ...s,
      tableTypes: s.tableTypes?.map((g) => ({ ...g, averageMinutes: 75 })),
    })),
    version: context.version,
    open: true,
  })
  state = await loadQueueState(env, t.queue)
  expect(state.config?.estimationMode).toBe('active')
  expect(state.resources[0]?.averageMinutes).toBe(75)
  context = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'close',
    contextToken: context.contextToken,
  })
  context = await openingContext(env, t.queue)
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...state.config,
      spaces: [config.spaces[1]],
      version: context.version,
      open: false,
    }),
  ).rejects.toThrow('occupied_resource_configuration')
})
it('allows queue operators without configuration permission and deduplicates projection intents on replay', async () => {
  const t = await setup()
  await env.DB.prepare(
    "UPDATE venue_membership SET role='queue_staff' WHERE user_id=?",
  )
    .bind(t.actor)
    .run()
  const id = await entry(t.queue),
    ctx = await openingContext(env, t.queue),
    key = crypto.randomUUID()
  const command = {
    action: 'open' as const,
    contextToken: ctx.contextToken,
    groups: ctx.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: 0,
    })),
  }
  await runLifecycleCommand(env, t.actor, t.queue, key, command)
  const count = () =>
    env.DB.prepare(
      'SELECT COUNT(*) n FROM queue_estimate_intent WHERE entry_id=?',
    )
      .bind(id)
      .first<{ n: number }>()
  const initial = await count()
  await runLifecycleCommand(env, t.actor, t.queue, key, command)
  expect(await count()).toEqual(initial)
  const latest = await openingContext(env, t.queue)
  const state = await loadQueueState(env, t.queue)
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...state.config,
      open: true,
      version: latest.version,
    }),
  ).rejects.toThrow('forbidden')
})

it.each(['manual_disabled', 'legacy_pending'] as const)(
  'enforces confirmed capacity independently of intelligent ordering (%s)',
  async (pending) => {
    const t = await setup({
      ...config,
      intelligencePolicy:
        pending === 'manual_disabled' ? 'disabled' : 'automatic',
      spaces: [
        {
          id: 'terrace',
          name: 'Terraza',
          tables: 1,
          tableTypes: [{ seats: 4, count: 1 }],
        },
      ],
    })
    if (pending === 'legacy_pending') await entry(t.queue, 'completed')
    await open(t, 1)
    expect((await loadQueueState(env, t.queue)).config?.estimationMode).toBe(
      'shadow',
    )
    const first = await entry(t.queue),
      second = await entry(t.queue)
    await expect(
      runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
        entryId: first,
        version: 0,
        action: 'call',
        overrideReason: 'Explicit override',
      }),
    ).rejects.toThrow('no_free_compatible_resource')
    expect(
      (
        await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
          .bind(first)
          .first<{ status: string }>()
      )?.status,
    ).toBe('waiting')
    const context = await openingContext(env, t.queue)
    await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'occupancy',
      contextToken: context.contextToken,
      group: { spaceId: 'terrace', seats: 4, occupied: 0 },
      reason: 'Table released',
    })
    // Shadow ordering stays permissive, but every call now needs a real free resource.
    await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: second,
      version: 0,
      action: 'call',
    })
    expect(
      (await loadQueueState(env, t.queue)).allocations.some(
        (a) => a.entry_id === second,
      ),
    ).toBe(true)
    await expect(
      runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
        entryId: first,
        version: 0,
        action: 'call',
      }),
    ).rejects.toThrow('no_free_compatible_resource')
  },
)
it('preserves legacy unknown-inventory calls without inventing allocations', async () => {
  const t = await setup(),
    id = await entry(t.queue)
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?')
    .bind(t.queue)
    .run()
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: id,
    version: 0,
    action: 'call',
  })
  expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
})
it('repairs projection failure after the lifecycle commit with the same key without repeating inventory writes', async () => {
  const t = await setup(),
    id = await entry(t.queue),
    context = await openingContext(env, t.queue),
    key = crypto.randomUUID()
  const body = {
    action: 'open' as const,
    contextToken: context.contextToken,
    groups: context.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: g.count,
    })),
  }
  const projection = await import('../queue/projection')
  const fail = vi
    .spyOn(projection, 'recalculateQueue')
    .mockRejectedValueOnce(new Error('post_commit_projection_failure'))
  try {
    await expect(
      runLifecycleCommand(env, t.actor, t.queue, key, body),
    ).rejects.toThrow('post_commit_projection_failure')
  } finally {
    fail.mockRestore()
  }
  expect((await openingContext(env, t.queue)).open).toBe(true)
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  expect((await loadQueueState(env, t.queue)).config?.estimationMode).toBe(
    'active',
  )
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM queue_inventory_audit WHERE queue_id=? AND action='open'",
      )
        .bind(t.queue)
        .first<{ n: number }>()
    )?.n,
  ).toBe(1)
  expect(
    (
      await env.DB.prepare(
        'SELECT quality FROM queue_projection WHERE entry_id=?',
      )
        .bind(id)
        .first<{ quality: string }>()
    )?.quality,
  ).toBe('unknown')
})
it('requires resurvey after a closed managed topology change, including after all retained occupancy drains', async () => {
  const t = await setup(),
    existing = await entry(t.queue)
  await open(t, 1)
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: existing,
    version: 0,
    action: 'call',
  })
  let context = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'close',
    contextToken: context.contextToken,
  })
  context = await openingContext(env, t.queue)
  const old = (await loadQueueState(env, t.queue)).config!
  await configureQueue(env, t.actor, t.queue, {
    ...old,
    open: false,
    version: context.version,
    spaces: [
      ...old.spaces,
      {
        id: 'new',
        name: 'New room',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1 }],
      },
    ],
  })
  const waiting = await entry(t.queue)
  const call = () =>
    runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: waiting,
      version: 0,
      action: 'call',
    })
  await expect(call()).rejects.toThrow('inventory_refresh_required')
  // Existing arrivals/releases remain available while admissions are closed.
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: existing,
    version: 1,
    action: 'complete',
  })
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: existing,
    version: 2,
    action: 'release',
  })
  context = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'occupancy',
    contextToken: context.contextToken,
    group: { spaceId: 'terrace', seats: 4, occupied: 0 },
    reason: 'All tables released',
  })
  expect((await openingContext(env, t.queue)).open).toBe(false)
  expect((await openingContext(env, t.queue)).inventoryConfirmed).toBe(false)
  // Even after entry retention cleanup removes allocation history, invalidation remains durable.
  await env.DB.prepare('DELETE FROM queue_entry WHERE id=?')
    .bind(existing)
    .run()
  expect((await loadQueueState(env, t.queue)).holds).toHaveLength(0)
  expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
  await expect(call()).rejects.toThrow('inventory_refresh_required')
  context = await openingContext(env, t.queue)
  expect(context.readiness.reasons).toContain('inventory_refresh_required')
  await open(t, 0)
  await call()
  expect((await loadQueueState(env, t.queue)).allocations[0]?.entry_id).toBe(
    waiting,
  )
})
it('confirms inventory in place while preserving admissions and allocations', async () => {
  const t = await setup(),
    reserved = await entry(t.queue, 'called'),
    waiting = await entry(t.queue)
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?')
    .bind(t.queue)
    .run()
  await env.DB.prepare(
    "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at) VALUES (?,?,'terrace:4:0','terrace',4,?)",
  )
    .bind(reserved, t.queue, Date.now())
    .run()
  const before = await loadQueueState(env, t.queue),
    context = await openingContext(env, t.queue),
    key = crypto.randomUUID()
  const body = {
    action: 'confirm_inventory' as const,
    contextToken: context.contextToken,
    groups: context.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: 0,
    })),
  }
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  const after = await loadQueueState(env, t.queue),
    current = await openingContext(env, t.queue)
  expect(current.open).toBe(true)
  expect(after.allocations).toEqual(before.allocations)
  expect(after.config?.resourceStateKnown).toBe(true)
  expect(after.config?.estimationMode).toBe('active')
  expect(current.readiness.reasons).not.toContain('inventory_required')
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(waiting)
        .first<{ status: string }>()
    )?.status,
  ).toBe('waiting')
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      ...body,
      contextToken: current.contextToken,
    }),
  ).rejects.toThrow('inventory_already_confirmed')
})
it('rejects stale initial confirmations and repairs an invalidated inventory without closing or duplicating a committed write', async () => {
  const t = await setup({ ...config, intelligencePolicy: 'disabled' })
  await open(t, 1)
  let ctx = await openingContext(env, t.queue)
  const old = (await loadQueueState(env, t.queue)).config!
  await configureQueue(env, t.actor, t.queue, {
    ...old,
    open: true,
    version: ctx.version,
    spaces: [
      ...old.spaces,
      {
        id: 'extra',
        name: 'Extra',
        tables: 1,
        tableTypes: [{ seats: 2, count: 1 }],
      },
    ],
  })
  // Shadow queues may change topology while enabled, invalidating known capacity.
  const stale = await openingContext(env, t.queue)
  await entry(t.queue)
  const command = (context: typeof stale) => ({
    action: 'confirm_inventory' as const,
    contextToken: context.contextToken,
    groups: context.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: g.occupied,
    })),
  })
  await expect(
    runLifecycleCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      command(stale),
    ),
  ).rejects.toThrow('version_conflict')
  ctx = await openingContext(env, t.queue)
  const body = command(ctx),
    key = crypto.randomUUID(),
    projection = await import('../queue/projection')
  const fail = vi
    .spyOn(projection, 'recalculateQueue')
    .mockRejectedValueOnce(new Error('post_commit_projection_failure'))
  try {
    await expect(
      runLifecycleCommand(env, t.actor, t.queue, key, body),
    ).rejects.toThrow('post_commit_projection_failure')
  } finally {
    fail.mockRestore()
  }
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  const current = await openingContext(env, t.queue)
  expect(current.open).toBe(true)
  expect(current.inventoryConfirmed).toBe(true)
  expect(current.readiness.reasons).toEqual([])
  expect(current.groups[0]?.occupied).toBe(1)
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM queue_inventory_audit WHERE queue_id=? AND action='confirm_inventory'",
      )
        .bind(t.queue)
        .first<{ n: number }>()
    )?.n,
  ).toBe(1)
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'occupancy',
      contextToken: current.contextToken,
      group: { spaceId: 'terrace', seats: 4, occupied: 0 },
      reason: '',
    }),
  ).rejects.toThrow('invalid_inventory')
})
it('serializes competing initial confirmations and refuses incomplete configuration', async () => {
  const t = await setup(),
    coordinator = env.QUEUE_COORDINATOR.getByName(t.queue)
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?')
    .bind(t.queue)
    .run()
  const context = await openingContext(env, t.queue)
  const body = {
    action: 'confirm_inventory' as const,
    contextToken: context.contextToken,
    groups: context.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: 0,
    })),
  }
  const results = await Promise.all([
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), body),
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), body),
  ])
  expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  const incomplete = await setup({
    ...config,
    spaces: [{ id: 'terrace', name: 'Terraza', tables: 2 }],
  })
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?')
    .bind(incomplete.queue)
    .run()
  await expect(
    runLifecycleCommand(
      env,
      incomplete.actor,
      incomplete.queue,
      crypto.randomUUID(),
      {
        action: 'confirm_inventory',
        contextToken: (
          await openingContext(env, incomplete.queue)
        ).contextToken,
        groups: [],
      },
    ),
  ).rejects.toThrow('configuration_missing')
})
it.each([null, 0, 1])(
  'defaults to automatic management independent of old deployment policy %s',
  async (enabled) => {
    const t = await setup()
    if (enabled !== null)
      await env.DB.prepare(
        'INSERT INTO queue_intelligence_rollout VALUES (?,?)',
      )
        .bind(t.venueId, enabled)
        .run()
    await open(t, 1)
    expect((await loadQueueState(env, t.queue)).config?.estimationMode).toBe(
      'active',
    )
  },
)
it('persists an explicit operational opt-out without losing inventory and restores automatic management', async () => {
  const t = await setup()
  await open(t, 2)
  let context = await openingContext(env, t.queue)
  const holds = (await loadQueueState(env, t.queue)).holds
  const body = {
      action: 'disable_intelligence' as const,
      contextToken: context.contextToken,
    },
    key = crypto.randomUUID()
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  await recalculateQueue(env, t.queue)
  let state = await loadQueueState(env, t.queue)
  expect(state.config?.intelligencePolicy).toBe('disabled')
  expect(state.config?.estimationMode).toBe('shadow')
  expect(state.holds).toEqual(holds)
  context = await openingContext(env, t.queue)
  expect(context.readiness.state).toBe('disabled')
  await expect(
    runLifecycleCommand(env, t.sales, t.queue, crypto.randomUUID(), {
      action: 'enable_intelligence',
      contextToken: context.contextToken,
    }),
  ).rejects.toThrow('not_found')
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'enable_intelligence',
    contextToken: context.contextToken,
  })
  state = await loadQueueState(env, t.queue)
  expect(state.config?.intelligencePolicy).toBe('automatic')
  expect(state.config?.estimationMode).toBe('active')
})
it('keeps opt-out through configuration and reopen, preserves capacity, and requires valid inventory when returning automatic', async () => {
  const t = await setup(),
    setPolicy = async (
      action: 'disable_intelligence' | 'enable_intelligence',
    ) =>
      runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
        action,
        contextToken: (await openingContext(env, t.queue)).contextToken,
      })
  await open(t, 2)
  await setPolicy('disable_intelligence')
  let state = await loadQueueState(env, t.queue),
    ctx = await openingContext(env, t.queue)
  const { intelligencePolicy: ignored, ...withoutPolicy } = state.config!
  void ignored
  await configureQueue(env, t.actor, t.queue, {
    ...withoutPolicy,
    averageMinutes: 45,
    version: ctx.version,
    open: true,
  })
  expect(
    (await loadQueueState(env, t.queue)).config?.intelligencePolicy,
  ).toBe('disabled')
  ctx = await openingContext(env, t.queue)
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...(await loadQueueState(env, t.queue)).config,
      intelligencePolicy: 'automatic',
      version: ctx.version,
      open: true,
    }),
  ).rejects.toThrow('lifecycle_command_required')
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'close',
    contextToken: ctx.contextToken,
  })
  await open(t, 2)
  expect((await openingContext(env, t.queue)).readiness.state).toBe(
    'disabled',
  )
  const id = await entry(t.queue)
  // The salon remains the only unheld resource; consume it and reject the next call even while disabled.
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: id,
    version: 0,
    action: 'call',
  })
  const next = await entry(t.queue)
  await expect(
    runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: next,
      version: 0,
      action: 'call',
    }),
  ).rejects.toThrow('no_free_compatible_resource')
  ctx = await openingContext(env, t.queue)
  state = await loadQueueState(env, t.queue)
  await configureQueue(env, t.actor, t.queue, {
    ...state.config,
    open: true,
    version: ctx.version,
    spaces: [
      ...state.config!.spaces,
      {
        id: 'extra',
        name: 'Extra',
        tables: 1,
        tableTypes: [{ seats: 2, count: 1 }],
      },
    ],
  })
  expect(
    (await loadQueueState(env, t.queue)).config?.intelligencePolicy,
  ).toBe('disabled')
  await setPolicy('enable_intelligence')
  ctx = await openingContext(env, t.queue)
  expect(ctx.readiness.state).toBe('pending')
  expect(ctx.readiness.reasons).toContain('inventory_refresh_required')
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'confirm_inventory',
    contextToken: ctx.contextToken,
    groups: ctx.groups.map((g) => ({
      spaceId: g.spaceId,
      seats: g.seats,
      occupied: g.occupied,
    })),
  })
  expect((await openingContext(env, t.queue)).readiness.state).toBe('active')
})
it('activates an old confirmed shadow inventory without resurvey, but does not infer unknown inventory', async () => {
  const t = await setup()
  await open(t, 1)
  const config = (await loadQueueState(env, t.queue)).config!,
    before = (await loadQueueState(env, t.queue)).holds
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify({ ...config, estimationMode: 'shadow' }), t.queue)
    .run()
  await recalculateQueue(env, t.queue)
  expect((await loadQueueState(env, t.queue)).config?.estimationMode).toBe(
    'active',
  )
  expect((await loadQueueState(env, t.queue)).holds).toEqual(before)
  const unknown = await setup()
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?')
    .bind(unknown.queue)
    .run()
  await recalculateQueue(env, unknown.queue)
  expect((await openingContext(env, unknown.queue)).readiness.state).toBe(
    'pending',
  )
})
it('rejects stale policy snapshots and replays a post-commit policy change only once', async () => {
  const t = await setup()
  await open(t, 1)
  const stale = await openingContext(env, t.queue)
  await entry(t.queue)
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'disable_intelligence',
      contextToken: stale.contextToken,
    }),
  ).rejects.toThrow('version_conflict')
  const body = {
      action: 'disable_intelligence' as const,
      contextToken: (await openingContext(env, t.queue)).contextToken,
    },
    key = crypto.randomUUID(),
    projection = await import('../queue/projection')
  const fail = vi
    .spyOn(projection, 'recalculateQueue')
    .mockRejectedValueOnce(new Error('post_commit'))
  try {
    await expect(
      runLifecycleCommand(env, t.actor, t.queue, key, body),
    ).rejects.toThrow('post_commit')
  } finally {
    fail.mockRestore()
  }
  await runLifecycleCommand(env, t.actor, t.queue, key, body)
  expect((await openingContext(env, t.queue)).readiness.state).toBe(
    'disabled',
  )
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM queue_inventory_audit WHERE queue_id=? AND action='disable_intelligence'",
      )
        .bind(t.queue)
        .first<{ n: number }>()
    )?.n,
  ).toBe(1)
})
it.each(['viewer', 'queue_staff'] as const)(
  'requires operational capability for policy changes (%s)',
  async (role) => {
    const t = await setup()
    await open(t, 1)
    await env.DB.prepare('UPDATE venue_membership SET role=? WHERE user_id=?')
      .bind(role, t.actor)
      .run()
    const change = runLifecycleCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      {
        action: 'disable_intelligence',
        contextToken: (await openingContext(env, t.queue)).contextToken,
      },
    )
    if (role === 'viewer') await expect(change).rejects.toThrow('forbidden')
    else {
      await change
      expect((await openingContext(env, t.queue)).readiness.state).toBe(
        'disabled',
      )
    }
  },
)
