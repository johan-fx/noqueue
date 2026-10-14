import { loadAdaptiveState, type AssignmentObservation } from './adaptive-state'
import { projectAdaptiveQueue, type AdaptiveResource } from './adaptive-model'
import { adaptiveProjectionStatements } from './adaptive-projection'
import {
  configuredCustomerWork,
  customerMinimum,
  customerEstimate,
  stableOperationalAt,
  type CustomerMinimum,
} from './customer-estimate'
import { maintainServiceEntries } from './service-expiry'
import { noticeStatement, type QueueNoticeSnapshot } from './notices'
import { evaluateEstimateNotice } from './estimate-notices'
import { expireArrivals } from './customer'
import { activateIfReady, inventorySafety } from './opening-state'
import {
  storedServiceSchema as serviceSchema,
  pruneScheduleReminders,
  type ServiceInput,
} from '@noqueue/contracts/staff'
import { type Party, type Projection } from './engine'

export function normalizeConfig(
  config: ServiceInput,
  previous?: ServiceInput | null,
): ServiceInput {
  const used = new Set(
    config.spaces.flatMap((space) => (space.id ? [space.id] : [])),
  )
  const spaces = config.spaces.map((space, index) => {
    const matches =
      previous?.spaces.filter(
        (old) => old.name === space.name && !used.has(old.id!),
      ) ?? []
    const id =
      space.id ??
      (matches.length === 1
        ? matches[0]!.id!
        : previous
        ? crypto.randomUUID()
        : `legacy-${index}`)
    used.add(id)
    const old = previous?.spaces.find((s) => s.id === id)
    return {
      ...space,
      id,
      tableTypes: space.tableTypes?.map((type) => ({
        ...type,
        averageMinutes:
          type.averageMinutes ??
          old?.tableTypes?.find((t) => t.seats === type.seats)
            ?.averageMinutes ??
          config.queueBySeat?.find((row) => row.seats === type.seats)
            ?.averageMinutes ??
          config.averageMinutes,
      })),
    }
  })
  return pruneScheduleReminders({
    ...config,
    estimatorVersion: 2, // old configurations cannot re-enable the inventory model
    spaces,
    assignmentPreference:
      spaces.find((s) => s.name === config.assignmentPreference)?.id ??
      config.assignmentPreference,
  })
}
export type Allocation = {
  history_order?: number
  entry_id: string
  resource_id: string
  space_id: string
  seats: number
  reserved_at: number
  arrived_at: number | null
  released_at: number | null
  outcome: string | null
}
export type QueueModelInput = {
  config?: ServiceInput | null
  allocations?: Allocation[]
  holds?: Array<{ resource_id: string; space_id: string; seats: number }>
  parties?: Party[]
  calls?: Array<{ created_at: number }>
  appendedCallAt?: number
  validityAt?: number
  assignment?: AssignmentObservation
  demandActive?: boolean
}
export async function loadQueueState(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
  model: QueueModelInput = {},
) {
  const queue = await env.DB.prepare(
    'SELECT config,average_minutes FROM queue WHERE id=?',
  )
    .bind(queueId)
    .first<{ config: string | null; average_minutes: number }>()
  if (!queue) throw new Error('Queue missing')
  const parsed = serviceSchema.safeParse(
    queue.config ? JSON.parse(queue.config) : null,
  )
  const config =
    model.config === undefined
      ? parsed.success
        ? normalizeConfig(parsed.data)
        : null
      : model.config
      ? normalizeConfig(model.config)
      : null
  // Historical inventory remains in storage, outside the operational model.
  const allocations: Allocation[] = []
  const holds: Array<{ resource_id: string; space_id: string; seats: number }> =
    []
  const parties =
    model.parties ??
    (
      await env.DB.prepare(
        "SELECT id,sequence,version,party_size AS partySize,preferred_space_id AS preferredSpaceId FROM queue_entry WHERE queue_id=? AND status='waiting' ORDER BY sequence",
      )
        .bind(queueId)
        .all<{
          id: string
          sequence: number
          partySize: number
          preferredSpaceId: string | null
        }>()
    ).results
  const resources: AdaptiveResource[] = []
  const calls = model.calls ?? []
  const adaptive = config
    ? await loadAdaptiveState(
        env,
        queueId,
        now,
        config,
        parties.length,
        queue.average_minutes,
        model.assignment,
        model.demandActive,
      )
    : null
  const adaptiveProjections = projectAdaptiveQueue(
    parties,
    resources,
    now,
    config,
    queue.average_minutes,
    adaptive?.factors ?? 1,
  )
  const projections: Projection[] = adaptiveProjections.map((p) => ({
    ...p,
    etaMinutes: Math.max(0, Math.ceil((p.predictedAt - now) / 60000)),
    callable: true,
  }))
  return {
    adaptive,
    adaptiveProjections,
    config,
    calls,
    inventorySafety: await inventorySafety(env, queueId, config),
    allocations,
    holds,
    parties,
    resources,
    projections,
    baseline: queue.average_minutes,
  }
}
/** Expiry changes the model even without an explicit command. Compare both models at the SAME now. */
export async function expireAdjustments(
  env: CloudflareBindings,
  queueId: string,
  now: number,
) {
  const checkpoint = await env.DB.prepare(
    `SELECT q.config,MIN(p.updated_at) AS updated_at FROM queue q
     JOIN queue_entry e ON e.queue_id=q.id AND e.status='waiting'
     JOIN queue_projection p ON p.entry_id=e.id WHERE q.id=?`,
  )
    .bind(queueId)
    .first<{ config: string | null; updated_at: number | null }>()
  if (checkpoint?.updated_at == null || !checkpoint.config) return
  const parsed = serviceSchema.safeParse(JSON.parse(checkpoint.config))
  if (
    !parsed.success ||
    !parsed.data.adjustments?.some(
      (a) => a.expiresAt > checkpoint.updated_at! && a.expiresAt <= now,
    )
  )
    return
  const before = await loadQueueState(env, queueId, now, {
    validityAt: checkpoint.updated_at,
  })
  await commitQueueTransition(env, queueId, before, {}, [], now)
}
export async function maintainQueue(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  await maintainServiceEntries(env, queueId, now)
  await expireArrivals(env, queueId, now)
}
/** Reads coalesce only after authoritative maintenance; missing projections never satisfy freshness. */
export async function refreshQueue(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  await maintainQueue(env, queueId, now)
  const freshness = await env.DB.prepare(
    `SELECT COUNT(*) AS waiting,COUNT(p.entry_id) AS projected,MIN(p.updated_at) AS oldest,SUM(CASE WHEN p.estimator_version=2 OR p.customer_minimum_at IS NOT NULL THEN 1 ELSE 0 END) AS initialized,
     MIN(a.safety_review_at) AS safety_due,
     MAX(p.updated_at) AS newest FROM queue_entry e LEFT JOIN queue_projection p ON p.entry_id=e.id LEFT JOIN queue_adaptive_projection a ON a.entry_id=e.id AND p.estimator_version=2
     WHERE e.queue_id=? AND e.status='waiting'`,
  )
    .bind(queueId)
    .first<{
      waiting: number
      projected: number
      initialized: number
      safety_due: number | null
      oldest: number | null
      newest: number | null
    }>()
  if (
    (
      await env.DB.prepare(
        'SELECT model_revision FROM queue_cadence_state WHERE queue_id=?',
      )
        .bind(queueId)
        .first<{ model_revision: number }>()
    )?.model_revision === 2 &&
    freshness &&
    freshness.waiting > 0 &&
    (freshness.safety_due === null || freshness.safety_due > now) &&
    freshness.waiting === freshness.projected &&
    freshness.waiting === freshness.initialized &&
    freshness.oldest !== null &&
    freshness.oldest > now - 5000 &&
    (freshness.newest ?? now) <= now
  )
    return
  await recalculateQueue(env, queueId, now)
}
export async function recalculateQueue(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  await maintainQueue(env, queueId, now)
  await activateIfReady(env, queueId, now)
  const state = await loadQueueState(env, queueId, now)
  const statements = await projectionStatements(env, queueId, state, now)
  if (statements.length) await env.DB.batch(statements)
  return state
}
export type QueueState = Awaited<ReturnType<typeof loadQueueState>>
/** Plan provenance, projections and notices BEFORE the operational D1 batch. */
export async function commitQueueTransition(
  env: CloudflareBindings,
  queueId: string,
  before: QueueState,
  afterModel: QueueModelInput,
  statements: D1PreparedStatement[],
  now: number,
  analyticsOrigin = 'queue.transition',
) {
  const hasOperationalWrites = statements.length > 0
  const after = await loadQueueState(env, queueId, now, afterModel)
  statements.push(
    ...(await projectionStatements(env, queueId, after, now, before)),
  )
  if (statements.length) {
    // Context and journal triggers participate in the same atomic D1 transaction.
    // No operational history scan, and no capture from unrelated maintenance SQL.
    if (env.METRICS_CAPTURE_ENABLED === 'true' && hasOperationalWrites) {
      statements.unshift(env.DB.prepare('INSERT INTO metrics_context(queue_id,at,origin) VALUES(?,?,?)').bind(queueId, now, analyticsOrigin))
      statements.push(env.DB.prepare('DELETE FROM metrics_context WHERE queue_id=?').bind(queueId))
    }
    await env.DB.batch(statements)
  }
  return after
}
async function projectionStatements(
  env: CloudflareBindings,
  queueId: string,
  state: QueueState,
  now: number,
  before?: QueueState,
) {
  if (state.adaptive)
    return adaptiveProjectionStatements(env, queueId, state, now, before)
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      'UPDATE queue_demand_episode SET ended_at=?,end_reason=? WHERE queue_id=? AND ended_at IS NULL',
    ).bind(now, 'estimator_disabled', queueId),
    env.DB.prepare(
      'UPDATE queue_cadence_state SET estimator_version=1,episode_id=NULL,episode_started_at=NULL,last_assignment_at=NULL WHERE queue_id=? AND estimator_version=2',
    ).bind(queueId),
    env.DB.prepare(
      'UPDATE queue_adaptive_projection SET safety_review_at=NULL WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)',
    ).bind(queueId),
    env.DB.prepare(
      'UPDATE queue_projection SET estimator_version=1 WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)',
    ).bind(queueId),
  ]
  const pendingJoinedSnapshots = new Map<
    string,
    { raw: string; snapshot: QueueNoticeSnapshot }
  >()
  const pendingJoinedRows = await env.DB.prepare(
    "SELECT n.entry_id,n.payload_snapshot FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id=? AND n.kind='queue_joined' AND n.status='pending' AND n.payload_version=2 AND n.payload_snapshot IS NOT NULL ORDER BY n.rowid",
  )
    .bind(queueId)
    .all<{ entry_id: string; payload_snapshot: string }>()
  for (const row of pendingJoinedRows.results) {
    try {
      const frozen = JSON.parse(row.payload_snapshot) as QueueNoticeSnapshot
      if (
        frozen.copyVersion === 4 &&
        frozen.copyVariant === 'queue_joined' &&
        frozen.projectionPending === true
      )
        pendingJoinedSnapshots.set(row.entry_id, {
          raw: row.payload_snapshot,
          snapshot: frozen,
        })
    } catch {
      // Malformed pending snapshots remain fail-closed at dispatch.
    }
  }
  const priorRows = await env.DB.prepare(
    `SELECT p.*,e.id AS entry_id,n.last_accepted_predicted_at,n.last_correction_accepted_at,n.last_accepted_operational_delta_ms,n.last_accepted_customer_minimum_at,EXISTS(SELECT 1 FROM notification_outbox a WHERE a.entry_id=e.id AND a.kind='approaching') AS has_approach
     FROM queue_entry e LEFT JOIN queue_projection p ON p.entry_id=e.id
     LEFT JOIN queue_notification_state n ON n.entry_id=e.id WHERE e.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(state.projections.map((p) => p.id)))
    .all<{
      entry_id: string | null
      position: number
      eta_minutes: number
      predicted_at: number | null
      quality: string
      resource_id: string | null
      callable: number
      revision: number
      updated_at: number
      operational_forecast_delta_ms: number
      last_accepted_predicted_at: number | null
      last_correction_accepted_at: number | null
      last_accepted_operational_delta_ms: number | null
      last_accepted_customer_minimum_at: number | null
      customer_minimum_at: number | null
      customer_configured_work_ms: number | null
      customer_initial_eta_minutes: number | null
      customer_operational_at: number | null
      has_approach: number
    }>()
  const priors = new Map(priorRows.results.map((row) => [row.entry_id, row]))
  const beforeProjections = new Map(before?.projections.map((p) => [p.id, p]))
  const configuredWork = configuredCustomerWork(
    state.parties,
    state.resources,
    state.config,
    state.baseline,
  )
  for (const p of state.projections) {
    const prior = priors.get(p.id)
    const initialized =
      prior?.customer_minimum_at != null &&
      prior.customer_configured_work_ms != null &&
      prior.customer_initial_eta_minutes != null
    const priorMinimum: CustomerMinimum | null = initialized
      ? {
          minimumAt: prior.customer_minimum_at!,
          configuredWorkMs: prior.customer_configured_work_ms!,
          initialEtaMinutes: prior.customer_initial_eta_minutes!,
        }
      : null
    const minimum = customerMinimum(
      priorMinimum,
      configuredWork.get(p.id)!,
      now,
      !!before,
    )
    const pendingMinimum = pendingJoinedSnapshots.get(p.id)?.snapshot
      .customerMinimumAt
    if (
      !initialized &&
      pendingMinimum != null &&
      Number.isFinite(pendingMinimum)
    )
      minimum.minimumAt = pendingMinimum
    const oldCustomer = prior
      ? customerEstimate(
          {
            predictedAt: stableOperationalAt(
              prior.predicted_at,
              prior.customer_operational_at ?? null,
            ),
            quality: prior.quality as 'estimated' | 'provisional' | 'unknown',
          },
          prior.customer_minimum_at ?? null,
          prior.updated_at ?? now,
        )
      : null
    const beforeProjection = beforeProjections.get(p.id)
    const operationalDelta =
      (prior?.operational_forecast_delta_ms ?? 0) +
      (beforeProjection?.predictedAt != null &&
      p.predictedAt != null &&
      Number.isFinite(beforeProjection.predictedAt) &&
      Number.isFinite(p.predictedAt)
        ? p.predictedAt - beforeProjection.predictedAt
        : 0)
    const customerOperationalAt = stableOperationalAt(
      p.predictedAt,
      prior?.customer_operational_at ?? null,
      beforeProjection?.predictedAt,
    )
    const customer = customerEstimate(
      { ...p, predictedAt: customerOperationalAt },
      minimum.minimumAt,
      now,
    )
    if (!initialized)
      minimum.initialEtaMinutes = Math.max(1, customer.etaMinutes)
    if (p.quality !== 'unknown' && p.etaMinutes > 0)
      statements.push(
        env.DB.prepare(
          'UPDATE queue_entry SET progress_initial_eta_minutes=? WHERE id=? AND progress_initial_eta_minutes IS NULL',
        ).bind(p.etaMinutes, p.id),
      )
    const approachingNow =
      !!state.config &&
      customer.estimateQuality !== 'unknown' &&
      customer.etaMinutes <= (state.config.approachMinutes ?? 10)
    const approachingBefore =
      !!state.config &&
      !!prior &&
      initialized &&
      oldCustomer?.estimateQuality !== 'unknown' &&
      (oldCustomer?.etaMinutes ?? Infinity) <=
        (state.config.approachMinutes ?? 10)
    const changed =
      !prior ||
      prior.position !== p.position ||
      prior.quality !== p.quality ||
      prior.resource_id !== p.resourceId ||
      !!prior.callable !== p.callable ||
      prior.customer_minimum_at !== minimum.minimumAt ||
      prior.operational_forecast_delta_ms !== operationalDelta ||
      approachingNow !== approachingBefore
    const revision = (prior?.revision ?? 0) + Number(changed)
    const snapshot: QueueNoticeSnapshot | null = state.config
      ? {
          schemaVersion: 2,
          operationalForecastDeltaMs: operationalDelta,
          customerMinimumAt: minimum.minimumAt,
          approachRecommended: approachingNow,
          serviceName: state.config.name,
          ahead: Math.max(0, p.position - 1),
          etaMinutes: customer.etaMinutes,
          predictedAt: customer.predictedAt,
          estimateQuality: customer.estimateQuality,
          resourceName: null,
          arrivalDeadlineAt: null,
        }
      : null
    if (
      snapshot &&
      approachingNow &&
      !approachingBefore &&
      !prior?.has_approach &&
      (initialized || (before && !beforeProjection))
    )
      statements.push(
        noticeStatement(
          env,
          p.id,
          'approaching',
          now,
          snapshot,
          revision,
          0,
          !!state.config,
        ),
      )
    const notificationState = prior
    if (
      prior?.last_accepted_predicted_at != null &&
      prior.last_accepted_customer_minimum_at == null
    )
      statements.push(
        env.DB.prepare(
          'UPDATE queue_notification_state SET last_accepted_customer_minimum_at=? WHERE entry_id=? AND last_accepted_customer_minimum_at IS NULL',
        ).bind(minimum.minimumAt, p.id),
      )
    // Never infer historical causality. Existing accepted forecasts start from current provenance.
    if (
      prior?.last_accepted_predicted_at != null &&
      prior.last_accepted_operational_delta_ms == null
    )
      statements.push(
        env.DB.prepare(
          'UPDATE queue_notification_state SET last_accepted_operational_delta_ms=? WHERE entry_id=? AND last_accepted_operational_delta_ms IS NULL',
        ).bind(operationalDelta, p.id),
      )
    const correction = evaluateEstimateNotice({
      previousAcceptedOperationalDeltaMs:
        notificationState?.last_accepted_operational_delta_ms ?? null,
      currentOperationalDeltaMs: operationalDelta,
      previousAcceptedAt: notificationState?.last_accepted_predicted_at ?? null,
      currentPredictedAt: customer.predictedAt,
      quality: customer.estimateQuality,
      currentOperationalPredictedAt: customerOperationalAt,
      previousAcceptedMinimumAt:
        notificationState?.last_accepted_customer_minimum_at ?? null,
      currentMinimumAt: minimum.minimumAt,
      lastCorrectionAcceptedAt:
        notificationState?.last_correction_accepted_at ?? null,
      thresholdMinutes: state.config?.etaChangeThresholdMinutes ?? 5,
      cooldownMinutes: state.config?.notificationCooldownMinutes ?? 10,
      now,
    })
    if (initialized && correction && snapshot)
      statements.push(
        noticeStatement(
          env,
          p.id,
          correction,
          now,
          snapshot,
          revision,
          0,
          !!state.config,
        ),
      )
    statements.push(
      env.DB.prepare(
        'INSERT INTO queue_projection(entry_id,position,eta_minutes,predicted_at,quality,resource_id,callable,revision,updated_at,operational_forecast_delta_ms,customer_minimum_at,customer_configured_work_ms,customer_initial_eta_minutes,customer_operational_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET position=excluded.position,eta_minutes=excluded.eta_minutes,predicted_at=excluded.predicted_at,quality=excluded.quality,resource_id=excluded.resource_id,callable=excluded.callable,revision=excluded.revision,updated_at=excluded.updated_at,operational_forecast_delta_ms=excluded.operational_forecast_delta_ms,customer_minimum_at=excluded.customer_minimum_at,customer_configured_work_ms=excluded.customer_configured_work_ms,customer_initial_eta_minutes=excluded.customer_initial_eta_minutes,customer_operational_at=excluded.customer_operational_at',
      ).bind(
        p.id,
        p.position,
        p.etaMinutes,
        p.predictedAt,
        p.quality,
        p.resourceId,
        Number(p.callable),
        revision,
        now,
        operationalDelta,
        minimum.minimumAt,
        minimum.configuredWorkMs,
        minimum.initialEtaMinutes,
        customerOperationalAt,
      ),
    )
    const joinedSnapshot = pendingJoinedSnapshots.get(p.id)
    if (joinedSnapshot) {
      const frozen = { ...joinedSnapshot.snapshot }
      delete frozen.projectionPending
      frozen.ahead = Math.max(0, p.position - 1)
      frozen.etaMinutes = customer.etaMinutes
      frozen.operationalForecastDeltaMs = operationalDelta
      frozen.customerMinimumAt = minimum.minimumAt
      frozen.predictedAt = customer.predictedAt
      frozen.estimateQuality = customer.estimateQuality
      statements.push(
        env.DB.prepare(
          "UPDATE notification_outbox SET payload_snapshot=?,revision=?,updated_at=? WHERE entry_id=? AND kind='queue_joined' AND status='pending' AND payload_version=2 AND payload_snapshot=?",
        ).bind(JSON.stringify(frozen), revision, now, p.id, joinedSnapshot.raw),
      )
    }
    if (p.predictedAt !== null)
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO queue_forecast_anchor(entry_id,predicted_at,created_at,legacy_eta_minutes) VALUES (?,?,?,?)',
        ).bind(
          p.id,
          p.predictedAt,
          now,
          Math.max(0, p.position - 1) * state.baseline,
        ),
      )
    if (changed)
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO queue_estimate_intent(entry_id,revision,payload,created_at) VALUES (?,?,?,?)',
        ).bind(p.id, revision, JSON.stringify(p), now),
      )
    // Apply policy to the latest projection and retire any older pending
    // estimates in the same transaction; they must not remain an unconsumed
    // backlog or emit notices for stale revisions.
    statements.push(
      env.DB.prepare(
        "UPDATE queue_estimate_intent SET status='policy_evaluated' WHERE entry_id=? AND status='policy_pending' AND revision<=?",
      ).bind(p.id, revision),
    )
  }
  return statements
}
export async function readProjection(
  env: CloudflareBindings,
  entryId: string,
  customer = false,
) {
  const row = await env.DB.prepare(
    'SELECT p.position,p.eta_minutes AS etaMinutes,p.predicted_at AS predictedAt,p.quality AS estimateQuality,p.resource_id AS resourceId,p.callable,p.customer_minimum_at,p.customer_initial_eta_minutes,p.customer_operational_at,p.updated_at FROM queue_projection p WHERE p.entry_id=?',
  )
    .bind(entryId)
    .first<{
      position: number
      etaMinutes: number
      predictedAt: number | null
      estimateQuality: 'estimated' | 'provisional' | 'unknown'
      resourceId: string | null
      callable: number
      customer_operational_at: number | null
      customer_minimum_at: number | null
      customer_initial_eta_minutes: number | null
      updated_at: number
    }>()
  if (!row) return null
  if (!customer)
    return {
      ...row,
      initialEtaMinutes: row.customer_initial_eta_minutes,
      callable: !!row.callable,
    }
  const now = Date.now()
  const adaptive = await env.DB.prepare(
    `SELECT a.*,p.revision FROM queue_adaptive_projection a
    JOIN queue_projection p ON p.entry_id=a.entry_id WHERE a.entry_id=? AND p.estimator_version=2`,
  )
    .bind(entryId)
    .first<{
      quality: 'estimated' | 'provisional'
      predicted_at: number
      safety_review_at: number | null
      delay_reason: 'safety' | 'resources' | 'cadence' | 'configuration' | null
      delay_since: number | null
      delay_baseline_at: number | null
      revision: number
    }>()
  if (adaptive)
    return {
      position: row.position,
      predictedAt: adaptive.predicted_at,
      etaMinutes: Math.max(0, Math.ceil((adaptive.predicted_at - now) / 60000)),
      estimateQuality: adaptive.quality,
      initialEtaMinutes: row.customer_initial_eta_minutes,
      callable: !!row.callable,
      resourceId: row.resourceId,
      estimatorVersion: 2 as const,
      estimationRevision: adaptive.revision,
      safetyReviewAt: adaptive.safety_review_at,
      delay:
        adaptive.delay_reason &&
        adaptive.delay_since !== null &&
        adaptive.delay_baseline_at !== null
          ? {
              reason: adaptive.delay_reason,
              since: adaptive.delay_since,
              previousPredictedAt: adaptive.delay_baseline_at,
            }
          : null,
    }
  const estimate =
    row.updated_at < now - 120000 || row.updated_at > now
      ? {
          etaMinutes: 0,
          predictedAt: null,
          estimateQuality: 'unknown' as const,
        }
      : customerEstimate(
          {
            predictedAt: stableOperationalAt(
              row.predictedAt,
              row.customer_operational_at,
            ),
            quality: row.estimateQuality,
          },
          row.customer_minimum_at,
          now,
        )
  return {
    position: row.position,
    ...estimate,
    initialEtaMinutes: row.customer_initial_eta_minutes,
    callable: !!row.callable,
    resourceId: row.resourceId,
  }
}
