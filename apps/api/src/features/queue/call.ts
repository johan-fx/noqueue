import { serviceDeadline } from '../staff/availability'
import { defaultGraceMinutes } from '@noqueue/contracts/staff'
import type { AssignmentObservation } from './adaptive-state'
import { resolveEstimateContext, type EstimateContext } from './adaptive-model'
import type { Party } from './engine'
import type { QueueState } from './projection'
import { lifecycleNoticeStatements } from './notices'
import { copyVersion } from '../../integrations/whatsapp-copy-v3'
import { actualCallCopyVariant } from '../../integrations/whatsapp-copy-v4'
import type { CallReplacementResult } from '@noqueue/contracts/staff'

export type CallReplacement = {
  automation_cycle_id?: string | null
  eligible: number
  service_type: string
  service_ends_at: number | null
  result: CallReplacementResult
}
export function replacementEnabled(env: CloudflareBindings) {
  return env.QUEUE_AUTO_REPLACEMENT_ENABLED === 'true'
}
export function readCallReplacement(
  env: CloudflareBindings,
  entryId: string,
  cycle: number,
) {
  return env.DB.prepare(
    'SELECT automation_cycle_id,eligible,service_type,service_ends_at,result FROM queue_call_replacement WHERE entry_id=? AND call_cycle=?',
  )
    .bind(entryId, cycle)
    .first<CallReplacement>()
}
export function finishCallReplacement(
  env: CloudflareBindings,
  entryId: string,
  cycle: number,
  result: CallReplacementResult,
  now: number,
  successor?: { id: string; cycle: number },
) {
  return env.DB.prepare(
    `UPDATE queue_call_replacement SET result=?,successor_entry_id=?,successor_call_cycle=?,updated_at=?
    WHERE entry_id=? AND call_cycle=? AND result='pending'`,
  ).bind(
    result,
    successor?.id ?? null,
    successor?.cycle ?? null,
    now,
    entryId,
    cycle,
  )
}

/** Side effects of a real call, shared by staff and both kinds of handoff.
 * No writes here: the caller commits entry changes, these statements and projections together.
 */
export async function prepareCall(
  env: CloudflareBindings,
  queueId: string,
  state: QueueState,
  party: Party,
  options: {
    now: number
    callCycle: number
    origin: 'staff' | 'yield' | 'arrival_expiry' | 'customer_cancel' | 'staff_pass'
    source?: 'handoff'
    context?: EstimateContext | undefined
    present?: boolean
    inherited?: CallReplacement | null
  },
) {
  const { now, callCycle, origin } = options
  const config = state.config
  const graceMinutes =
    config?.graceMinutes ?? defaultGraceMinutes(config?.type ?? 'reception')
  const deadline = options.present ? null : now + graceMinutes * 60_000
  const context =
    options.context ?? resolveEstimateContext(party, config, state.baseline)
  const assignment: AssignmentObservation = {
    entryId: party.id,
    callCycle,
    source: options.source ?? (origin === 'staff' ? 'staff' : 'handoff'),
    context,
    partySize: party.partySize,
    preferredSpaceId: party.preferredSpaceId,
  }
  const original = await env.DB.prepare(
    'SELECT service_ends_at,service_window_id,manual_only,reception_service FROM queue_entry WHERE id=?',
  )
    .bind(party.id)
    .first<{ service_ends_at: number | null; service_window_id: string | null; manual_only: number; reception_service: string | null }>()
  const venue = origin === 'staff' ? await env.DB.prepare('SELECT v.timezone FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=?').bind(queueId).first<{timezone:string}>() : null
  // Physical opening, not admissions/cutoff, authorizes a manual reference.
  let window: ReturnType<typeof serviceDeadline> = null
  if (config && venue) {
    try { window = serviceDeadline(config, venue.timezone, new Date(now)) } catch { /* fail closed */ }
  }
  const eligible = !options.present && replacementEnabled(env) && !!config?.automaticAssignmentEnabled &&
    (origin === 'staff' ? !!window : !!options.inherited?.automation_cycle_id && options.inherited.eligible === 1)
  const endsAt = options.inherited ? options.inherited.service_ends_at
    : original?.manual_only && window ? window.endsAt
    : original?.service_ends_at ?? window?.endsAt ?? null
  const automationId = eligible ? (options.inherited?.automation_cycle_id ?? crypto.randomUUID()) : null
  // A manual reference with unusable context is terminal immediately, not an
  // apparently active promise that we already know cannot replace anybody.
  const contextReason = eligible && origin === 'staff'
    ? config?.type === 'restaurant' && (context.provenance !== 'confirmed' || !context.spaceId || !context.seats)
      ? 'missing_context'
      : config?.type === 'reception' && !original?.reception_service
        ? 'missing_context'
        : config?.type === 'reception' && !config.receptionServices.some(type => type === original?.reception_service)
          ? 'context_changed'
          : null
    : null

  const predicted = await env.DB.prepare(
    'SELECT predicted_at,created_at,legacy_eta_minutes FROM queue_forecast_anchor WHERE entry_id=?',
  )
    .bind(party.id)
    .first<{
      predicted_at: number | null
      created_at: number | null
      legacy_eta_minutes: number
    }>()
  const statements = [
    env.DB.prepare(
      `INSERT INTO queue_call_replacement(entry_id,call_cycle,queue_id,eligible,origin,service_type,service_ends_at,result,created_at,updated_at,automation_cycle_id,cause)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      party.id,
      callCycle,
      queueId,
      Number(eligible && !contextReason),
      origin === 'customer_cancel' || origin === 'staff_pass' ? 'yield' : origin,
      options.inherited?.service_type ?? config?.type ?? 'unknown',
      endsAt,
      options.present ? 'arrived' : 'pending',
      now,
      now,
      automationId,
      origin,
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO queue_wait_evidence(entry_id,predicted_at,actual_at,error_minutes,legacy_eta_minutes,forecast_created_at,mode) VALUES (?,?,?,?,?,?,?)',
    ).bind(
      party.id,
      predicted?.predicted_at ?? null,
      now,
      predicted?.predicted_at == null
        ? null
        : (now - predicted.predicted_at) / 60000,
      predicted?.legacy_eta_minutes ??
        Math.max(
          0,
          state.parties.findIndex((p) => p.id === party.id),
        ) * state.baseline,
      predicted?.created_at ?? null,
      config?.estimationMode ?? 'shadow',
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO notification_trace(id,notification_id,event,recorded_at) SELECT id||':obsolete',id,'obsolete',? FROM notification_outbox WHERE entry_id=? AND kind IN ('queue_joined','approaching','delayed','improved','ready') AND status='pending'",
    ).bind(now, party.id),
    env.DB.prepare(
      "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE entry_id=? AND kind IN ('queue_joined','approaching','delayed','improved','ready') AND status='pending'",
    ).bind(now, party.id),
  ]
  statements.push(env.DB.prepare('UPDATE queue_entry SET priority_rank=NULL WHERE id=?').bind(party.id))
  if (automationId && origin !== 'staff') {
    const predecessor = await env.DB.prepare('SELECT current_entry_id,current_call_cycle FROM queue_automation_cycle WHERE id=? AND queue_id=? AND state=\'active\'')
      .bind(automationId, queueId).first<{ current_entry_id: string; current_call_cycle: number }>()
    if (!predecessor) throw new Error('automation_predecessor_missing')
    statements.push(env.DB.prepare(`INSERT INTO queue_staff_event
      (queue_id,entry_id,call_cycle,cycle_id,successor_entry_id,successor_call_cycle,cause,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(queueId,predecessor.current_entry_id,predecessor.current_call_cycle,
        automationId,party.id,callCycle,origin === 'yield' ? 'customer_yield' : origin,now))
  }
  if (origin === 'staff' && original?.manual_only && window) {
    statements.unshift(env.DB.prepare('UPDATE queue_entry SET manual_only=0,service_window_id=?,service_ends_at=? WHERE id=?').bind(window.windowId, window.endsAt, party.id))
  }
  if (automationId) {
    if (origin === 'staff') statements.unshift(env.DB.prepare(`INSERT INTO queue_automation_cycle
      (id,queue_id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,service_type,capacity,reception_service,space_id,seats,service_window_id,service_ends_at,state,reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(automationId,queueId,party.id,callCycle,party.id,callCycle,config!.type,
        config!.type === 'restaurant' ? party.partySize : null, original?.reception_service ?? null,
        context.provenance === 'confirmed' ? context.spaceId : null,context.provenance === 'confirmed' ? context.seats : null,
        window?.windowId ?? original?.service_window_id ?? null,endsAt,contextReason ? 'stopped' : 'active',contextReason,now,now))
    else statements.unshift(env.DB.prepare(`UPDATE queue_automation_cycle SET current_entry_id=?,current_call_cycle=?,version=version+1,updated_at=? WHERE id=? AND state='active'`).bind(party.id,callCycle,now,automationId))
  }
  if (deadline !== null) {
    const accepted =
      copyVersion(env) === 4
        ? await env.DB.prepare(
            'SELECT last_accepted_predicted_at FROM queue_notification_state WHERE entry_id=?',
          )
            .bind(party.id)
            .first<{ last_accepted_predicted_at: number | null }>()
        : null
    statements.push(
      ...lifecycleNoticeStatements(
        env,
        party.id,
        'ready',
        now,
        {
          schemaVersion: 2,
          ...(copyVersion(env) === 4
            ? {
                copyVariant: actualCallCopyVariant(
                  accepted?.last_accepted_predicted_at ?? null,
                  now,
                  config?.etaChangeThresholdMinutes ?? 5,
                ),
              }
            : {}),
          serviceName: config?.name ?? 'Servicio',
          ahead: null,
          etaMinutes: null,
          predictedAt: null,
          estimateQuality: 'unknown',
          resourceName: null,
          arrivalDeadlineAt: deadline,
        },
        0,
        callCycle,
        !!config,
      ),
    )
  }
  return { assignment, statements, deadline, graceMinutes, automationId, automatic: eligible && !contextReason }
}
