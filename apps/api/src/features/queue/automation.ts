import type { CallReplacementResult, QueueAutomation } from '@noqueue/contracts/staff'
import type { QueueState } from './projection'
import type { EstimateContext } from './adaptive-model'
import { compareEffectiveQueueOrder } from './engine'
import { readQueueFeedback } from './feedback'

export type AutomationCycle = {
  id: string
  service_type: string
  capacity: number | null
  reception_service: string | null
  space_id: string | null
  seats: number | null
  service_window_id: string | null
  service_ends_at: number | null
  state: 'active' | 'stopped'
  reason: string | null
}
export function stopAutomation(env: CloudflareBindings, entryId: string, callCycle: number, reason: string, now: number) {
  return env.DB.prepare(`UPDATE queue_automation_cycle SET state='stopped',reason=?,version=version+1,updated_at=?
    WHERE current_entry_id=? AND current_call_cycle=? AND state='active'`).bind(reason, now, entryId, callCycle)
}
export function stopQueueAutomation(env: CloudflareBindings, queueId: string, reason: string, now: number) {
  return env.DB.prepare(`UPDATE queue_automation_cycle SET state='stopped',reason=?,version=version+1,updated_at=?
    WHERE queue_id=? AND state='active'`).bind(reason, now, queueId)
}
export async function readAutomation(env: CloudflareBindings, queueId: string, after?: number): Promise<QueueAutomation> {
  const row = await env.DB.prepare(`SELECT config FROM queue WHERE id=?`).bind(queueId).first<{config: string | null}>()
  let configured = false
  try { configured = JSON.parse(row?.config ?? '{}').automaticAssignmentEnabled === true } catch { /* fail closed */ }
  const effective = configured && env.QUEUE_AUTO_REPLACEMENT_ENABLED === 'true'
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM queue_automation_cycle WHERE queue_id=? AND state='active'`).bind(queueId).first<{total: number}>()
  const now = Date.now()
  const nextEntry = await env.DB.prepare(`SELECT id,version FROM queue_entry
    WHERE queue_id=? AND status='waiting' AND manual_only=0 AND (service_ends_at IS NULL OR service_ends_at>?)
    ORDER BY priority_rank IS NULL,priority_rank,sequence,id LIMIT 1`)
    .bind(queueId, now).first<{ id: string; version: number }>()
  return { configured, effective, activeCycles: count?.total ?? 0, serverNow: now, nextEntry,
    ...await readQueueFeedback(env, queueId, after) }
}

/** One selector for expiry, called-customer cancellation and yield. Never infers a free table from an ETA. */
export async function selectAutomationSuccessor(env: CloudflareBindings, queueId: string, state: QueueState, entryId: string, callCycle: number, now: number) {
  const cycle = await env.DB.prepare(`SELECT c.* FROM queue_automation_cycle c
    JOIN queue_call_replacement r ON r.automation_cycle_id=c.id
    WHERE r.entry_id=? AND r.call_cycle=? AND c.queue_id=? AND c.current_entry_id=? AND c.current_call_cycle=?`)
    .bind(entryId, callCycle, queueId, entryId, callCycle).first<AutomationCycle>()
  let result: CallReplacementResult = 'no_candidate'
  let context: EstimateContext | undefined
  if (!cycle) result = 'legacy'
  else if (cycle.state !== 'active') result = (cycle.reason ?? 'disabled') as CallReplacementResult
  else if (env.QUEUE_AUTO_REPLACEMENT_ENABLED !== 'true') result = 'disabled'
  else if (!state.config) result = 'context_changed'
  else if (!state.config.automaticAssignmentEnabled) result = 'disabled'
  else if (cycle.service_ends_at !== null && cycle.service_ends_at <= now) result = 'service_ended'
  else if (cycle.service_type !== state.config.type) result = 'context_changed'
  else if (cycle.service_type === 'restaurant') {
    if (!cycle.capacity || !cycle.space_id || !cycle.seats) result = 'missing_context'
    else if (!state.config.spaces.some(s => s.id === cycle.space_id && s.tableTypes?.some(t => t.seats === cycle.seats))) result = 'context_changed'
    else context = { spaceId: cycle.space_id, seats: cycle.seats, provenance: 'confirmed', baselineMinutes: state.baseline }
  } else if (cycle.service_type === 'reception') {
    if (!cycle.reception_service) result = 'missing_context'
    else if (!state.config.receptionServices.some(type => type === cycle.reception_service)) result = 'context_changed'
  }
  const rows = result === 'no_candidate' && cycle
    ? (await env.DB.prepare(`SELECT id,sequence,version,priority_rank AS priorityRank,party_size AS partySize,preferred_space_id AS preferredSpaceId,call_cycle,reception_service
      FROM queue_entry WHERE queue_id=? AND status='waiting' AND manual_only=0 AND id!=?
        AND (service_ends_at IS NULL OR service_ends_at>?) ORDER BY sequence,id`)
      .bind(queueId, entryId, now).all<{id:string; sequence:number; priorityRank:number|null; version:number; partySize:number; preferredSpaceId:string|null; call_cycle:number; reception_service:string|null}>()).results
    : []
  const compatible = rows.filter(p => cycle?.service_type === 'restaurant'
    ? p.partySize <= cycle.capacity! && (!p.preferredSpaceId || p.preferredSpaceId === 'fastest' || p.preferredSpaceId === cycle.space_id)
    : cycle?.service_type !== 'reception' || p.reception_service === cycle.reception_service)
  compatible.sort((a,b) => {
    if (a.priorityRank != null || b.priorityRank != null) return compareEffectiveQueueOrder(a,b)
    return (cycle?.service_type === 'restaurant' ? b.partySize-a.partySize : 0) || compareEffectiveQueueOrder(a,b)
  })
  return { cycle, result, context, successor: compatible[0] }
}
