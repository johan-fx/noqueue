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
import {
  loadQueueState,
  recalculateQueue,
  commitQueueTransition,
  maintainQueue,
  type QueueModelInput,
} from '../queue/projection'
import { inventoryConfirmed, readiness } from '../queue/opening-state'

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
        status,
      }),
    ),
    pendingCount: entries.filter((e) => e.status !== 'completed').length,
    untrackedCount: 0,
    readiness: status,
    groups: [],
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
  if (['release_unit', 'confirm_inventory', 'occupancy'].includes(input.action))
    throw new HTTPException(410, { message: 'operation_retired' })
  const parsed = queueLifecycleSchema.safeParse(input)
  if (!parsed.success)
    throw new HTTPException(400, { message: 'invalid_command' })
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
  await maintainQueue(env, queueId)
  const context = await openingContext(env, queueId)
  if (input.contextToken !== context.contextToken)
    throw new HTTPException(409, { message: 'version_conflict' })
  if (
    (input.action === 'open' && context.open) ||
    (input.action === 'close' && !context.open)
  )
    throw new HTTPException(409, { message: 'invalid_transition' })
  const now = Date.now()
  const state = await loadQueueState(env, queueId, now),
    config = state.config!
  const after: QueueModelInput = {
    config,
    allocations: state.allocations,
    parties: state.parties,
    holds: state.holds.map((h) => ({ ...h })),
  }
  const statements: D1PreparedStatement[] = []
  const activates = ['declare_full', 'resume', 'open'].includes(input.action)
  if (activates) after.demandActive = true
  if (input.action === 'pause' || input.action === 'close')
    after.demandActive = false
  if (activates && (!context.serviceOpen || context.blockReason === 'cutoff'))
    throw new HTTPException(409, { message: 'outside_admission_hours' })
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
  if (
    input.action === 'disable_intelligence' ||
    input.action === 'enable_intelligence'
  ) {
    const nextPolicy =
      input.action === 'disable_intelligence' ? 'disabled' : 'automatic'
    if (nextPolicy !== (config.intelligencePolicy ?? 'automatic'))
      statements.push(touchVenueConfiguration(env, access.venueId, now))
    after.config = {
      ...config,
      intelligencePolicy:
        input.action === 'disable_intelligence' ? 'disabled' : 'automatic',
      estimationMode: nextPolicy === 'disabled' ? 'shadow' : 'active',
    }
    const source = JSON.stringify(after.config)
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
            : activates
            ? 'open=1,'
            : ''
        }version=version+1 WHERE id=?`,
      ).bind(queueId),
    )
  statements.push(
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
  await commitQueueTransition(env, queueId, state, after, statements, now)
  await recalculateQueue(env, queueId, now)
  return { ok: true }
}
