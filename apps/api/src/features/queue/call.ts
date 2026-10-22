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
    'SELECT eligible,service_type,service_ends_at,result FROM queue_call_replacement WHERE entry_id=? AND call_cycle=?',
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
    origin: 'staff' | 'yield' | 'arrival_expiry'
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
    'SELECT service_ends_at FROM queue_entry WHERE id=?',
  )
    .bind(party.id)
    .first<{ service_ends_at: number | null }>()
  const eligible =
    !options.present &&
    replacementEnabled(env) &&
    (origin === 'staff' || options.inherited?.eligible === 1)
  const endsAt = options.inherited
    ? options.inherited.service_ends_at
    : original?.service_ends_at ?? null
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
      `INSERT INTO queue_call_replacement(entry_id,call_cycle,queue_id,eligible,origin,service_type,service_ends_at,result,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      party.id,
      callCycle,
      queueId,
      Number(eligible),
      origin,
      options.inherited?.service_type ?? config?.type ?? 'unknown',
      endsAt,
      options.present ? 'arrived' : 'pending',
      now,
      now,
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
  return { assignment, statements, deadline, graceMinutes }
}
