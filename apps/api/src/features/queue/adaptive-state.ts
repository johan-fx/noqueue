import type { ServiceInput } from '@noqueue/contracts/staff'
import { resolveAdmission, type AdmissionRecord } from '../staff/availability'
import { cadenceFactor, configuredIntervalMinutes } from './adaptive-model'

export type AssignmentObservation = {
  entryId: string
  callCycle: number
  resourceId?: string | undefined
  spaceId?: string
  seats?: number
}
export type CadenceState = {
  estimator_version: number
  episode_id: string | null
  episode_started_at: number | null
  last_assignment_at: number | null
  service_window_id: string | null
}

/** Build prospective learning state; statements commit with the assignment, never before it. */
export async function loadAdaptiveState(
  env: CloudflareBindings,
  queueId: string,
  now: number,
  config: ServiceInput,
  waiting: number,
  baseline: number,
  assignment?: AssignmentObservation,
  demandActive?: boolean,
) {
  const stored = await env.DB.prepare(
    'SELECT * FROM queue_cadence_state WHERE queue_id=?',
  )
    .bind(queueId)
    .first<CadenceState>()
  const context = await env.DB.prepare(
    `SELECT a.*,v.timezone FROM queue q JOIN venue v ON v.id=q.venue_id
    LEFT JOIN queue_admission a ON a.queue_id=q.id WHERE q.id=?`,
  )
    .bind(queueId)
    .first<AdmissionRecord & { timezone: string }>()
  const admission = resolveAdmission(
    config,
    context?.timezone ?? 'UTC',
    context,
    waiting,
    new Date(now),
  )
  const active =
    demandActive ?? (admission.serviceOpen && admission.queueState === 'active')
  const state: CadenceState =
    stored?.estimator_version === 2
      ? { ...stored }
      : {
          estimator_version: 2,
          episode_id: null,
          episode_started_at: null,
          last_assignment_at: null,
          service_window_id: null,
        }
  const rows = (
    await env.DB.prepare(
      'SELECT ratio FROM queue_assignment_observation WHERE queue_id=? AND ratio IS NOT NULL ORDER BY assigned_at DESC,rowid DESC LIMIT 30',
    )
      .bind(queueId)
      .all<{ ratio: number }>()
  ).results.reverse()
  const statements: D1PreparedStatement[] = []
  let assignmentRecorded = false
  const windowChanged = state.service_window_id !== admission.windowId
  if ((!active || windowChanged) && state.episode_id) {
    statements.push(
      env.DB.prepare(
        'UPDATE queue_demand_episode SET ended_at=?,end_reason=? WHERE id=? AND ended_at IS NULL',
      ).bind(
        now,
        windowChanged ? 'window_changed' : 'inactive',
        state.episode_id,
      ),
    )
    state.episode_id = null
    state.episode_started_at = null
    state.last_assignment_at = null
  }
  state.service_window_id = admission.windowId ?? null
  if (!state.episode_id && ((active && waiting > 0) || assignment)) {
    state.episode_id = crypto.randomUUID()
    state.episode_started_at = now
    state.last_assignment_at = null
    statements.push(
      env.DB.prepare(
        'INSERT INTO queue_demand_episode(id,queue_id,started_at) VALUES (?,?,?)',
      ).bind(state.episode_id, queueId, now),
    )
  }
  if (assignment && state.episode_id) {
    const already = await env.DB.prepare(
      'SELECT 1 FROM queue_assignment_observation WHERE entry_id=? AND call_cycle=?',
    )
      .bind(assignment.entryId, assignment.callCycle)
      .first()
    if (!already) {
      assignmentRecorded = true
      const baselineMs =
        configuredIntervalMinutes(
          config,
          baseline,
          assignment.spaceId,
          assignment.seats,
        ) * 60000
      const interval =
        state.last_assignment_at === null
          ? null
          : Math.max(0, now - state.last_assignment_at)
      const ratio = interval === null ? null : interval / baselineMs
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO queue_assignment_observation(entry_id,call_cycle,queue_id,episode_id,assigned_at,resource_id,space_id,seats,baseline_ms,interval_ms,ratio) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          assignment.entryId,
          assignment.callCycle,
          queueId,
          state.episode_id,
          now,
          assignment.resourceId ?? null,
          assignment.spaceId ?? null,
          assignment.seats ?? null,
          baselineMs,
          interval,
          ratio,
        ),
      )
      if (ratio !== null) rows.push({ ratio })
      state.last_assignment_at = now
    }
  }
  const lastProgressAt =
    state.last_assignment_at ?? state.episode_started_at ?? now
  if (!active || !waiting) {
    if (state.episode_id)
      statements.push(
        env.DB.prepare(
          'UPDATE queue_demand_episode SET ended_at=?,end_reason=? WHERE id=? AND ended_at IS NULL',
        ).bind(now, active ? 'empty' : 'inactive', state.episode_id),
      )
    state.episode_id = null
    state.episode_started_at = null
    state.last_assignment_at = null
  }
  statements.push(
    env.DB.prepare(
      'INSERT INTO queue_cadence_state(queue_id,estimator_version,episode_id,episode_started_at,last_assignment_at,service_window_id,updated_at) VALUES (?,2,?,?,?,?,?) ON CONFLICT(queue_id) DO UPDATE SET estimator_version=2,episode_id=excluded.episode_id,episode_started_at=excluded.episode_started_at,last_assignment_at=excluded.last_assignment_at,service_window_id=excluded.service_window_id,updated_at=excluded.updated_at',
    ).bind(
      queueId,
      state.episode_id,
      state.episode_started_at,
      state.last_assignment_at,
      state.service_window_id,
      now,
    ),
  )
  return {
    active,
    assignmentRecorded,
    factor: cadenceFactor(rows.map((r) => r.ratio)),
    lastProgressAt,
    statements,
    state,
  }
}
