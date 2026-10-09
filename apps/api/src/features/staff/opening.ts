import { touchVenueConfiguration } from './configuration'
import { admissionState } from './availability'
import { directoryConfigStatement } from '../discovery/configuration'
import {
  queueLifecycleSchema,
  type QueueLifecycleCommand,
  type QueueOpeningContext,
} from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'
import { audit, queueAccess } from '../../auth/access'
import { hash } from '../queue/crypto'
import { loadQueueState, recalculateQueue } from '../queue/projection'
import {
  configurationComplete,
  inventoryConfirmed,
  readiness,
  resourceGroups,
  topology,
} from '../queue/opening-state'

/** Run through the queue coordinator, including reads used to establish a mutation snapshot. */
export async function openingContext(
  env: CloudflareBindings,
  queueId: string,
): Promise<QueueOpeningContext> {
  const state = await loadQueueState(env, queueId)
  if (!state.config)
    throw new HTTPException(409, { message: 'invalid_settings' })
  const queue = await env.DB.prepare(
    'SELECT open,version FROM queue WHERE id=?',
  )
    .bind(queueId)
    .first<{ open: number; version: number }>()
  const entries = (
    await env.DB.prepare(
      "SELECT id,status,version FROM queue_entry WHERE queue_id=? AND status IN ('waiting','called','completed') ORDER BY id",
    )
      .bind(queueId)
      .all<{ id: string; status: string; version: number }>()
  ).results
  const status = await readiness(env, queueId, state.config)
  const groups = (
    state.config.type === 'restaurant' ? resourceGroups(state.config) : []
  ).map((group) => ({
    ...group,
    allocated: state.allocations.filter(
      (a) =>
        a.released_at === null &&
        a.space_id === group.spaceId &&
        a.seats === group.seats,
    ).length,
    occupied: state.holds.filter(
      (a) => a.space_id === group.spaceId && a.seats === group.seats,
    ).length,
  }))
  const admission = await admissionState(env, queueId)
  return {
    ...admission,
    inventoryConfirmed: await inventoryConfirmed(env, queueId, state.config),
    open: admission?.queueState === 'active',
    version: queue!.version,
    contextToken: await hash(
      JSON.stringify({
        queueId,
        queue,
        admissionWindow: admission?.windowId,
        admissionState: admission?.queueState,
        reminderId: admission?.reminderId,
        config: state.config,
        entries,
        allocations: state.allocations
          .filter((a) => a.released_at === null)
          .sort((a, b) => a.resource_id.localeCompare(b.resource_id)),
        holds: [...state.holds].sort((a, b) =>
          a.resource_id.localeCompare(b.resource_id),
        ),
        status,
      }),
    ),
    pendingCount: entries.filter((e) => e.status !== 'completed').length,
    untrackedCount:
      state.config.type !== 'restaurant'
        ? 0
        : entries.filter(
            (e) =>
              e.status !== 'waiting' &&
              !state.allocations.some(
                (a) => a.entry_id === e.id && a.released_at === null,
              ),
          ).length,
    readiness: status,
    groups,
  }
}
export async function runLifecycleCommand(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  key: string,
  input: QueueLifecycleCommand,
) {
  const access = await queueAccess(env, actor, queueId, 'queue.operate')
  const parsed = queueLifecycleSchema.safeParse(input)
  if (!parsed.success) {
    // The legacy schema catches duplicate answers before semantic validation.
    // Restaurant activation must still return the explicit declaration error.
    if (input.action === 'open') {
      const state = await loadQueueState(env, queueId)
      if (state.config?.type === 'restaurant')
        throw new HTTPException(409, {
          message: configurationComplete(state.config)
            ? 'full_declaration_required'
            : 'configuration_missing',
        })
    }
    throw new HTTPException(400, { message: 'invalid_inventory' })
  }
  input = parsed.data
  const fingerprint = await hash(JSON.stringify({ queueId, lifecycle: input }))
  const previous = await env.DB.prepare(
    'SELECT request_hash,result FROM staff_command WHERE actor_id=? AND request_key=?',
  )
    .bind(actor, key)
    .first<{ request_hash: string; result: string }>()
  if (previous) {
    if (previous.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    await recalculateQueue(env, queueId)
    return { ok: true }
  }
  const context = await openingContext(env, queueId)
  if (input.contextToken !== context.contextToken)
    throw new HTTPException(409, { message: 'version_conflict' })
  if (
    (input.action === 'open' && context.open && context.inventoryConfirmed) ||
    (input.action === 'close' && !context.open)
  )
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (input.action === 'confirm_inventory') {
    if (context.inventoryConfirmed)
      throw new HTTPException(409, { message: 'inventory_already_confirmed' })
    if (context.readiness.reasons.includes('configuration_missing'))
      throw new HTTPException(409, { message: 'configuration_missing' })
  }
  const state = await loadQueueState(env, queueId),
    config = state.config!,
    now = Date.now()
  if (
    config.type !== 'restaurant' &&
    ['confirm_inventory', 'occupancy', 'release_unit'].includes(input.action)
  )
    throw new HTTPException(409, { message: 'unsupported_action' })
  const legacyRestaurantOpen =
    input.action === 'open' && config.type === 'restaurant'
  if (legacyRestaurantOpen) {
    if (!configurationComplete(config))
      throw new HTTPException(409, { message: 'configuration_missing' })
    const groups = input.action === 'open' ? input.groups : []
    const identities = new Set(
      groups.map((group) => JSON.stringify([group.spaceId, group.seats])),
    )
    if (
      groups.length !== context.groups.length ||
      identities.size !== context.groups.length ||
      !context.groups.every((group) =>
        groups.some(
          (answer) =>
            answer.spaceId === group.spaceId &&
            answer.seats === group.seats &&
            answer.occupied === group.count - group.allocated,
        ),
      )
    )
      throw new HTTPException(409, { message: 'full_declaration_required' })
  }
  // A verified legacy request is an alias, not a client-controlled inventory path.
  const statements: D1PreparedStatement[] = []
  const activates = ['declare_full', 'resume', 'open'].includes(input.action)
  if (activates && (!context.serviceOpen || context.blockReason === 'cutoff'))
    throw new HTTPException(409, { message: 'outside_admission_hours' })
  if (
    input.action === 'declare_full' &&
    (config.type !== 'restaurant' || !configurationComplete(config))
  )
    throw new HTTPException(409, { message: 'configuration_missing' })
  if (
    input.action === 'resume' &&
    (context.queueState !== 'paused' ||
      (config.type === 'restaurant' && !context.activatedAt))
  )
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (input.action === 'pause' && context.queueState !== 'active')
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (
    [
      'declare_full',
      'resume',
      'open',
      'pause',
      'close',
      'dismiss_reminder',
    ].includes(input.action)
  ) {
    const override =
      input.action === 'dismiss_reminder'
        ? context.queueState === 'inactive'
          ? null
          : context.queueState ?? null
        : activates
        ? 'active'
        : 'paused'
    statements.push(
      env.DB.prepare(
        `INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at,reminder_ack)
      VALUES (?,?,?,?,?) ON CONFLICT(queue_id) DO UPDATE SET window_id=excluded.window_id,
      override_state=excluded.override_state,
      activated_at=excluded.activated_at,reminder_ack=excluded.reminder_ack,legacy_paused_at=NULL`,
      ).bind(
        queueId,
        context.windowId ?? null,
        override,
        activates ? context.activatedAt ?? now : context.activatedAt ?? null,
        context.reminderId ?? null,
      ),
    )
  }
  if (input.action === 'release_unit') {
    const group = context.groups.find(
      (g) => g.spaceId === input.spaceId && g.seats === input.seats,
    )
    if (!group) throw new HTTPException(400, { message: 'invalid_inventory' })
    const hold = state.holds.find(
      (h) => h.space_id === group.spaceId && h.seats === group.seats,
    )
    if (!hold)
      throw new HTTPException(409, { message: 'no_external_occupancy' })
    statements.push(
      env.DB.prepare(
        'DELETE FROM queue_external_occupancy WHERE queue_id=? AND resource_id=?',
      ).bind(queueId, hold.resource_id),
    )
  }
  if (
    config.type === 'restaurant' &&
    (input.action === 'declare_full' ||
      input.action === 'open' ||
      input.action === 'confirm_inventory' ||
      input.action === 'occupancy')
  ) {
    const answers =
      input.action === 'occupancy'
        ? [input.group]
        : input.action === 'declare_full' || legacyRestaurantOpen
        ? context.groups.map((g) => ({
            spaceId: g.spaceId,
            seats: g.seats,
            occupied: g.count - g.allocated,
          }))
        : input.groups
    if (
      input.action !== 'occupancy' &&
      answers.length !== context.groups.length
    )
      throw new HTTPException(400, { message: 'incomplete_inventory' })
    for (const answer of answers) {
      const group = context.groups.find(
        (g) => g.spaceId === answer.spaceId && g.seats === answer.seats,
      )
      if (!group || answer.occupied > group.count - group.allocated)
        throw new HTTPException(400, { message: 'invalid_inventory' })
      const occupiedSlots = new Set(
        state.allocations
          .filter((a) => a.released_at === null)
          .map((a) => a.resource_id),
      )
      const availableIds = Array.from(
        { length: group.count },
        (_, i) => `${group.spaceId}:${group.seats}:${i}`,
      ).filter((id) => !occupiedSlots.has(id))
      // Reconcile only the delta: unchanged external timestamps and ticket allocations survive.
      const prior = state.holds.filter(
        (h) => h.space_id === group.spaceId && h.seats === group.seats,
      )
      const keep = prior.slice(0, answer.occupied)
      for (const hold of prior.slice(answer.occupied))
        statements.push(
          env.DB.prepare(
            'DELETE FROM queue_external_occupancy WHERE queue_id=? AND resource_id=?',
          ).bind(queueId, hold.resource_id),
        )
      const additional = availableIds
        .filter((id) => !prior.some((h) => h.resource_id === id))
        .slice(0, Math.max(0, answer.occupied - keep.length))
      for (const resourceId of additional)
        statements.push(
          env.DB.prepare(
            'INSERT INTO queue_external_occupancy VALUES (?,?,?,?,?)',
          ).bind(queueId, resourceId, group.spaceId, group.seats, now),
        )
    }
  }
  if (
    config.type === 'restaurant' &&
    (input.action === 'declare_full' ||
      input.action === 'open' ||
      input.action === 'confirm_inventory')
  ) {
    const complete = configurationComplete(config)
    if (complete)
      statements.push(
        env.DB.prepare(
          'INSERT INTO queue_inventory_audit VALUES (?,?,?,?,?,?)',
        ).bind(
          crypto.randomUUID(),
          queueId,
          actor,
          'inventory_confirmed',
          JSON.stringify({ topology: topology(config) }),
          now,
        ),
      )
    statements.push(
      env.DB.prepare(
        'INSERT INTO queue_opening VALUES (?,?,?,?,?) ON CONFLICT(queue_id) DO UPDATE SET topology=excluded.topology,complete=excluded.complete,opened_at=excluded.opened_at,actor_id=excluded.actor_id',
      ).bind(queueId, topology(config), Number(complete), now, actor),
    )
    const source = JSON.stringify({
      ...config,
      estimationMode: 'shadow',
      resourceStateKnown: complete,
    })
    // Activation happens after the atomic inventory write, through the same projection path.
    statements.push(
      env.DB.prepare(
        `UPDATE queue SET ${
          input.action === 'open' || input.action === 'declare_full'
            ? 'open=1,'
            : ''
        }config=?,version=version+1 WHERE id=?`,
      ).bind(source, queueId),
      directoryConfigStatement(env, queueId, source),
    )
  } else if (
    input.action === 'disable_intelligence' ||
    input.action === 'enable_intelligence'
  ) {
    const nextPolicy =
      input.action === 'disable_intelligence' ? 'disabled' : 'automatic'
    if (nextPolicy !== (config.intelligencePolicy ?? 'automatic'))
      statements.push(touchVenueConfiguration(env, access.venueId, now))
    const source = JSON.stringify({
      ...config,
      intelligencePolicy:
        input.action === 'disable_intelligence' ? 'disabled' : 'automatic',
      estimationMode: 'shadow',
    })
    statements.push(
      env.DB.prepare(
        'UPDATE queue SET config=?,version=version+1 WHERE id=?',
      ).bind(source, queueId),
      directoryConfigStatement(env, queueId, source),
    )
  } else
    statements.push(
      env.DB.prepare(
        `UPDATE queue SET ${
          input.action === 'close' || input.action === 'pause'
            ? 'open=0,'
            : input.action === 'resume'
            ? 'open=1,'
            : ''
        }version=version+1 WHERE id=?`,
      ).bind(queueId),
    )
  statements.push(
    env.DB.prepare(
      'INSERT INTO queue_inventory_audit VALUES (?,?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      queueId,
      actor,
      input.action,
      JSON.stringify({
        ...input,
        ...(input.action === 'release_unit'
          ? { reason: 'operator_released_external_unit' }
          : {}),
        ...(input.action === 'disable_intelligence' ||
        input.action === 'enable_intelligence'
          ? {
              previousPolicy: config.intelligencePolicy ?? 'automatic',
              policy:
                input.action === 'disable_intelligence'
                  ? 'disabled'
                  : 'automatic',
            }
          : {}),
      }),
      now,
    ),
    audit(
      env,
      actor,
      access.organizationId,
      access.venueId,
      `queue.${input.action}`,
      queueId,
    ),
    env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)').bind(
      actor,
      key,
      fingerprint,
      JSON.stringify({ ok: true }),
    ),
  )
  await env.DB.batch(statements)
  await recalculateQueue(env, queueId)
  return { ok: true }
}
