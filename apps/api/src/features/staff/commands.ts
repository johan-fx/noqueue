import {
  configuredIntervalMinutes,
  type EstimateContext,
} from '../queue/adaptive-model'
import { sameConfiguration, touchVenueConfiguration } from './configuration'
import { assignmentContext } from './assignment'
import { noticeStatement, publishNotice } from '../queue/notices'
import { directoryConfigStatement } from '../discovery/configuration'
import { activateIfReady } from '../queue/opening-state'
import {
  commitQueueTransition,
  maintainQueue,
  type QueueModelInput,
  loadQueueState,
  normalizeConfig,
  recalculateQueue,
} from '../queue/projection'
import {
  queueCommandSchema,
  queueSettingsSchema,
  weeklySchedule,
  type QueueCommand,
  type EntryCommand,
  type ServiceInput,
  allowedEntryActions,
  assignmentTableOptions,
} from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'
import { queueAccess, audit } from '../../auth/access'
import { hash } from '../queue/crypto'
import { copyVersion } from '../../integrations/whatsapp-copy-v3'
import { actualCallCopyVariant } from '../../integrations/whatsapp-copy-v4'
export async function runQueueCommand(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  key: string,
  command: QueueCommand,
  now = Date.now(),
) {
  const access = await queueAccess(env, actor, queueId, 'queue.operate')
  if ((command.action as string) === 'release')
    throw new HTTPException(410, { message: 'operation_retired' })
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
  await maintainQueue(env, queueId, now)
  const state = await loadQueueState(env, queueId, now)
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
  if (
    input.action === 'restore' &&
    ((entry.service_ends_at !== null && now >= entry.service_ends_at) ||
      (entry.service_window_id === null &&
        (!state.config ||
          weeklySchedule(state.config).allDayDays.length !== 7)))
  )
    throw new HTTPException(409, { message: 'invalid_transition' })
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
  const after: QueueModelInput = {
    config: state.config,
    allocations: state.allocations.map((a) => ({ ...a })),
    holds: state.holds,
    parties: state.parties.map((p) => ({ ...p })),
  }
  if (status !== 'waiting')
    after.parties = after.parties!.filter((p) => p.id !== input.entryId)
  if (input.action === 'skip') {
    const max = await env.DB.prepare(
      'SELECT MAX(sequence) AS sequence FROM queue_entry WHERE queue_id=?',
    )
      .bind(queueId)
      .first<{ sequence: number }>()
    after.parties = after.parties!.map((p) =>
      p.id === input.entryId ? { ...p, sequence: (max?.sequence ?? 0) + 1 } : p,
    )
  }
  if (input.action === 'restore') {
    const party = await env.DB.prepare(
      'SELECT id,sequence,party_size AS partySize,preferred_space_id AS preferredSpaceId FROM queue_entry WHERE id=?',
    )
      .bind(input.entryId)
      .first<{
        id: string
        sequence: number
        partySize: number
        preferredSpaceId: string | null
      }>()
    if (party) after.parties!.push(party)
  }
  if (input.action === 'call') after.appendedCallAt = now
  const extra: D1PreparedStatement[] = []
  const assignedResourceName: string | null = null
  let seatingContext: EstimateContext | undefined
  if (input.seating) {
    if (input.action !== 'call' || state.config?.type !== 'restaurant')
      throw new HTTPException(400, { message: 'invalid_assignment_seating' })
    const party = state.parties.find((p) => p.id === input.entryId)!
    const options = assignmentTableOptions(state.config, party.partySize)
    if (input.seating.mode === 'unspecified') {
      if (options.length)
        throw new HTTPException(409, { message: 'assignment_seating_changed' })
      seatingContext = {
        spaceId: null,
        seats: null,
        provenance: 'general',
        baselineMinutes: configuredIntervalMinutes(
          state.config,
          state.baseline,
        ),
      }
    } else {
      const { spaceId, seats } = input.seating
      if (
        !options.some(
          (space) => space.spaceId === spaceId && space.seats.includes(seats),
        )
      )
        throw new HTTPException(409, { message: 'assignment_seating_changed' })
      seatingContext = {
        spaceId,
        seats,
        provenance: 'confirmed',
        baselineMinutes: configuredIntervalMinutes(
          state.config,
          state.baseline,
          spaceId,
          seats,
        ),
      }
    }
  }
  if (input.action === 'call') {
    const context = await assignmentContext(state, input.entryId, now)
    if (input.assignmentToken && input.assignmentToken !== context.token)
      throw new HTTPException(409, { message: 'assignment_context_changed' })
  }
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
    let copyVariant: 'ready' | 'improved_ready' = 'ready'
    if (copyVersion(env) === 4) {
      const accepted = await env.DB.prepare(
        'SELECT last_accepted_predicted_at FROM queue_notification_state WHERE entry_id=?',
      )
        .bind(input.entryId)
        .first<{ last_accepted_predicted_at: number | null }>()
      copyVariant = actualCallCopyVariant(
        accepted?.last_accepted_predicted_at ?? null,
        now,
        state.config?.etaChangeThresholdMinutes ?? 5,
      )
    }
    const serviceName = state.config?.name ?? 'Servicio'
    const snapshot = {
      schemaVersion: 2 as const,
      ...(copyVersion(env) === 4 ? { copyVariant } : {}),
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
  if (input.action === 'call') {
    const party = state.parties.find((p) => p.id === input.entryId)!
    after.assignment = {
      entryId: input.entryId,
      callCycle: entry.call_cycle + 1,
      partySize: party.partySize,
      preferredSpaceId: party.preferredSpaceId,
      source: 'staff',
      ...(seatingContext ? { context: seatingContext } : {}),
    }
  }
  await commitQueueTransition(
    env,
    queueId,
    state,
    after,
    [
      ...extra,
      env.DB.prepare(
        `UPDATE queue_entry SET status=?,version=version+1,progress_initial_eta_minutes=COALESCE(progress_initial_eta_minutes,?),call_cycle=CASE WHEN ?='call' THEN call_cycle+1 ELSE call_cycle END,called_at=?,arrival_deadline_at=CASE WHEN ?='call' THEN ? WHEN ?='restore' THEN NULL ELSE arrival_deadline_at END,sequence=CASE WHEN ?='skip' THEN (SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?) ELSE sequence END WHERE id=? AND queue_id=? AND version=?`,
      ).bind(
        status,
        input.action === 'call' && input.arrivalMode !== 'present'
          ? state.config?.graceMinutes ?? (quick ? 2 : 5)
          : null,
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
    ],
    now,
    `staff.${input.action}`,
  )
  if (input.action === 'call' && input.arrivalMode !== 'present')
    await publishNotice(env, input.entryId, 'ready')
  if (notifyCancellation) await publishNotice(env, input.entryId, 'cancelled')
  await activateIfReady(env, queueId, now)
  return { ok: true }
}
export async function configureQueue(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  body: unknown,
) {
  const now = Date.now()
  const access = await queueAccess(env, actor, queueId, 'queue.configure')
  await maintainQueue(env, queueId, now)
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
  const old = await loadQueueState(env, queueId, now)
  if (old.config?.scheduleGroups && !rawConfig.scheduleGroups)
    throw new HTTPException(409, { message: 'schedule_format_conflict' })
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
      (old.config?.estimationMode ?? 'shadow')
  )
    throw new HTTPException(409, { message: 'lifecycle_command_required' })
  const adjustmentsChanged =
    rawConfig.adjustments !== undefined &&
    JSON.stringify(config.adjustments) !==
      JSON.stringify(old.config?.adjustments)
  if (adjustmentsChanged)
    throw new HTTPException(410, { message: 'operation_retired' })
  // New clients need not echo retired inventory fields. Preserve the historical
  // values without allowing them to gate or alter queue configuration.
  config.resourceStateKnown = old.config?.resourceStateKnown
  config.adjustments = old.config?.adjustments
  const preferences = await env.DB.prepare(
    "SELECT preferred_space_id,party_size FROM queue_entry WHERE queue_id=? AND status IN ('waiting','called') AND preferred_space_id IS NOT NULL AND preferred_space_id!='fastest'",
  )
    .bind(queueId)
    .all<{ preferred_space_id: string; party_size: number }>()
  if (
    preferences.results.some(
      (entry) =>
        config.type !== 'restaurant' ||
        !config.spaces.some((space) => space.id === entry.preferred_space_id),
    )
  )
    throw new HTTPException(409, { message: 'preferred_space_in_use' })
  // Operational adjustments do not redefine the establishment configuration.
  const configurationOnly = (value: ServiceInput) => {
    const {
      adjustments: _adjustments,
      resourceStateKnown: _known,
      estimationMode: _mode,
      ...configuration
    } = value
    return {
      ...configuration,
      approachTurns: value.approachTurns ?? 2,
      approachMinutes: value.approachMinutes ?? 10,
      etaChangeThresholdMinutes: value.etaChangeThresholdMinutes ?? 5,
      notificationCooldownMinutes: value.notificationCooldownMinutes ?? 10,
      intelligencePolicy: value.intelligencePolicy ?? 'automatic',
    }
  }
  const configurationChanged =
    !old.config ||
    !sameConfiguration(configurationOnly(config), configurationOnly(old.config))
  if (!configurationChanged && !adjustmentsChanged) return { ok: true }
  await commitQueueTransition(
    env,
    queueId,
    old,
    {
      config,
      allocations: old.allocations,
      parties: old.parties,
      holds: old.holds,
    },
    [
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
      ...(configurationChanged
        ? [touchVenueConfiguration(env, access.venueId, Date.now(), true)]
        : []),
      directoryConfigStatement(env, queueId, JSON.stringify(config)),
      audit(
        env,
        actor,
        access.organizationId,
        access.venueId,
        'queue.configured',
        queueId,
      ),
    ],
    now,
  )
  return { ok: true }
}
