import type { ServiceInput } from '@noqueue/contracts/staff'
import { resolveAdmission, type AdmissionRecord } from '../staff/availability'
import {
  cadenceFactor,
  resolveEstimateContext,
  learnContextualFactors,
  type EstimateContext,
} from './adaptive-model'

export type AssignmentObservation = {
  source?: 'staff' | 'handoff'
  context?: EstimateContext
  partySize?: number
  preferredSpaceId?: string | null | undefined
  entryId: string
  callCycle: number
  resourceId?: string | undefined
  spaceId?: string
  seats?: number
}
export type CadenceState = {
  model_revision?: number
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
    stored !== null
      ? { ...stored, estimator_version: 2 }
      : {
          estimator_version: 2,
          episode_id: null,
          episode_started_at: null,
          last_assignment_at: null,
          service_window_id: null,
        }
  const rows = (
    await env.DB.prepare(
      `SELECT ratio FROM queue_assignment_observation WHERE queue_id=? AND source IN ('staff','legacy') AND ratio IS NOT NULL ORDER BY assigned_at DESC,rowid DESC LIMIT 30`,
    )
      .bind(queueId)
      .all<{ ratio: number }>()
  ).results.reverse()
  const statements: D1PreparedStatement[] = []
  const transitioning = stored?.model_revision !== 2
  // Old queues without v2 state still have an episode/progress anchor. Do not
  // restart their elapsed wait merely because the first post-migration read arrived.
  const legacyAnchor =
    transitioning && !state.episode_id && active && waiting > 0
      ? await env.DB.prepare(
          `SELECT MIN(created_at) AS started_at FROM queue_entry WHERE queue_id=? AND status='waiting' AND manual_only=0`,
        )
          .bind(queueId)
          .first<{ started_at: number | null }>()
      : null
  const groups = config.spaces.flatMap((space) =>
    (space.tableTypes ?? []).map((type) => ({
      spaceId: space.id,
      seats: type.seats,
    })),
  )
  // Separate indexed lookups keep sparse types bounded independently of zone traffic.
  const observations = (
    await env.DB.prepare(
      `
      SELECT o.space_id,o.seats,o.ratio,o.assigned_at,o.rowid AS observation_id FROM json_each(?) g
      JOIN queue_assignment_observation o ON o.rowid IN (
        SELECT rowid FROM queue_assignment_observation WHERE queue_id=? AND model_revision=2 AND source='staff' AND provenance='confirmed'
        AND space_id=json_extract(g.value,'$.spaceId') AND seats=json_extract(g.value,'$.seats')
        AND ratio IS NOT NULL ORDER BY assigned_at DESC,rowid DESC LIMIT 30)
      UNION
      SELECT o.space_id,o.seats,o.ratio,o.assigned_at,o.rowid AS observation_id FROM json_each(?) g
      JOIN queue_assignment_observation o ON o.rowid IN (
        SELECT rowid FROM queue_assignment_observation WHERE queue_id=? AND model_revision=2 AND source='staff' AND provenance='confirmed'
        AND space_id=json_extract(g.value,'$.spaceId')
        AND ratio IS NOT NULL ORDER BY assigned_at DESC,rowid DESC LIMIT 30)
      ORDER BY assigned_at,observation_id`,
    )
      .bind(
        JSON.stringify(groups),
        queueId,
        JSON.stringify(config.spaces.map((s) => ({ spaceId: s.id }))),
        queueId,
      )
      .all<{
        space_id: string
        seats: number | null
        ratio: number
        assigned_at: number
        observation_id: number
      }>()
  ).results
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
    state.episode_started_at = legacyAnchor?.started_at ?? now
    state.last_assignment_at = null
    statements.push(
      env.DB.prepare(
        'INSERT INTO queue_demand_episode(id,queue_id,started_at) VALUES (?,?,?)',
      ).bind(state.episode_id, queueId, state.episode_started_at),
    )
  }
  if (assignment && state.episode_id) {
    const already = await env.DB.prepare(
      'SELECT 1 FROM queue_assignment_observation WHERE entry_id=? AND call_cycle=?',
    )
      .bind(assignment.entryId, assignment.callCycle)
      .first()
    if (!already) {
      assignmentRecorded = assignment.source !== 'handoff'
      const resolvedContext = assignment.context
        ? assignment.context
        : resolveEstimateContext(
            {
              partySize: assignment.partySize ?? assignment.seats ?? 1,
              preferredSpaceId:
                assignment.preferredSpaceId ?? assignment.spaceId ?? null,
            },
            config,
            baseline,
          )
      const baselineMs = resolvedContext.baselineMinutes * 60000
      const interval =
        !assignmentRecorded || !active || state.last_assignment_at === null
          ? null
          : Math.max(0, now - state.last_assignment_at)
      const ratio = interval === null ? null : interval / baselineMs
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO queue_assignment_observation(entry_id,call_cycle,queue_id,episode_id,assigned_at,resource_id,space_id,seats,baseline_ms,interval_ms,ratio,source,provenance,model_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,2)',
        ).bind(
          assignment.entryId,
          assignment.callCycle,
          queueId,
          state.episode_id,
          now,
          null,
          resolvedContext.spaceId,
          resolvedContext.seats,
          baselineMs,
          interval,
          ratio,
          assignment.source ?? 'staff',
          resolvedContext.provenance,
        ),
      )
      if (ratio !== null) {
        rows.push({ ratio })
        if (
          resolvedContext.spaceId &&
          resolvedContext.provenance === 'confirmed'
        )
          observations.push({
            space_id: resolvedContext.spaceId,
            seats: resolvedContext.seats,
            ratio,
            observation_id: -1,
            assigned_at: now,
          })
      }
      if (assignmentRecorded) state.last_assignment_at = now
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
      'INSERT INTO queue_cadence_state(queue_id,estimator_version,episode_id,episode_started_at,last_assignment_at,service_window_id,updated_at,model_revision) VALUES (?,2,?,?,?,?,?,2) ON CONFLICT(queue_id) DO UPDATE SET model_revision=2,estimator_version=2,episode_id=excluded.episode_id,episode_started_at=excluded.episode_started_at,last_assignment_at=excluded.last_assignment_at,service_window_id=excluded.service_window_id,updated_at=excluded.updated_at',
    ).bind(
      queueId,
      state.episode_id,
      state.episode_started_at,
      state.last_assignment_at,
      state.service_window_id,
      now,
    ),
  )
  const factors = learnContextualFactors(
    config,
    rows.map((r) => r.ratio),
    observations,
  )
  return {
    transitioning,
    factors,
    active,
    assignmentRecorded,
    factor: cadenceFactor(rows.map((r) => r.ratio)),
    lastProgressAt,
    statements,
    state,
  }
}
