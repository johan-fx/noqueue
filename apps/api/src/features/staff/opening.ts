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
  const groups = resourceGroups(state.config).map((group) => ({
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
  return {
    inventoryConfirmed: await inventoryConfirmed(env, queueId, state.config),
    open: !!queue!.open,
    version: queue!.version,
    contextToken: await hash(
      JSON.stringify({
        queueId,
        queue,
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
    untrackedCount: entries.filter(
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
  if (!parsed.success)
    throw new HTTPException(400, { message: 'invalid_inventory' })
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
    (input.action === 'open' && context.open) ||
    (input.action === 'close' && !context.open)
  )
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (input.action === 'confirm_inventory') {
    if (!context.open)
      throw new HTTPException(409, { message: 'invalid_transition' })
    if (context.inventoryConfirmed)
      throw new HTTPException(409, { message: 'inventory_already_confirmed' })
    if (context.readiness.reasons.includes('configuration_missing'))
      throw new HTTPException(409, { message: 'configuration_missing' })
  }
  const state = await loadQueueState(env, queueId),
    config = state.config!,
    now = Date.now()
  const statements: D1PreparedStatement[] = []
  if (
    input.action === 'open' ||
    input.action === 'confirm_inventory' ||
    input.action === 'occupancy'
  ) {
    const answers = input.action === 'occupancy' ? [input.group] : input.groups
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
      // Reconcile external holds only. Queue-owned reservations and arrival timestamps are immutable here.
      statements.push(
        env.DB.prepare(
          'DELETE FROM queue_external_occupancy WHERE queue_id=? AND space_id=? AND seats=?',
        ).bind(queueId, group.spaceId, group.seats),
      )
      for (const resourceId of availableIds.slice(0, answer.occupied))
        statements.push(
          env.DB.prepare(
            'INSERT INTO queue_external_occupancy VALUES (?,?,?,?,?)',
          ).bind(queueId, resourceId, group.spaceId, group.seats, now),
        )
    }
  }
  if (input.action === 'open' || input.action === 'confirm_inventory') {
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
          input.action === 'open' ? 'open=1,' : ''
        }config=?,version=version+1 WHERE id=?`,
      ).bind(source, queueId),
      directoryConfigStatement(env, queueId, source),
    )
  } else if (
    input.action === 'disable_intelligence' ||
    input.action === 'enable_intelligence'
  ) {
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
          input.action === 'close' ? 'open=0,' : ''
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
