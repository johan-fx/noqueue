import { maintainServiceEntries } from '../queue/service-expiry'
import { assignmentContext } from './assignment'
import { noticeStatement, publishNotice } from '../queue/notices'
import { admissionState } from './availability'
import { directoryConfigStatement } from '../discovery/configuration'
import { expireArrivals } from '../queue/customer'
import { topology } from '../queue/opening-state'
import {
  loadQueueState,
  normalizeConfig,
  recalculateQueue,
} from '../queue/projection'
import {
  queueCommandSchema,
  queueSettingsSchema,
  type QueueCommand,
  type EntryCommand,
  allowedEntryActions,
} from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'
import { queueAccess, audit } from '../../auth/access'
import { hash } from '../queue/crypto'
export async function runQueueCommand(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  key: string,
  command: QueueCommand,
  now = Date.now(),
) {
  const access = await queueAccess(env, actor, queueId, 'queue.operate')
  queueCommandSchema.parse(command)
  const fingerprint = await hash(JSON.stringify({ queueId, input: command }))
  const previous = await env.DB.prepare(
    'SELECT request_hash,result FROM staff_command WHERE actor_id=? AND request_key=?',
  )
    .bind(actor, key)
    .first<{ request_hash: string; result: string }>()
  if (previous) {
    if (previous.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    await recalculateQueue(env, queueId, now)
    return JSON.parse(previous.result) as { ok: true }
  }
  await expireArrivals(env, queueId, now)
  const state = await recalculateQueue(env, queueId, now)
  const quick = state.config?.type !== 'restaurant'
  let input: EntryCommand
  if (command.action === 'assign_next') {
    if (!quick) throw new HTTPException(409, { message: 'unsupported_action' })
    const first = await env.DB.prepare(
      "SELECT id,version FROM queue_entry WHERE queue_id=? AND status='waiting' ORDER BY sequence,id LIMIT 1",
    )
      .bind(queueId)
      .first<{ id: string; version: number }>()
    if (!first) throw new HTTPException(409, { message: 'queue_empty' })
    input = { action: 'call', entryId: first.id, version: first.version }
  } else input = command
  const entry = await env.DB.prepare(
    'SELECT status,version,called_at,arrival_deadline_at,service_window_id,service_ends_at,call_cycle FROM queue_entry WHERE id=? AND queue_id=?',
  )
    .bind(input.entryId, queueId)
    .first<{
      status: string
      version: number
      called_at: number | null
      arrival_deadline_at: number | null
      service_window_id: string | null
      service_ends_at: number | null
      call_cycle: number
    }>()
  if (!entry) throw new HTTPException(404, { message: 'not_found' })
  if (entry.version !== input.version)
    throw new HTTPException(409, { message: 'version_conflict' })
  if (
    command.action !== 'assign_next' &&
    !allowedEntryActions(
      state.config?.type ?? 'reception',
      entry.status,
    ).includes(input.action) &&
    !(input.action === 'no_show' && entry.status === 'called') &&
    !(input.action === 'restore' && entry.status === 'expired')
  )
    throw new HTTPException(409, { message: 'unsupported_action' })
  const transitions: Record<string, readonly string[]> = {
    call: ['waiting'],
    complete: ['called'],
    release: ['completed'],
    cancel: ['waiting', 'called'],
    no_show: ['called'],
    skip: ['waiting'],
    restore: ['expired'],
  }
  if (!transitions[input.action]!.includes(entry.status))
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (input.action === 'restore' && (
    (entry.service_ends_at !== null && now >= entry.service_ends_at) ||
    (entry.service_window_id === null && !state.config?.twentyFourHours)
  )) throw new HTTPException(409, { message: 'invalid_transition' })
  if (input.action === 'restore' && !input.overrideReason)
    throw new HTTPException(400, { message: 'restore_reason_required' })
  if (input.action === 'no_show') {
    let deadline = entry.arrival_deadline_at
    if (deadline === null && entry.called_at !== null) {
      const q = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
        .bind(queueId)
        .first<{ config: string }>()
      const grace = (JSON.parse(q!.config) as { graceMinutes: number })
        .graceMinutes
      deadline = entry.called_at + grace * 60000
    }
    if (deadline === null || now < deadline)
      throw new HTTPException(409, { message: 'arrival_grace_active' })
  }
  const status = {
    call: input.arrivalMode === 'present' ? 'completed' : 'called',
    complete: 'completed',
    release: 'served',
    cancel: 'cancelled',
    no_show: 'no_show',
    skip: 'waiting',
    restore: 'waiting',
  }[input.action]
  const extra: D1PreparedStatement[] = []
  const allocation = state.allocations.find(
    (a) => a.entry_id === input.entryId && a.released_at === null,
  )
  let assignedResourceName: string | null = null
  if (input.action === 'call' && !quick) {
    if (state.inventorySafety.requiresSurvey)
      throw new HTTPException(409, { message: 'inventory_refresh_required' })
    const context = await assignmentContext(state, input.entryId, now)
    if (input.assignmentToken && input.assignmentToken !== context.token)
      throw new HTTPException(409, { message: 'assignment_context_changed' })
    const resource = context.resource
    if (!resource)
      throw new HTTPException(409, { message: 'no_free_compatible_resource' })
    if (context.priorityRequired && !input.overrideReason)
      throw new HTTPException(409, { message: 'oldest_compatible_required' })
    if (input.overrideReason)
      extra.push(
        env.DB.prepare(
          'INSERT INTO queue_override_audit VALUES (?,?,?,?,?,?)',
        ).bind(
          crypto.randomUUID(),
          queueId,
          input.entryId,
          actor,
          input.overrideReason,
          now,
        ),
      )
    if (resource)
      assignedResourceName =
        state.config?.spaces.find((space) => space.id === resource.spaceId)
          ?.name ?? null
    if (resource)
      extra.push(
        env.DB.prepare(
          'INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET resource_id=excluded.resource_id,space_id=excluded.space_id,seats=excluded.seats,reserved_at=excluded.reserved_at,arrived_at=excluded.arrived_at,released_at=NULL,outcome=NULL WHERE queue_allocation.released_at IS NOT NULL',
        ).bind(
          input.entryId,
          queueId,
          resource.id,
          resource.spaceId,
          resource.seats,
          now,
          input.arrivalMode === 'present' ? now : null,
        ),
      )
  }
  if (input.action === 'call' && quick)
    assignedResourceName =
      state.config?.type === 'pool' ? 'Piscina / bar' : 'Recepción'
  if (input.action === 'restore')
    extra.push(
      env.DB.prepare(
        'INSERT INTO queue_override_audit VALUES (?,?,?,?,?,?)',
      ).bind(
        crypto.randomUUID(),
        queueId,
        input.entryId,
        actor,
        input.overrideReason!,
        now,
      ),
    )
  if (input.action === 'complete' && allocation && !quick)
    extra.push(
      env.DB.prepare(
        'UPDATE queue_allocation SET arrived_at=? WHERE entry_id=? AND released_at IS NULL',
      ).bind(now, input.entryId),
    )
  if (
    allocation &&
    (['release', 'cancel', 'no_show'].includes(input.action) ||
      (quick && input.action === 'complete'))
  )
    extra.push(
      env.DB.prepare(
        'UPDATE queue_allocation SET released_at=?,outcome=? WHERE entry_id=? AND released_at IS NULL',
      ).bind(now, status, input.entryId),
    )
  if (input.action === 'call') {
    const predicted = await env.DB.prepare(
      'SELECT predicted_at,created_at,legacy_eta_minutes FROM queue_forecast_anchor WHERE entry_id=?',
    )
      .bind(input.entryId)
      .first<{
        predicted_at: number
        created_at: number
        legacy_eta_minutes: number
      }>()
    const position = state.parties.findIndex((p) => p.id === input.entryId)
    extra.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO queue_wait_evidence(entry_id,predicted_at,actual_at,error_minutes,legacy_eta_minutes,forecast_created_at,mode) VALUES (?,?,?,?,?,?,?)',
      ).bind(
        input.entryId,
        predicted?.predicted_at ?? null,
        now,
        predicted?.predicted_at == null
          ? null
          : (now - predicted.predicted_at) / 60000,
        predicted?.legacy_eta_minutes ?? Math.max(0, position) * state.baseline,
        predicted?.created_at ?? null,
        state.config?.estimationMode ?? 'shadow',
      ),
    )
  }
  let notifyCancellation = false
  if (input.action === 'cancel') {
    const consent = await env.DB.prepare(
      "SELECT 1 FROM consent WHERE entry_id=? AND purpose='queue_updates' AND revoked_at IS NULL LIMIT 1",
    )
      .bind(input.entryId)
      .first()
    if (consent) {
      extra.push(
        noticeStatement(
          env,
          input.entryId,
          'cancelled',
          now,
          {
            schemaVersion: 2,
            serviceName: state.config?.name ?? 'Service',
            ahead: null,
            etaMinutes: null,
            predictedAt: null,
            estimateQuality: 'unknown',
            resourceName: null,
            arrivalDeadlineAt: null,
            reason: 'staff_cancel',
          },
          0,
          0,
          !!state.config,
        ),
      )
      notifyCancellation = true
    }
  }
  if (input.action === 'call' && input.arrivalMode !== 'present') {
    const serviceName = state.config?.name ?? 'Servicio'
    const snapshot = {
      schemaVersion: 2 as const,
      serviceName,
      ahead: null,
      etaMinutes: null,
      predictedAt: null,
      estimateQuality: 'unknown' as const,
      resourceName: assignedResourceName,
      arrivalDeadlineAt:
        now + (state.config?.graceMinutes ?? (quick ? 2 : 5)) * 60000,
    }
    extra.push(
      noticeStatement(
        env,
        input.entryId,
        'ready',
        now,
        snapshot,
        0,
        entry.call_cycle + 1,
        !!state.config,
      ),
    )
  }
  if (status !== 'waiting') {
    extra.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO notification_trace(id,notification_id,event,recorded_at) SELECT id||':obsolete',id,'obsolete',? FROM notification_outbox WHERE entry_id=? AND kind IN ('queue_joined','approaching','delayed','improved') AND status='pending'",
      ).bind(now, input.entryId),
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE entry_id=? AND kind IN ('queue_joined','approaching','delayed','improved') AND status='pending'",
      ).bind(now, input.entryId),
    )
  }
  await env.DB.batch([
    ...extra,
    env.DB.prepare(
      `UPDATE queue_entry SET status=?,version=version+1,call_cycle=CASE WHEN ?='call' THEN call_cycle+1 ELSE call_cycle END,called_at=?,arrival_deadline_at=CASE WHEN ?='call' THEN ? WHEN ?='restore' THEN NULL ELSE arrival_deadline_at END,sequence=CASE WHEN ?='skip' THEN (SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?) ELSE sequence END WHERE id=? AND queue_id=? AND version=?`,
    ).bind(
      status,
      input.action,
      input.action === 'call'
        ? now
        : input.action === 'restore'
        ? null
        : entry.called_at,
      input.action,
      input.arrivalMode === 'present'
        ? null
        : now + (state.config?.graceMinutes ?? (quick ? 2 : 5)) * 60000,
      input.action,
      input.action,
      queueId,
      input.entryId,
      queueId,
      input.version,
    ),
    env.DB.prepare(
      'INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      input.entryId,
      input.action === 'restore'
        ? 'restored'
        : status === 'waiting'
        ? 'skipped'
        : status,
      now,
    ),
    audit(
      env,
      actor,
      access.organizationId,
      access.venueId,
      `queue.${command.action}`,
      input.entryId,
    ),
    env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)').bind(
      actor,
      key,
      fingerprint,
      JSON.stringify({ ok: true }),
    ),
  ])
  if (input.action === 'call' && input.arrivalMode !== 'present')
    await publishNotice(env, input.entryId, 'ready')
  if (notifyCancellation)
    await publishNotice(env, input.entryId, 'cancelled')
  await recalculateQueue(env, queueId, now)
  return { ok: true }
}
export async function configureQueue(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  body: unknown,
) {
  const access = await queueAccess(env, actor, queueId, 'queue.configure')
  await maintainServiceEntries(env, queueId)
  const parsed = queueSettingsSchema.safeParse(body)
  if (!parsed.success)
    throw new HTTPException(400, { message: 'invalid_settings' })
  const { version, open, applyApproachToActive, ...rawConfig } = parsed.data
  const current = await env.DB.prepare(
    'SELECT version,open FROM queue WHERE id=?',
  )
    .bind(queueId)
    .first<{ version: number; open: number }>()
  if (!current || current.version !== version)
    throw new HTTPException(409, { message: 'version_conflict' })
  const old = await loadQueueState(env, queueId)
  const config = normalizeConfig(rawConfig, old.config)
  if (
    config.graceMinutes !== old.config?.graceMinutes &&
    (await env.DB.prepare(
      "SELECT 1 FROM queue_entry WHERE queue_id=? AND status='called' AND arrival_deadline_at IS NULL LIMIT 1",
    )
      .bind(queueId)
      .first())
  )
    throw new HTTPException(409, { message: 'legacy_arrival_deadline' })
  const approachChanged =
    (config.approachTurns ?? 2) !== (old.config?.approachTurns ?? 2) ||
    (config.approachMinutes ?? 10) !== (old.config?.approachMinutes ?? 10) ||
    (config.etaChangeThresholdMinutes ?? 5) !==
      (old.config?.etaChangeThresholdMinutes ?? 5) ||
    (config.notificationCooldownMinutes ?? 10) !==
      (old.config?.notificationCooldownMinutes ?? 10)
  if (approachChanged && old.parties.length && !applyApproachToActive)
    throw new HTTPException(409, {
      message: 'active_approach_confirmation_required',
    })
  if (
    rawConfig.intelligencePolicy !== undefined &&
    rawConfig.intelligencePolicy !==
      (old.config?.intelligencePolicy ?? 'automatic')
  )
    throw new HTTPException(409, { message: 'lifecycle_command_required' })
  config.intelligencePolicy = old.config?.intelligencePolicy ?? 'automatic'
  if (
    open !== !!current.open ||
    (config.estimationMode ?? 'shadow') !==
      (old.config?.estimationMode ?? 'shadow') ||
    !!config.resourceStateKnown !== !!old.config?.resourceStateKnown
  )
    throw new HTTPException(409, { message: 'lifecycle_command_required' })
  const admission = await admissionState(env, queueId)
  const topologyChanged =
    !!old.config && topology(config) !== topology(old.config)
  if (
    topologyChanged &&
    admission?.queueState === 'active' &&
    old.config?.estimationMode === 'active'
  )
    throw new HTTPException(409, { message: 'close_before_topology_change' })
  if (
    JSON.stringify(config.adjustments) !==
    JSON.stringify(old.config?.adjustments)
  )
    await queueAccess(env, actor, queueId, 'queue.operate')
  const adjustmentsChanged =
    JSON.stringify(config.adjustments) !==
    JSON.stringify(old.config?.adjustments)
  if (
    adjustmentsChanged &&
    config.adjustments?.some(
      (a) =>
        a.expiresAt <= Date.now() ||
        a.expiresAt > Date.now() + 24 * 60 * 60000 ||
        (!(
          config.type !== 'restaurant' &&
          a.spaceId === 'reception' &&
          a.seats === 100
        ) &&
          !config.spaces.some(
            (s) =>
              s.id === a.spaceId &&
              s.tableTypes?.some((t) => t.seats === a.seats),
          )),
    )
  )
    throw new HTTPException(400, { message: 'invalid_adjustment' })
  for (const a of [
    ...(config.type === 'restaurant'
      ? old.allocations.filter((a) => a.released_at === null)
      : []),
    ...(config.type === 'restaurant' ? old.holds : []),
  ]) {
    const space = config.spaces.find((s) => s.id === a.space_id)
    const type = space?.tableTypes?.find((t) => t.seats === a.seats)
    const index = Number(a.resource_id.split(':').at(-1))
    if (
      config.type !== old.config?.type ||
      (config.type === 'reception'
        ? index >= (config.stations ?? 1)
        : !type || index >= type.count)
    )
      throw new HTTPException(409, {
        message: 'occupied_resource_configuration',
      })
  }
  const preferences = await env.DB.prepare(
    "SELECT preferred_space_id,party_size FROM queue_entry WHERE queue_id=? AND status IN ('waiting','called','completed') AND preferred_space_id IS NOT NULL AND preferred_space_id!='fastest'",
  )
    .bind(queueId)
    .all<{ preferred_space_id: string; party_size: number }>()
  if (
    preferences.results.some(
      (entry) =>
        config.type !== 'restaurant' ||
        !config.spaces.some(
          (space) =>
            space.id === entry.preferred_space_id &&
            (!space.tableTypes?.length ||
              space.tableTypes.some((type) => type.seats >= entry.party_size)),
        ),
    )
  )
    throw new HTTPException(409, { message: 'preferred_space_in_use' })
  if (topologyChanged) {
    config.resourceStateKnown = false
    config.estimationMode = 'shadow'
  }
  await env.DB.batch([
    ...(topologyChanged
      ? [
          env.DB.prepare(
            'UPDATE queue_opening SET complete=0 WHERE queue_id=?',
          ).bind(queueId),
        ]
      : []),
    ...(topologyChanged && old.inventorySafety.managed
      ? [
          env.DB.prepare(
            'INSERT INTO queue_inventory_audit VALUES (?,?,?,?,?,?)',
          ).bind(
            crypto.randomUUID(),
            queueId,
            actor,
            'inventory_invalidated',
            JSON.stringify({ topology: topology(config) }),
            Date.now(),
          ),
        ]
      : []),
    ...(adjustmentsChanged
      ? [
          env.DB.prepare(
            'INSERT INTO queue_adjustment_audit VALUES (?,?,?,?,?)',
          ).bind(
            crypto.randomUUID(),
            queueId,
            actor,
            JSON.stringify(config.adjustments ?? []),
            Date.now(),
          ),
        ]
      : []),
    env.DB.prepare(
      'UPDATE queue SET capacity=?,average_minutes=?,open=?,name=?,config=?,version=version+1 WHERE id=? AND version=?',
    ).bind(
      config.capacity,
      config.averageMinutes,
      Number(open),
      config.name,
      JSON.stringify(config),
      queueId,
      version,
    ),
    directoryConfigStatement(env, queueId, JSON.stringify(config)),
    audit(
      env,
      actor,
      access.organizationId,
      access.venueId,
      'queue.configured',
      queueId,
    ),
  ])
  await recalculateQueue(env, queueId)
  return { ok: true }
}
