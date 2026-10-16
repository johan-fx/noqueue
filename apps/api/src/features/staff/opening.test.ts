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
  return id
}
async function open(t: Awaited<ReturnType<typeof setup>>, _occupied = 1) {
  const context = await openingContext(env, t.queue)
  if (context.open) return
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'open',
    contextToken: context.contextToken,
  })
}

it('opens without an occupancy survey and lets queue progress proceed without reservations', async () => {
  const t = await setup(),
    e = await entry(t.queue)
  await open(t)
  let state = await loadQueueState(env, t.queue)
  expect(state.config?.estimationMode).toBe('active')
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: e,
    version: 0,
    action: 'call',
  })
  state = await loadQueueState(env, t.queue)
  expect(state.allocations).toHaveLength(0)
  const waiting = await entry(t.queue)
  const ctx = await openingContext(env, t.queue)
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
  expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
})
it('invalidates pre-initialization context once, then keeps it stable across dashboard refreshes', async () => {
  const t = await setup()
  const initial = await openingContext(env, t.queue)

  // The first dashboard entries read activates the estimator lazily.
  await recalculateQueue(env, t.queue)
  const initialized = await openingContext(env, t.queue)
  expect(initialized.version).toBe(initial.version + 1)
  expect(initialized.contextToken).not.toBe(initial.contextToken)
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'declare_full', contextToken: initial.contextToken,
    }),
  ).rejects.toThrow('version_conflict')

  // Once initialized, polling alone must not invalidate a fresh lifecycle intent.
  await recalculateQueue(env, t.queue)
  expect((await openingContext(env, t.queue)).contextToken).toBe(initialized.contextToken)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'declare_full', contextToken: initialized.contextToken,
  })
  expect((await openingContext(env, t.queue)).queueState).toBe('active')
})

it('prepares the public opening snapshot before the first polling refresh, while rejecting concurrent intents', async () => {
  const t = await setup()
  const coordinator = env.QUEUE_COORDINATOR.getByName(t.queue)
  const context = await coordinator.openingContext(t.queue)
  // Deterministic reproduction of the E2E race: background entries polling
  // must not invalidate a snapshot just obtained to activate a new service.
  await coordinator.refresh(t.queue)
  expect((await coordinator.openingContext(t.queue)).contextToken).toBe(context.contextToken)
  const command = { action: 'declare_full' as const, contextToken: context.contextToken }
  const results = await Promise.all([
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), command),
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), command),
  ])
  expect(results.map((result) => result.status).sort()).toEqual([200, 409])
})

it('accepts legacy opening aliases and preserves stale-context/idempotent lifecycle guards', async () => {
  const t = await setup(),
    context = await openingContext(env, t.queue)
  const key = crypto.randomUUID()
  await runLifecycleCommand(env, t.actor, t.queue, key, {
    action: 'open', contextToken: context.contextToken, groups: [],
  } as never)
  await entry(t.queue)
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action: 'open',
      contextToken: context.contextToken,
    }),
  ).rejects.toThrow('version_conflict')
  const ctx = await openingContext(env, t.queue),
    closeKey = crypto.randomUUID()
  const body = { action: 'close' as const, contextToken: ctx.contextToken }
  await runLifecycleCommand(env, t.actor, t.queue, closeKey, body)
  await runLifecycleCommand(env, t.actor, t.queue, closeKey, body)
  const count = await env.DB.prepare(
    "SELECT COUNT(*) n FROM staff_audit WHERE target_id=? AND action='queue.open'",
  )
    .bind(t.queue)
    .first<{ n: number }>()
  expect(count?.n).toBe(1)
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, closeKey, { action: 'open', contextToken: ctx.contextToken }),
  ).rejects.toThrow('idempotency_conflict')
  const current = await openingContext(env, t.queue),
    state = await loadQueueState(env, t.queue)
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...state.config,
      version: current.version,
      open: true,
    }),
  ).rejects.toThrow('lifecycle_command_required')
  await configureQueue(env, t.actor, t.queue, {
    ...state.config,
    spaces: [{ ...config.spaces[0]!, tables: 3, tableTypes: [{ seats: 4, count: 3 }] }],
    version: current.version,
    open: false,
  })
})
it('does not wait for legacy entries or inventory to activate the queue model', async () => {
  const t = await setup(),
    legacy = await entry(t.queue, 'completed')
  await open(t)
  expect((await loadQueueState(env, t.queue)).config?.estimationMode).toBe(
    'active',
  )
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(legacy).first<{status:string}>())?.status).toBe('completed')
  const old = await setup()
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?')
    .bind(old.queue)
    .run()
  await recalculateQueue(env, old.queue)
  expect(
    (await loadQueueState(env, old.queue)).config?.estimationMode,
  ).toBe('active')
})
it('opens with incomplete table-type metadata and still rejects commercial-only actors', async () => {
  const t = await setup({
    ...config,
    spaces: [{ id: 'terrace', name: 'Terraza', tables: 2 }],
  })
  await open(t)
  expect((await openingContext(env, t.queue)).readiness.reasons).toEqual([])
  await expect(
    runLifecycleCommand(env, t.sales, t.queue, crypto.randomUUID(), {
      action: 'close',
      contextToken: (await openingContext(env, t.queue)).contextToken,
    }),
  ).rejects.toThrow('not_found')
})
it('serializes competing openings and invalidates stale lifecycle contexts without inventory corrections', async () => {
  const t = await setup(),
    ctx = await openingContext(env, t.queue)
  const coordinator = env.QUEUE_COORDINATOR.getByName(t.queue)
  const body = {
    action: 'open' as const,
    contextToken: ctx.contextToken,
  }
  const results = await Promise.all([
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), body),
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), body),
  ])
  expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  const retired = await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'release_unit',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  } as never).catch((error) => error)
  expect(retired).toMatchObject({ status: 410, message: 'operation_retired' })
  const id = await entry(t.queue),
    beforeCall = await openingContext(env, t.queue)
  await coordinator.staffCommand(t.actor, t.queue, crypto.randomUUID(), {
    entryId: id,
    version: 0,
    action: 'call',
  })
  expect((await coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), {
    action: 'pause', contextToken: beforeCall.contextToken,
  })).status).toBe(409)
  const current = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'pause',
    contextToken: current.contextToken,
  })
  expect((await openingContext(env, t.queue)).open).toBe(false)
})
it('allows assignments despite historic occupancy and allows contextual configuration changes', async () => {
  const t = await setup(),
    ctx = await openingContext(env, t.queue)
  // Legacy external-occupancy records remain readable but are never assignment gates.
  for (let i = 0; i < 2; i++)
    await env.DB.prepare('INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?,?,?,?,?)')
      .bind(t.queue, `terrace:4:${i}`, 'terrace', 4, Date.now()).run()
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'open',
    contextToken: ctx.contextToken,
  })
  const id = await entry(t.queue)
  await recalculateQueue(env, t.queue)
  let state = await loadQueueState(env, t.queue)
  expect(state.allocations).toHaveLength(0)
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: id,
      version: 0,
      action: 'call',
    })
  state = await loadQueueState(env, t.queue)
  expect(state.allocations).toHaveLength(0)
  expect(state.holds).toHaveLength(0)
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM queue_external_occupancy WHERE queue_id=?').bind(t.queue).first<{n:number}>())?.n).toBe(2)
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
  expect(state.holds).toHaveLength(0)
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM queue_external_occupancy WHERE queue_id=?').bind(t.queue).first<{n:number}>())?.n).toBe(2)
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
  ).resolves.toBeDefined()
})
it('allows queue operators without configuration permission and deduplicates projection intents on replay', async () => {
  const t = await setup()
  await env.DB.prepare(
    "UPDATE venue_membership SET role='queue_staff' WHERE user_id=?",
  )
    .bind(t.actor)
    .run()
  await env.DB.prepare(
    'INSERT INTO staff_queue_assignment SELECT user_id,venue_id,? FROM venue_membership WHERE user_id=?',
  )
    .bind(t.queue, t.actor)
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
      occupied: g.count - g.allocated,
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
  'assigns multiple turns regardless of legacy occupancy or intelligence policy (%s)',
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
      pending === 'manual_disabled' ? 'shadow' : 'active',
    )
    const first = await entry(t.queue),
      second = await entry(t.queue)
    await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: first, version: 0, action: 'call',
    })
    await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: second, version: 0, action: 'call',
    })
    expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
  },
)
it('allows restaurant assignment without known inventory or a matching table type', async () => {
  const t = await setup(),
    id = await entry(t.queue)
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?').bind(t.queue).run()
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: id,
      version: 0,
      action: 'call',
    })
  expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
})
it('repairs projection failure after opening commit with the same key without duplicate audit', async () => {
  const t = await setup(),
    id = await entry(t.queue),
    context = await openingContext(env, t.queue),
    key = crypto.randomUUID()
  const body = {
    action: 'open' as const,
    contextToken: context.contextToken,
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
        "SELECT COUNT(*) n FROM staff_audit WHERE target_id=? AND action='queue.open'",
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
  ).toBeTruthy()
})
it('allows contextual table changes without freeing resources and still protects pending zone references', async () => {
  const t = await setup(),
    waiting = await entry(t.queue)
  await env.DB.prepare('UPDATE queue_entry SET preferred_space_id=\'terrace\' WHERE id=?').bind(waiting).run()
  await open(t)
  const before = await loadQueueState(env, t.queue)
  const context = await openingContext(env, t.queue)
  await configureQueue(env, t.actor, t.queue, {
    ...before.config,
    version: context.version,
    open: true,
    spaces: before.config!.spaces.map((space) => space.id === 'terrace'
      ? { ...space, tables: 9, tableTypes: [{ seats: 4, count: 9, averageMinutes: 33 }] }
      : space),
  })
  const updated = await loadQueueState(env, t.queue)
  expect(updated.config?.spaces.find((space) => space.id === 'terrace')?.tables).toBe(9)
  const current = await openingContext(env, t.queue)
  await expect(configureQueue(env, t.actor, t.queue, {
    ...updated.config,
    spaces: updated.config!.spaces.filter(space => space.id !== 'terrace'),
    version: current.version,
    open: true,
  })).rejects.toThrow('preferred_space_in_use')
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: waiting, version: 0, action: 'call',
  })
  expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
})
it('rejects the retired inventory confirmation command without changing legacy records', async () => {
  const t = await setup(),
    reserved = await entry(t.queue, 'called'),
    waiting = await entry(t.queue)
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?').bind(t.queue).run()
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
  await expect(runLifecycleCommand(env, t.actor, t.queue, key, body as never))
    .rejects.toMatchObject({ status: 410, message: 'operation_retired' })
  const after = await loadQueueState(env, t.queue), current = await openingContext(env, t.queue)
  expect(current.open).toBe(false)
  expect(after.allocations).toEqual(before.allocations)
  expect(after.holds).toEqual(before.holds)
  expect(after.config?.resourceStateKnown).toBe(before.config?.resourceStateKnown)
  expect(after.config?.estimationMode).toBe(before.config?.estimationMode)
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(waiting)
        .first<{ status: string }>()
    )?.status,
  ).toBe('waiting')
  expect((await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(waiting).first<{status:string}>())?.status).toBe('waiting')
})
it('retires stale legacy inventory confirmations without closing or modifying the queue', async () => {
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
  await expect(runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), command(stale) as never))
    .rejects.toMatchObject({status:410,message:'operation_retired'})
  ctx = await openingContext(env, t.queue)
  await expect(runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), command(ctx) as never))
    .rejects.toMatchObject({status:410,message:'operation_retired'})
  const current = await openingContext(env, t.queue)
  expect(current.open).toBe(true)
  expect(current.readiness.reasons).toEqual([])
  expect(current.groups).toHaveLength(0)
  expect(await env.DB.prepare('SELECT * FROM queue_inventory_audit WHERE queue_id=?').bind(t.queue).all()).toMatchObject({results:[]})
})
it('opens with incomplete legacy topology and keeps inventory confirmation out of operation', async () => {
  const t = await setup(),
    coordinator = env.QUEUE_COORDINATOR.getByName(t.queue)
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?').bind(t.queue).run()
  const context = await openingContext(env, t.queue)
  const results = await Promise.all([
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), { action:'open', contextToken: context.contextToken }),
    coordinator.lifecycle(t.actor, t.queue, crypto.randomUUID(), { action:'open', contextToken: context.contextToken }),
  ])
  expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  const incomplete = await setup({
    ...config,
    spaces: [{ id: 'terrace', name: 'Terraza', tables: 2 }],
  })
  await env.DB.prepare('UPDATE queue SET open=1 WHERE id=?')
    .bind(incomplete.queue)
    .run()
  const incompleteContext = await openingContext(env, incomplete.queue)
  await runLifecycleCommand(env, incomplete.actor, incomplete.queue, crypto.randomUUID(), {
    action: 'open', contextToken: incompleteContext.contextToken,
  })
  expect((await openingContext(env, incomplete.queue)).open).toBe(true)
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
it('keeps opt-out through configuration without making assignment depend on capacity inventory', async () => {
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
  expect((await loadQueueState(env, t.queue)).config?.intelligencePolicy).toBe(
    'disabled',
  )
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
  expect((await openingContext(env, t.queue)).readiness.state).toBe('disabled')
  const id = await entry(t.queue)
  // Explicitly disabled estimation still cannot block the staff queue operation.
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: id,
    version: 0,
    action: 'call',
  })
  const next = await entry(t.queue)
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    entryId: next, version: 0, action: 'call',
  })
  expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
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
  expect((await loadQueueState(env, t.queue)).config?.intelligencePolicy).toBe(
    'disabled',
  )
  await setPolicy('enable_intelligence')
  ctx = await openingContext(env, t.queue)
  expect((await openingContext(env, t.queue)).readiness.state).toBe('active')
})
it('activates legacy queues without treating unknown inventory as a readiness blocker', async () => {
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
    'active',
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
  expect((await openingContext(env, t.queue)).readiness.state).toBe('disabled')
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM staff_audit WHERE target_id=? AND action='queue.disable_intelligence'",
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
    if (role === 'queue_staff')
      await env.DB.prepare(
        'INSERT INTO staff_queue_assignment SELECT user_id,venue_id,? FROM venue_membership WHERE user_id=?',
      )
        .bind(t.queue, t.actor)
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

it('persists encrypted service details, binds projection/calls, audits manual joins and replays retries', async () => {
  const { joinQueue } = await import('../queue/entries')
  const { decryptDisplayName } = await import('../queue/crypto')
  const t = await setup({ ...config, assignmentPreference: 'salon' })
  await open(t, 2)
  const input = {
    displayName: 'María López',
    partySize: 4,
    preferredSpaceId: 'terrace',
    locale: 'es' as const,
    whatsapp: { consent: false as const },
  }
  const key = crypto.randomUUID()
  const first = await joinQueue(env, t.queue, key, input, false, t.actor)
  expect(first.status).toBe(201)
  const row = await env.DB.prepare(
    'SELECT id,display_name_cipher,preferred_space_id FROM queue_entry WHERE queue_id=?',
  )
    .bind(t.queue)
    .first<{
      id: string
      display_name_cipher: string
      preferred_space_id: string
    }>()
  expect(row!.display_name_cipher).not.toContain('María')
  expect(
    await decryptDisplayName(env.PII_ENCRYPTION_KEY, row!.display_name_cipher),
  ).toBe('María López')
  expect(row!.preferred_space_id).toBe('terrace')
  expect((await loadQueueState(env, t.queue)).projections[0]).toMatchObject({
    resourceId: null,
    callable: true,
  })
  expect(
    (await joinQueue(env, t.queue, key, input, false, t.actor)).body,
  ).toEqual({
    ...first.body,
    customer: {
      ...('customer' in first.body ? first.body.customer : {}),
      serverNow: expect.any(Number),
    },
  })
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      entryId: row!.id,
      version: 0,
      action: 'call',
    })
  const assignment = await env.DB.prepare('SELECT space_id,seats,provenance,source FROM queue_assignment_observation WHERE entry_id=?')
    .bind(row!.id).first<{space_id:string|null;seats:number|null;provenance:string;source:string}>()
  expect(assignment).toMatchObject({space_id:'terrace',seats:4,provenance:'inferred',source:'staff'})
  expect(
    (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM staff_audit WHERE target_id=? AND action='queue.join'",
    )
      .bind(row!.id)
      .first<{ n: number }>())!.n,
  ).toBe(1)
  expect(
    (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notification_outbox WHERE entry_id=? AND kind='queue_joined'",
    )
      .bind(row!.id)
      .first<{ n: number }>())!.n,
  ).toBe(0)
  const fastest = await joinQueue(env, t.queue, crypto.randomUUID(), {
    ...input,
    preferredSpaceId: 'fastest',
  })
  expect(fastest.status).toBe(201)
  expect((await loadQueueState(env, t.queue)).adaptiveProjections[0]).toMatchObject({
    resourceId: null,
  })
})
it('validates service details and protects active preferred spaces from removal or incompatible changes', async () => {
  const { joinQueue } = await import('../queue/entries')
  const t = await setup()
  await open(t, 0)
  const input = {
    displayName: 'Test',
    partySize: 4,
    locale: 'es' as const,
    whatsapp: { consent: false as const },
  }
  for (const details of [
    { preferredSpaceId: 'missing' },
    { receptionService: 'check_in' as const },
  ]) {
    expect(
      (
        await joinQueue(env, t.queue, crypto.randomUUID(), {
          ...input,
          ...details,
        })
      ).status,
    ).toBe(400)
  }
  // A zone is still respected, but a party larger than every configured type
  // falls back to the general cadence instead of being rejected.
  expect((await joinQueue(env, t.queue, crypto.randomUUID(), {
    ...input, preferredSpaceId: 'terrace', partySize: 8,
  })).status).toBe(201)
  await joinQueue(env, t.queue, crypto.randomUUID(), {
    ...input,
    preferredSpaceId: 'terrace',
  })
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'close',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  })
  const q = await env.DB.prepare('SELECT version,config FROM queue WHERE id=?')
    .bind(t.queue)
    .first<{ version: number; config: string }>()
  const saved = JSON.parse(q!.config)
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...saved,
      version: q!.version,
      open: false,
      spaces: saved.spaces.filter((s: { id: string }) => s.id !== 'terrace'),
    }),
  ).rejects.toThrow('preferred_space_in_use')
  const reception = await setup({
    ...config,
    type: 'reception',
    spaces: [],
    receptionServices: ['check_in'],
  })
  await open(reception, 0)
  expect(
    (
      await joinQueue(env, reception.queue, crypto.randomUUID(), {
        ...input,
        receptionService: 'check_out',
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await joinQueue(env, reception.queue, crypto.randomUUID(), {
        ...input,
        receptionService: 'check_in',
      })
    ).status,
  ).toBe(201)
  expect(
    (await joinQueue(env, reception.queue, crypto.randomUUID(), input)).status,
  ).toBe(201)
})

it('retries an uncommitted manual join after a transition-plan failure without another entry or audit', async () => {
  const { joinQueue } = await import('../queue/entries')
  const projection = await import('../queue/projection')
  const t = await setup()
  await open(t, 0)
  const key = crypto.randomUUID(),
    input = {
      displayName: 'Retry',
      partySize: 2,
      locale: 'es' as const,
      whatsapp: { consent: false as const },
    }
  const fail = vi
    .spyOn(projection, 'commitQueueTransition')
    .mockRejectedValueOnce(new Error('planning_failure'))
  try {
    await expect(
      joinQueue(env, t.queue, key, input, false, t.actor),
    ).rejects.toThrow('planning_failure')
  } finally {
    fail.mockRestore()
  }
  expect(
    (await joinQueue(env, t.queue, key, input, false, t.actor)).status,
  ).toBe(201)
  expect(
    (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM queue_entry WHERE queue_id=?',
    )
      .bind(t.queue)
      .first<{ n: number }>())!.n,
  ).toBe(1)
  expect(
    (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM staff_audit WHERE venue_id=? AND action='queue.join'",
    )
      .bind(t.venueId)
      .first<{ n: number }>())!.n,
  ).toBe(1)
})

it('requires explicit WhatsApp for nonlocal manual joins and only permits the server-local exception', async () => {
  const { joinQueue, manualJoinRequiresWhatsapp } = await import(
    '../queue/entries'
  )
  const t = await setup()
  await open(t)
  const input = {
    displayName: 'Manual',
    partySize: 1,
    locale: 'es' as const,
    whatsapp: { consent: false as const },
  }
  for (const guarded of [
    { ...env, APP_ENV: 'staging' as const },
    { ...env, APP_ENV: 'sandbox' as const },
    { ...env, PUBLIC_APP_ORIGIN: 'https://app.example.com' },
  ]) {
    expect(manualJoinRequiresWhatsapp(guarded)).toBe(true)
    expect(
      await joinQueue(
        guarded,
        t.queue,
        crypto.randomUUID(),
        input,
        false,
        t.actor,
      ),
    ).toMatchObject({
      status: 400,
      body: { error: 'whatsapp_consent_required' },
    })
  }
  expect(manualJoinRequiresWhatsapp(env)).toBe(false)
  expect(
    (await joinQueue(env, t.queue, crypto.randomUUID(), input, false, t.actor))
      .status,
  ).toBe(201)
  const consented = {
    ...input,
    whatsapp: {
      consent: true as const,
      phone: '+34600000000',
      version: 'whatsapp-queue-updates-v1' as const,
    },
  }
  expect(
    await joinQueue(
      { ...env, APP_ENV: 'staging', WHATSAPP_ENABLED: 'false' },
      t.queue,
      crypto.randomUUID(),
      consented,
      false,
      t.actor,
    ),
  ).toMatchObject({ status: 503, body: { error: 'whatsapp_unavailable' } })
  const send = vi.fn().mockResolvedValue(undefined)
  expect(
    (
      await joinQueue(
        {
          ...env,
          APP_ENV: 'staging',
          NOTIFICATIONS: { send } as unknown as Queue,
        },
        t.queue,
        crypto.randomUUID(),
        consented,
        false,
        t.actor,
      )
    ).status,
  ).toBe(201)
  expect(send).toHaveBeenCalledOnce()
})

it('recovers committed manual joins after WhatsApp is disabled without sending again or admitting new joins', async () => {
  const { joinQueue } = await import('../queue/entries')
  const t = await setup()
  await open(t)
  const send = vi.fn().mockResolvedValue(undefined)
  const enabled = {
    ...env,
    APP_ENV: 'staging' as const,
    WHATSAPP_ENABLED: 'true' as const,
    NOTIFICATIONS: { send } as unknown as Queue,
  }
  const disabled = { ...enabled, WHATSAPP_ENABLED: 'false' as const }
  const key = crypto.randomUUID()
  const input = {
    displayName: 'Manual replay',
    partySize: 1,
    locale: 'es' as const,
    whatsapp: {
      consent: true as const,
      phone: '+34600000000',
      version: 'whatsapp-queue-updates-v1' as const,
    },
  }
  const created = await joinQueue(enabled, t.queue, key, input, false, t.actor)
  expect(created.status).toBe(201)
  const replay = await joinQueue(disabled, t.queue, key, input, false, t.actor)
  expect(replay.status).toBe(200)
  const receipt = created.body as { code: string; recoveryToken: string }
  expect(replay.body).toMatchObject({
    code: receipt.code,
    recoveryToken: receipt.recoveryToken,
  })
  expect(send).toHaveBeenCalledOnce()
  expect(
    await joinQueue(
      disabled,
      t.queue,
      crypto.randomUUID(),
      input,
      false,
      t.actor,
    ),
  ).toMatchObject({ status: 503, body: { error: 'whatsapp_unavailable' } })
  expect(
    await joinQueue(
      disabled,
      t.queue,
      key,
      { ...input, displayName: 'Changed' },
      false,
      t.actor,
    ),
  ).toMatchObject({ status: 409, body: { error: 'idempotency_conflict' } })
  await expect(
    joinQueue(disabled, t.queue, key, input, false, t.sales),
  ).rejects.toMatchObject({ status: 404 })
  expect(
    (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM queue_entry WHERE queue_id=?',
    )
      .bind(t.queue)
      .first<{ n: number }>())!.n,
  ).toBe(1)
  expect(
    (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id=? AND n.kind='queue_joined'",
    )
      .bind(t.queue)
      .first<{ n: number }>())!.n,
  ).toBe(1)
})

it('freezes arrival deadlines, expires unreached calls, and completes present customers without releasing resources', async () => {
  const t = await setup()
  await open(t, 0)
  const first = await entry(t.queue),
    second = await entry(t.queue)
  const now = Date.now()
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'call', entryId: first, version: 0 },
    now,
  )
  expect(
    (
      await env.DB.prepare(
        'SELECT arrival_deadline_at FROM queue_entry WHERE id=?',
      )
        .bind(first)
        .first()
    )?.arrival_deadline_at,
  ).toBe(now + 300000)
  const state = await loadQueueState(env, t.queue)
  const row = await env.DB.prepare('SELECT version,open FROM queue WHERE id=?')
    .bind(t.queue)
    .first<{ version: number; open: number }>()
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...state.config,
      version: row!.version,
      open: !!row!.open,
      approachMinutes: (state.config?.approachMinutes ?? 10) + 1,
    }),
  ).rejects.toThrow('active_approach_confirmation_required')
  await configureQueue(env, t.actor, t.queue, {
    ...state.config,
    version: row!.version,
    open: !!row!.open,
    graceMinutes: 10,
    approachTurns: 8,
    approachMinutes: (state.config?.approachMinutes ?? 10) + 1,
    applyApproachToActive: true,
  })
  expect(
    (
      await env.DB.prepare(
        'SELECT arrival_deadline_at FROM queue_entry WHERE id=?',
      )
        .bind(first)
        .first()
    )?.arrival_deadline_at,
  ).toBe(now + 300000)
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'complete', entryId: first, version: 1 },
      now + 300000,
    ),
  ).rejects.toThrow('version_conflict')
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(first)
        .first()
    )?.status,
  ).toBe('expired')
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'call', entryId: second, version: 0 },
    now + 300001,
  )
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      { action: 'restore', entryId: first, version: 2 },
      now + 300002,
    ),
  ).rejects.toThrow('restore_reason_required')
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    {
      action: 'restore',
      entryId: first,
      version: 2,
      overrideReason: 'Arrival incorrectly recorded',
    },
    now + 300002,
  )
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'call', entryId: first, version: 3, arrivalMode: 'present' },
    now + 300003,
  )
  expect((await env.DB.prepare('SELECT status,arrival_deadline_at FROM queue_entry WHERE id=?').bind(first).first())?.status).toBe('completed')
  expect((await env.DB.prepare('SELECT * FROM queue_allocation WHERE entry_id=?').bind(first).first())).toBeNull()
  expect(
    (
      await env.DB.prepare(
        'SELECT COUNT(*) n FROM queue_override_audit WHERE entry_id=?',
      )
        .bind(first)
        .first()
    )?.n,
  ).toBe(1)
  expect(
    (
      await env.DB.prepare(
        'SELECT arrival_deadline_at FROM queue_entry WHERE id=?',
      )
        .bind(first)
        .first()
    )?.arrival_deadline_at,
  ).toBeNull()
})

it('round-trips the legacy turn threshold without treating it as an active notice policy', async () => {
  const t = await setup()
  await open(t, 0)
  await entry(t.queue)
  const state = await loadQueueState(env, t.queue)
  const row = await env.DB.prepare('SELECT version,open FROM queue WHERE id=?')
    .bind(t.queue)
    .first<{ version: number; open: number }>()

  await configureQueue(env, t.actor, t.queue, {
    ...state.config,
    version: row!.version,
    open: !!row!.open,
    approachTurns: 8,
  })

  expect((await loadQueueState(env, t.queue)).config?.approachTurns).toBe(8)
})

it('preserves the promised arrival window when grace is reduced, with a legacy fallback', async () => {
  const t = await setup()
  await open(t, 0)
  const id = await entry(t.queue)
  const now = Date.now()
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    {
      action: 'call',
      entryId: id,
      version: 0,
    },
    now,
  )
  const state = await loadQueueState(env, t.queue)
  const current = await env.DB.prepare(
    'SELECT version,open FROM queue WHERE id=?',
  )
    .bind(t.queue)
    .first<{ version: number; open: number }>()
  await configureQueue(env, t.actor, t.queue, {
    ...state.config!,
    version: current!.version,
    open: !!current!.open,
    graceMinutes: 1,
  })
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      {
        action: 'no_show',
        entryId: id,
        version: 1,
      },
      now + 120000,
    ),
  ).rejects.toThrow('arrival_grace_active')
  expect(
    await env.DB.prepare(
      'SELECT status,arrival_deadline_at FROM queue_entry WHERE id=?',
    )
      .bind(id)
      .first(),
  ).toEqual({ status: 'called', arrival_deadline_at: now + 300000 })
  expect(await env.DB.prepare('SELECT * FROM queue_allocation WHERE entry_id=?').bind(id).first()).toBeNull()

  // Calls created before deadline activation retain the existing manual grace policy.
  await env.DB.prepare(
    'UPDATE queue_entry SET arrival_deadline_at=NULL WHERE id=?',
  )
    .bind(id)
    .run()
  await expect(
    runQueueCommand(
      env,
      t.actor,
      t.queue,
      crypto.randomUUID(),
      {
        action: 'no_show',
        entryId: id,
        version: 1,
      },
      now + 30000,
    ),
  ).rejects.toThrow('arrival_grace_active')
  await runQueueCommand(
    env,
    t.actor,
    t.queue,
    crypto.randomUUID(),
    {
      action: 'no_show',
      entryId: id,
      version: 1,
    },
    now + 120000,
  )
  expect(
    await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ status: 'no_show' })
  expect(await env.DB.prepare('SELECT * FROM queue_allocation WHERE entry_id=?').bind(id).first()).toBeNull()
})

it.each(['customer', 'staff'] as const)(
  'serializes concurrent update and call when %s dispatches first',
  async (first) => {
    const { hash } = await import('../queue/crypto')
    const t = await setup()
    await open(t, 0)
    const id = await entry(t.queue)
    const token = crypto.randomUUID()
    await env.DB.prepare('UPDATE queue_entry SET recovery_hash=? WHERE id=?')
      .bind(await hash(token), id)
      .run()
    const stub = env.QUEUE_COORDINATOR.getByName(t.queue)
    const customer = () =>
      stub.customerCommand(t.queue, token, crypto.randomUUID(), {
        action: 'update',
        version: 0,
        displayName: 'Updated guest',
        partySize: 2,
        preferredSpaceId: 'fastest',
        locale: 'es',
      })
    const staff = () =>
      stub.staffCommand(t.actor, t.queue, crypto.randomUUID(), {
        action: 'call',
        entryId: id,
        version: 0,
      })
    const results = await Promise.all(
      first === 'customer' ? [customer(), staff()] : [staff(), customer()],
    )
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    expect(results.find((result) => result.status === 409)?.body).toEqual({
      error: 'version_conflict',
    })
    const snapshot = await env.DB.prepare(
      'SELECT status,version,party_size FROM queue_entry WHERE id=?',
    )
      .bind(id)
      .first<{ status: string; version: number; party_size: number }>()
    expect(snapshot?.version).toBe(1)
    const customerWon =
      (first === 'customer' ? results[0] : results[1])!.status === 200
    expect(snapshot).toEqual({
      status: customerWon ? 'waiting' : 'called',
      version: 1,
      party_size: customerWon ? 2 : 4,
    })
    if (customerWon) {
      expect(
        (
          await stub.staffCommand(t.actor, t.queue, crypto.randomUUID(), {
            action: 'call',
            entryId: id,
            version: 1,
          })
        ).status,
      ).toBe(200)
    } else {
      expect(
        (
          await stub.customerCommand(t.queue, token, crypto.randomUUID(), {
            action: 'update',
            version: 1,
            displayName: 'Too late',
            partySize: 2,
            preferredSpaceId: 'fastest',
            locale: 'es',
          })
        ).body,
      ).toEqual({ error: 'invalid_transition' })
    }
    expect((await loadQueueState(env, t.queue)).allocations).toHaveLength(0)
  },
)

it('expires once when a due alarm races a staff arrival through the coordinator', async () => {
  const { runDurableObjectAlarm } = await import('cloudflare:test')
  const t = await setup()
  await open(t, 0)
  const id = await entry(t.queue)
  const stub = env.QUEUE_COORDINATOR.getByName(t.queue)
  expect(
    (
      await stub.staffCommand(t.actor, t.queue, crypto.randomUUID(), {
        action: 'call',
        entryId: id,
        version: 0,
      })
    ).status,
  ).toBe(200)
  const deadline = Date.now()
  await env.DB.prepare(
    'UPDATE queue_entry SET arrival_deadline_at=? WHERE id=?',
  )
    .bind(deadline, id)
    .run()
  const [arrival] = await Promise.all([
    stub.staffCommand(t.actor, t.queue, crypto.randomUUID(), {
      action: 'complete',
      entryId: id,
      version: 1,
    }),
    runDurableObjectAlarm(stub),
  ])
  expect(arrival.status).toBe(409)
  await stub.refresh(t.queue)
  expect(
    await env.DB.prepare('SELECT status,version FROM queue_entry WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ status: 'expired', version: 2 })
  const events = await env.DB.prepare(
    "SELECT kind FROM queue_event WHERE entry_id=? AND kind IN ('expired','completed')",
  )
    .bind(id)
    .all()
  expect(events.results).toEqual([{ kind: 'expired' }])
  expect(await env.DB.prepare('SELECT * FROM queue_allocation WHERE entry_id=?').bind(id).first()).toBeNull()
})

async function expectDirectorySnapshot(queueId: string) {
  const row = await env.DB.prepare(
    'SELECT q.config,d.source_config,d.normalized_config FROM queue q JOIN service_directory_config d ON d.queue_id=q.id WHERE q.id=?',
  )
    .bind(queueId)
    .first<{
      config: string
      source_config: string
      normalized_config: string
    }>()
  expect(row).not.toBeNull()
  expect(row!.source_config).toBe(row!.config)
  expect(JSON.parse(row!.normalized_config)).toMatchObject(
    JSON.parse(row!.config),
  )
}
it('all config producers keep source-bound directory snapshots atomic through provisioning, activation, lifecycle and reconfiguration', async () => {
  const t = await setup()
  await expectDirectorySnapshot(t.queue)
  await open(t, 0)
  await expectDirectorySnapshot(t.queue)
  expect((await loadQueueState(env, t.queue)).config?.estimationMode).toBe(
    'active',
  )
  for (const action of [
    'disable_intelligence',
    'enable_intelligence',
  ] as const) {
    const context = await openingContext(env, t.queue)
    await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
      action,
      contextToken: context.contextToken,
    })
    await expectDirectorySnapshot(t.queue)
  }
  const state = await loadQueueState(env, t.queue)
  const version = await env.DB.prepare('SELECT version FROM queue WHERE id=?')
    .bind(t.queue)
    .first<number>('version')
  await configureQueue(env, t.actor, t.queue, {
    ...state.config!,
    name: 'Updated Restaurant',
    version,
    open: true,
  })
  await expectDirectorySnapshot(t.queue)
  const before = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
    .bind(t.queue)
    .first('config')
  await env.DB.exec(
    "CREATE TRIGGER reject_directory BEFORE INSERT ON service_directory_config BEGIN SELECT RAISE(ABORT,'fixture snapshot failure'); END",
  )
  const nextVersion = await env.DB.prepare(
    'SELECT version FROM queue WHERE id=?',
  )
    .bind(t.queue)
    .first<number>('version')
  await expect(
    configureQueue(env, t.actor, t.queue, {
      ...(await loadQueueState(env, t.queue)).config!,
      name: 'Must roll back',
      version: nextVersion,
      open: true,
    }),
  ).rejects.toThrow()
  expect(
    await env.DB.prepare('SELECT config FROM queue WHERE id=?')
      .bind(t.queue)
      .first('config'),
  ).toBe(before)
  await env.DB.exec('DROP TRIGGER reject_directory')
  await expectDirectorySnapshot(t.queue)
})
it('failed provisioning snapshot insertion leaves no organization or service from its transaction', async () => {
  const organizations = await env.DB.prepare(
    'SELECT count(*) n FROM organization',
  ).first('n')
  const queues = await env.DB.prepare('SELECT count(*) n FROM queue').first('n')
  await env.DB.exec(
    "CREATE TRIGGER reject_directory BEFORE INSERT ON service_directory_config BEGIN SELECT RAISE(ABORT,'fixture snapshot failure'); END",
  )
  await expect(setup()).rejects.toThrow()
  expect(
    await env.DB.prepare('SELECT count(*) n FROM organization').first('n'),
  ).toBe(organizations)
  expect(await env.DB.prepare('SELECT count(*) n FROM queue').first('n')).toBe(
    queues,
  )
  await env.DB.exec('DROP TRIGGER reject_directory')
})

it('declares active without a survey, retains legacy records, and resumes without inventory work', async () => {
  const t = await setup()
  const e = await entry(t.queue)
  const allocated = await entry(t.queue, 'called')
  await env.DB.prepare(
    'INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at) VALUES (?,?,?,?,?,?)',
  )
    .bind(allocated, t.queue, 'terrace:4:0', 'terrace', 4, 100)
    .run()
  await env.DB.prepare(
    'INSERT INTO queue_external_occupancy VALUES (?,?,?,?,?)',
  )
    .bind(t.queue, 'terrace:4:1', 'terrace', 4, 200)
    .run()
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'declare_full',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  })
  expect((await openingContext(env, t.queue)).queueState).toBe('active')
  expect((await loadQueueState(env, t.queue)).holds).toHaveLength(0)
  expect(
    (
      await env.DB.prepare(
        'SELECT recorded_at FROM queue_external_occupancy WHERE queue_id=? AND resource_id=?',
      )
        .bind(t.queue, 'terrace:4:1')
        .first<{ recorded_at: number }>()
    )?.recorded_at,
  ).toBe(200)
  await runQueueCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'call', entryId: e, version: 0,
  })
  const retired = await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'release_unit',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  } as never).catch(error => error)
  expect(retired).toMatchObject({status:410,message:'operation_retired'})
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'pause',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  })
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'resume',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  })
  expect((await loadQueueState(env, t.queue)).holds).toHaveLength(0)
  expect(
    await env.DB.prepare('SELECT reserved_at FROM queue_allocation WHERE entry_id=?')
      .bind(allocated)
      .first(),
  ).toEqual({ reserved_at: 100 })
})
it('does not activate an acknowledged reminder and automatically opens new pool services', async () => {
  const t = await setup()
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'dismiss_reminder',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  })
  expect((await openingContext(env, t.queue)).queueState).toBe('inactive')
  const pool = await setup({ ...config, type: 'pool' })
  expect((await openingContext(env, pool.queue)).queueState).toBe('active')
  expect((await loadQueueState(env, pool.queue)).holds).toHaveLength(0)
})

it('publishes independent admission fields and rejects fresh joins until restaurant activation', async () => {
  const { publicService } = await import('../queue/public-context')
  const { joinQueue } = await import('../queue/entries')
  const t = await setup()
  const service = await publicService(env, t.queue)
  expect(service?.serviceOpen).toBe(true)
  expect(service?.queueState).toBe('inactive')
  expect(service?.canJoin).toBe(false)
  const input = {
    displayName: 'Guest',
    partySize: 4,
    locale: 'es' as const,
    whatsapp: { consent: false as const },
  }
  expect(
    (await joinQueue(env, t.queue, crypto.randomUUID(), input)).status,
  ).toBe(409)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'declare_full',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  })
  expect((await publicService(env, t.queue))?.initialWaitingMarker).toBe(true)
  expect(
    (
      await joinQueue(env, t.queue, crypto.randomUUID(), {
        ...input,
        partySize: 5,
      })
    ).status,
  ).toBe(201)
})

it('additive admission migration preserves tickets, allocations and external occupancy', async () => {
  const restaurant = await setup()
  const ticket = await entry(restaurant.queue)
  await open(restaurant, 1)
  await runQueueCommand(
    env,
    restaurant.actor,
    restaurant.queue,
    crypto.randomUUID(),
    { action: 'call', entryId: ticket, version: 0 },
  )
  // Preserve legacy persistence compatibility without treating a new call as
  // a physical allocation/occupancy mutation.
  await env.DB.prepare(
    "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at) VALUES (?,?,'terrace:4:0','terrace',4,?)",
  )
    .bind(ticket, restaurant.queue, Date.now())
    .run()
  await env.DB.prepare(
    "INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?,'terrace:4:1','terrace',4,?)",
  )
    .bind(restaurant.queue, Date.now())
    .run()
  const pool = await setup({ ...config, type: 'pool', spaces: [] })
  const before = await env.DB.prepare('SELECT * FROM queue_entry WHERE id=?')
    .bind(ticket)
    .first()
  const holds = await env.DB.prepare(
    'SELECT * FROM queue_external_occupancy WHERE queue_id=?',
  )
    .bind(restaurant.queue)
    .all()
  const allocations = await env.DB.prepare(
    'SELECT * FROM queue_allocation WHERE queue_id=?',
  )
    .bind(restaurant.queue)
    .all()
  expect(allocations.results).toHaveLength(1)
  expect(holds.results).toHaveLength(1)
  await env.DB.prepare('DELETE FROM queue_admission WHERE queue_id IN (?,?)')
    .bind(restaurant.queue, pool.queue)
    .run()
  await env.DB.prepare('UPDATE queue SET open=0 WHERE id=?')
    .bind(pool.queue)
    .run()
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.includes('0012'))!
  const insert = migration.queries.find((sql) =>
    sql.includes('INSERT INTO queue_admission'),
  )!
  // Replay only over this migration fixture; other tests retain already-migrated queues.
  await env.DB.prepare(insert.replace(/;\s*$/, '') + ' AND q.id IN (?,?)')
    .bind(restaurant.queue, pool.queue)
    .run()
  expect(
    await env.DB.prepare('SELECT * FROM queue_entry WHERE id=?')
      .bind(ticket)
      .first(),
  ).toEqual(before)
  expect(
    (
      await env.DB.prepare(
        'SELECT * FROM queue_external_occupancy WHERE queue_id=?',
      )
        .bind(restaurant.queue)
        .all()
    ).results,
  ).toEqual(holds.results)
  expect(
    (
      await env.DB.prepare('SELECT * FROM queue_allocation WHERE queue_id=?')
        .bind(restaurant.queue)
        .all()
    ).results,
  ).toEqual(allocations.results)
  expect((await openingContext(env, restaurant.queue)).queueState).toBe(
    'inactive',
  )
  expect((await openingContext(env, pool.queue)).queueState).toBe('paused')
  const fresh = await setup({ ...config, type: 'pool', spaces: [] })
  expect((await openingContext(env, fresh.queue)).queueState).toBe('active')
})

it('accepts legacy open payloads but ignores their occupancy declarations', async () => {
  const t = await setup()
  const before = await openingContext(env, t.queue)
  const snapshot = async () => ({
    queue: await env.DB.prepare(
      'SELECT open,version,config FROM queue WHERE id=?',
    )
      .bind(t.queue)
      .first(),
    admission: await env.DB.prepare(
      'SELECT * FROM queue_admission WHERE queue_id=?',
    )
      .bind(t.queue)
      .first(),
    holds: (
      await env.DB.prepare(
        'SELECT * FROM queue_external_occupancy WHERE queue_id=?',
      )
        .bind(t.queue)
        .all()
    ).results,
    inventory: (
      await env.DB.prepare(
        'SELECT * FROM queue_inventory_audit WHERE queue_id=?',
      )
        .bind(t.queue)
        .all()
    ).results,
    audit: (
      await env.DB.prepare('SELECT * FROM staff_audit WHERE target_id=?')
        .bind(t.queue)
        .all()
    ).results,
  })
  const saved = await snapshot()
  const groups = before.groups.map((g) => ({
    spaceId: g.spaceId,
    seats: g.seats,
    occupied: 0,
  }))
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'open', contextToken: before.contextToken, groups,
  } as never)
  const current = await openingContext(env, t.queue)
  expect(current.queueState).toBe('active')
  expect(current.groups).toHaveLength(0)
  const after = await snapshot()
  expect(after.holds).toEqual(saved.holds)
  expect(after.inventory).toEqual(saved.inventory)
  expect(after.admission).not.toBeNull()
  expect(await openingContext(env, t.queue)).toMatchObject({
    queueState: 'active',
    canJoin: true,
  })
})

it('accepts legacy opening payloads while preserving historical allocations and holds', async () => {
  const t = await setup()
  const ticket = await entry(t.queue, 'called')
  await env.DB.prepare(
    'INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at) VALUES (?,?,?,?,?,?)',
  )
    .bind(ticket, t.queue, 'terrace:4:0', 'terrace', 4, 123)
    .run()
  await env.DB.prepare(
    'INSERT INTO queue_external_occupancy(queue_id,resource_id,space_id,seats,recorded_at) VALUES (?,?,?,?,?)',
  )
    .bind(t.queue, 'terrace:4:1', 'terrace', 4, 77)
    .run()
  const allocation = await env.DB.prepare(
    'SELECT * FROM queue_allocation WHERE entry_id=?',
  )
    .bind(ticket)
    .first()
  const context = await openingContext(env, t.queue)
  const key = crypto.randomUUID(),
    input = {
      action: 'open' as const,
      contextToken: context.contextToken,
      groups: context.groups.map((g) => ({
        spaceId: g.spaceId, seats: g.seats, occupied: g.count - g.allocated,
      })),
    }
  await runLifecycleCommand(env, t.actor, t.queue, key, input as never)
  expect(await openingContext(env, t.queue)).toMatchObject({
    queueState: 'active',
    canJoin: true,
  })
  expect(
    await env.DB.prepare('SELECT * FROM queue_allocation WHERE entry_id=?')
      .bind(ticket)
      .first(),
  ).toEqual(allocation)
  expect(
    await env.DB.prepare(
      'SELECT recorded_at FROM queue_external_occupancy WHERE queue_id=? AND resource_id=?',
    )
      .bind(t.queue, 'terrace:4:1')
      .first(),
  ).toEqual({ recorded_at: 77 })
  expect((await openingContext(env, t.queue)).groups).toHaveLength(0)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'pause',
    contextToken: (await openingContext(env, t.queue)).contextToken,
  })
  await runLifecycleCommand(env, t.actor, t.queue, key, input as never)
  expect((await openingContext(env, t.queue)).queueState).toBe('paused')
})

it('opens legacy restaurants even when resource topology is incomplete', async () => {
  const t = await setup({
    ...config,
    spaces: [{ id: 'unknown', name: 'Unknown', tables: 1 }],
  })
  const context = await openingContext(env, t.queue)
  await runLifecycleCommand(env, t.actor, t.queue, crypto.randomUUID(), {
    action: 'open', contextToken: context.contextToken,
  })
  expect((await openingContext(env, t.queue)).queueState).toBe('active')
})

it('migration conservatively pauses every existing automatic value except exactly one and expires only scheduled windows', async () => {
  const { admissionState, resolveAdmission } = await import('./availability')
  const queues: { queue: string; value: number; scheduled: boolean }[] = []
  for (const scheduled of [false, true])
    for (const value of [-1, 0, 1, 2]) {
      const service = {
        ...config,
        type: 'pool' as const,
        spaces: [],
        twentyFourHours: !scheduled,
        schedules: scheduled
          ? Array.from({ length: 7 }, (_, day) => ({
              day,
              from: '00:00',
              to: '23:59',
            }))
          : [],
      }
      const t = await setup(service)
      await env.DB.prepare('UPDATE queue SET open=? WHERE id=?')
        .bind(value, t.queue)
        .run()
      queues.push({ queue: t.queue, value, scheduled })
    }
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.includes('0012'))!
  const migrationSql = migration.queries.find((sql) =>
    sql.includes('INSERT INTO queue_admission'),
  )!
  await env.DB.prepare(
    migrationSql.replace(/;\s*$/, '') +
      ` AND q.id IN (${queues.map(() => '?').join(',')});`,
  )
    .bind(...queues.map((q) => q.queue))
    .run()
  for (const { queue, value, scheduled } of queues) {
    const state = await admissionState(env, queue)
    expect(state?.queueState).toBe(value === 1 ? 'active' : 'paused')
    const row = await env.DB.prepare(
      'SELECT * FROM queue_admission WHERE queue_id=?',
    )
      .bind(queue)
      .first<import('./availability').AdmissionRecord>()
    if (value === 1) expect(row).toBeNull()
    else {
      expect(row?.legacy_config).toBeTruthy()
      const service = JSON.parse(row!.legacy_config!) as ServiceInput
      const next = new Date(row!.legacy_paused_at! + 7 * 86400000)
      expect(
        resolveAdmission(service, 'Europe/Madrid', row, 0, next).queueState,
      ).toBe(scheduled ? 'active' : 'paused')
    }
  }
  const fresh = await setup({ ...config, type: 'pool', spaces: [] })
  expect((await admissionState(env, fresh.queue))?.queueState).toBe('active')
  const columns = (
    await env.DB.prepare('PRAGMA table_info(queue)').all<{
      name: string
      notnull: number
    }>()
  ).results
  expect(columns.find((c) => c.name === 'open')?.notnull).toBe(1)
})

it('recovers committed zero-occupancy legacy requests without activating a later restaurant window', async () => {
  const { hash } = await import('../queue/crypto')
  const t = await setup()
  const context = await openingContext(env, t.queue)
  const key = crypto.randomUUID()
  const input = {
    action: 'open' as const,
    contextToken: context.contextToken,
    groups: context.groups.map((group) => ({
      spaceId: group.spaceId,
      seats: group.seats,
      occupied: 0,
    })),
  }
  // Simulate a legacy command committed before the full-declaration requirement.
  await env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)')
    .bind(
      t.actor,
      key,
      await hash(JSON.stringify({ queueId: t.queue, lifecycle: input })),
      JSON.stringify({ ok: true }),
    )
    .run()
  const before = await env.DB.prepare(
    'SELECT * FROM queue_admission WHERE queue_id=?',
  )
    .bind(t.queue)
    .first()
  await expect(
    runLifecycleCommand(env, t.actor, t.queue, key, input as never),
  ).resolves.toEqual({ ok: true })
  expect(
    await env.DB.prepare('SELECT * FROM queue_admission WHERE queue_id=?')
      .bind(t.queue)
      .first(),
  ).toEqual(before)
  expect(await openingContext(env, t.queue)).toMatchObject({
    queueState: 'inactive',
    canJoin: false,
  })
  expect(
    (
      await env.DB.prepare(
        'SELECT * FROM queue_external_occupancy WHERE queue_id=?',
      )
        .bind(t.queue)
        .all()
    ).results,
  ).toEqual([])
})

it('persists grouped calendars and refuses a legacy downgrade without changing stored groups', async () => {
  const { twentyFourHours: _always, schedules: _slots, ...common } = config
  const grouped: ServiceInput = { ...common, scheduleGroups: [{ days: [0,1,2,3,4,5,6], twentyFourHours: true, ranges: [] }] }
  const t = await setup(grouped)
  const context = await openingContext(env, t.queue)
  await expect(configureQueue(env, t.actor, t.queue, { ...config, version: context.version, open: context.open })).rejects.toThrow('schedule_format_conflict')
  expect((await loadQueueState(env, t.queue)).config?.scheduleGroups).toEqual(grouped.scheduleGroups)
})
