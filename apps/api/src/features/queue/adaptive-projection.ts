import type { QueueState } from './projection'
import { safetyMarginMs, protectionRemainingMs } from './adaptive-model'
import { evaluateAdaptiveNotice } from './estimate-notices'
import { noticeStatement, type QueueNoticeSnapshot } from './notices'

type Reason = 'safety' | 'resources' | 'cadence' | 'configuration'
type Prior = {
  entry_id: string
  call_cycle: number
  extension_sequence: number
  pending_extension: number
  estimator_version: number
  revision: number
  position: number
  quality: string
  resource_id: string | null
  callable: number
  predicted_at: number | null
  cadence_ms: number
  safety_review_at: number | null
  delay_reason: Reason | null
  delay_since: number | null
  delay_baseline_at: number | null
  approach_episode: number
  approach_armed: number
  correction_reason: Reason | null
  safety_revision: number
  notice_baseline_at: number
  last_accepted_predicted_at: number | null
  last_correction_accepted_at: number | null
  last_accepted_safety_revision: number | null
  pending_approach: number
}

/** All adaptive evidence, deadlines and notice intents commit with the real event. */
export async function adaptiveProjectionStatements(
  env: CloudflareBindings,
  queueId: string,
  state: QueueState,
  now: number,
  before?: QueueState,
) {
  const learning = state.adaptive!,
    config = state.config!
  const statements = [...learning.statements]
  const rows = await env.DB.prepare(
    `SELECT e.id AS entry_id,e.call_cycle,
    COALESCE((SELECT MAX(x.extension_sequence) FROM queue_wait_extension x WHERE x.entry_id=e.id),0) AS extension_sequence,
    EXISTS(SELECT 1 FROM notification_outbox x WHERE x.entry_id=e.id AND x.kind='delayed' AND x.status IN ('pending','sending') AND x.call_cycle=e.call_cycle AND json_extract(x.payload_snapshot,'$.extensionSequence') IS NOT NULL) AS pending_extension,
    p.estimator_version,p.revision,p.position,a.quality,p.resource_id,p.callable,
    a.predicted_at,a.cadence_ms,a.safety_review_at,a.delay_reason,a.delay_since,a.delay_baseline_at,
    a.approach_episode,a.approach_armed,a.correction_reason,a.safety_revision,a.notice_baseline_at,
    n.last_accepted_predicted_at,n.last_correction_accepted_at,n.last_accepted_safety_revision,
    EXISTS(SELECT 1 FROM notification_outbox o WHERE o.entry_id=e.id AND o.kind='approaching' AND o.status='pending') AS pending_approach
    FROM queue_entry e LEFT JOIN queue_projection p ON p.entry_id=e.id
    LEFT JOIN queue_adaptive_projection a ON a.entry_id=e.id
    LEFT JOIN queue_notification_state n ON n.entry_id=e.id WHERE e.queue_id=? AND e.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(queueId, JSON.stringify(state.parties.map((p) => p.id)))
    .all<Prior>()
  const priors = new Map(rows.results.map((r) => [r.entry_id, r]))
  const beforeProjections = new Map(
    before?.adaptiveProjections.map((p) => [p.id, p]),
  )
  let previousAt: number | null = null,
    previousRaw: number | null = null
  let propagatedSafety = false
  for (const p of state.adaptiveProjections) {
    const prior = priors.get(p.id)
    const initialized =
      !learning.transitioning &&
      prior?.estimator_version === 2 &&
      prior.predicted_at != null
    const old = beforeProjections.get(p.id)
    const activation =
      learning.transitioning || (!initialized && !!prior?.predicted_at)
    // An actual assignment establishes the next cadence origin. Subtracting
    // the completed slot from an already elapsed deadline would count progress
    // twice (4/8/12 at t=0 must become 8/12 after the first call at t=4).
    let predictedAt: number =
      initialized && learning.assignmentRecorded && old
        ? p.predictedAt
        : initialized
        ? prior.predicted_at! + (old ? p.predictedAt - old.predictedAt : 0)
        : p.predictedAt -
          (learning.transitioning
            ? Math.max(0, now - learning.lastProgressAt)
            : 0) +
          (!activation && previousAt !== null && previousRaw !== null
            ? previousAt - previousRaw
            : 0)
    const beforePropagation = predictedAt
    if (previousAt !== null)
      predictedAt = Math.max(predictedAt, previousAt + p.cadenceMs)
    const safetyPropagation: boolean =
      propagatedSafety && predictedAt > beforePropagation
    const S = safetyMarginMs(p.cadenceMs, config.approachMinutes ?? 10)
    const reviewDue = learning.active && predictedAt - S <= now
    let reason: Reason = prior?.correction_reason ?? 'cadence'
    if (old && p.predictedAt !== old.predictedAt)
      reason =
        JSON.stringify(before?.config) !== JSON.stringify(config)
          ? 'configuration'
          : before?.adaptive?.factor !== learning.factor ||
            before?.parties.length !== state.parties.length
          ? 'cadence'
          : 'cadence'
    if (safetyPropagation) reason = 'safety'
    let delayReason = initialized ? prior.delay_reason : null
    let delaySince = initialized ? prior.delay_since : null
    let delayBaseline = initialized ? prior.delay_baseline_at : null
    let safetyRevision = initialized ? prior.safety_revision : 0
    const formerAt = initialized ? prior.predicted_at! : predictedAt
    if (reviewDue) {
      const remaining = protectionRemainingMs(
        p.cadenceMs,
        S,
        now - learning.lastProgressAt,
      )
      predictedAt = Math.max(predictedAt, p.predictedAt, now + remaining)
      reason = 'safety'
    }
    const moved = initialized && predictedAt !== prior.predicted_at
    if (moved && predictedAt > formerAt && delayBaseline === null) {
      delayBaseline = formerAt
      delaySince = now
      delayReason = reason
    }
    if (delayBaseline !== null && predictedAt <= delayBaseline) {
      delayReason = null
      delaySince = null
      delayBaseline = null
      safetyRevision = 0
    }
    if ((reviewDue || safetyPropagation) && delayBaseline !== null)
      delayReason = 'safety'
    if (
      delayReason === 'safety' &&
      safetyRevision > (prior?.last_accepted_safety_revision ?? 0)
    )
      reason = 'safety'
    const quality =
      delayReason === 'safety' || reviewDue ? 'provisional' : p.quality
    const extended = initialized && learning.active && predictedAt > formerAt
    const extensionSequence = (prior?.extension_sequence ?? 0) + Number(extended)
    const callCycle = prior?.call_cycle ?? 0
    const A = (config.approachMinutes ?? 10) * 60000
    let armed = initialized ? !!prior.approach_armed : true
    let episode = initialized ? prior.approach_episode : 0
    if (moved && predictedAt - now > A + S && !armed) {
      armed = true
      episode++
    }
    const approach =
      learning.active && armed && predictedAt - now <= A && !activation &&
      !extended && !prior?.pending_extension
    if (approach || (activation && predictedAt - now <= A)) armed = false
    const reviewAt = learning.active ? predictedAt - S : null
    const changed =
      !initialized ||
      moved ||
      prior.position !== p.position ||
      prior.quality !== quality ||
      prior.approach_armed !== Number(armed) ||
      prior.approach_episode !== episode ||
      prior.safety_review_at !== reviewAt
    const revision = (prior?.revision ?? 0) + Number(changed)
    if ((reviewDue || safetyPropagation) && !safetyRevision)
      safetyRevision = revision
    const noticeBaseline = initialized ? prior.notice_baseline_at : predictedAt
    // Migration activation establishes a current baseline, not a historical correction.
    if (activation)
      statements.push(
        env.DB.prepare(
          `UPDATE queue_notification_state SET last_accepted_predicted_at=?,last_accepted_safety_revision=0 WHERE entry_id=?`,
        ).bind(predictedAt, p.id),
      )
    const snapshot: QueueNoticeSnapshot = {
      schemaVersion: 2,
      ...(extended ? { extensionSequence } : {}),
      estimatorVersion: 2,
      estimationRevision: revision,
      correctionReason: reason,
      safetyRevision,
      approachEpisode: episode,
      serviceName: config.name,
      ahead: p.position - 1,
      etaMinutes: Math.max(0, Math.ceil((predictedAt - now) / 60000)),
      predictedAt,
      estimateQuality: quality,
      approachRecommended: predictedAt - now <= A,
      resourceName: null,
      arrivalDeadlineAt: null,
    }
    const evaluatedCorrection =
      initialized && learning.active
        ? evaluateAdaptiveNotice({
            previousAcceptedAt:
              prior.last_accepted_predicted_at ?? noticeBaseline,
            currentPredictedAt: predictedAt,
            lastCorrectionAcceptedAt: prior.last_correction_accepted_at,
            thresholdMinutes: config.etaChangeThresholdMinutes ?? 5,
            cooldownMinutes: config.notificationCooldownMinutes ?? 10,
            now,
            reason,
            safetyRevision,
            lastAcceptedSafetyRevision: prior.last_accepted_safety_revision,
          })
        : null
    // Delivery history must not hide a later extension, even after an improvement.
    const correction = extended ? 'delayed' : evaluatedCorrection === 'improved' ? 'improved' : null
    if (extended)
      statements.push(env.DB.prepare(
        `INSERT INTO queue_wait_extension(entry_id,call_cycle,extension_sequence,previous_at,predicted_at,reason,created_at) VALUES (?,?,?,?,?,?,?)`,
      ).bind(p.id, callCycle, extensionSequence, formerAt, predictedAt, reason, now))
    // Event-based delays survive unrelated revisions and subsequent extensions.
    // Other snapshots remain revision-bound; inactive/cycle changes retire all.
    statements.push(
      env.DB.prepare(
        `UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE entry_id=? AND status='pending'
      AND kind IN ('approaching','delayed','improved') AND (
        ?=0 OR ?=1 OR call_cycle<>? OR
        ((kind<>'delayed' OR json_extract(payload_snapshot,'$.extensionSequence') IS NULL)
          AND (revision<>? OR json_extract(payload_snapshot,'$.estimatorVersion') IS NULL)))`,
      ).bind(now, p.id, Number(learning.active), Number(activation), callCycle, revision),
    )
    if (
      !activation &&
      (approach ||
        (prior?.pending_approach &&
          predictedAt - now <= A &&
          learning.active)) &&
      correction !== 'delayed' && !prior?.pending_extension
    )
      statements.push(
        noticeStatement(
          env,
          p.id,
          'approaching',
          now,
          snapshot,
          revision,
          callCycle,
          true,
        ),
      )
    else if (correction)
      statements.push(
        noticeStatement(
          env,
          p.id,
          correction,
          now,
          snapshot,
          revision,
          callCycle,
          true,
        ),
      )
    const raw = state.projections.find((item) => item.id === p.id)!
    statements.push(
      env.DB.prepare(
        `INSERT INTO queue_projection(entry_id,position,eta_minutes,predicted_at,quality,resource_id,callable,revision,updated_at,estimator_version,customer_initial_eta_minutes)
      VALUES (?,?,?,?,?,?,?,?,?,2,?) ON CONFLICT(entry_id) DO UPDATE SET position=excluded.position,eta_minutes=excluded.eta_minutes,
      predicted_at=excluded.predicted_at,quality=excluded.quality,resource_id=excluded.resource_id,callable=excluded.callable,
      revision=excluded.revision,updated_at=excluded.updated_at,estimator_version=2,
      customer_initial_eta_minutes=COALESCE(queue_projection.customer_initial_eta_minutes,excluded.customer_initial_eta_minutes)`,
      ).bind(
        p.id,
        p.position,
        snapshot.etaMinutes,
        predictedAt,
        quality,
        null,
        Number(raw.callable),
        revision,
        now,
        snapshot.etaMinutes,
      ),
    )
    statements.push(
      env.DB.prepare(
        `INSERT INTO queue_adaptive_projection(entry_id,predicted_at,cadence_ms,safety_review_at,delay_reason,delay_since,delay_baseline_at,
      approach_episode,approach_armed,correction_reason,safety_revision,notice_baseline_at,quality) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(entry_id) DO UPDATE SET predicted_at=excluded.predicted_at,cadence_ms=excluded.cadence_ms,quality=excluded.quality,safety_review_at=excluded.safety_review_at,
      delay_reason=excluded.delay_reason,delay_since=excluded.delay_since,delay_baseline_at=excluded.delay_baseline_at,
      approach_episode=excluded.approach_episode,approach_armed=excluded.approach_armed,correction_reason=excluded.correction_reason,
      safety_revision=excluded.safety_revision,notice_baseline_at=excluded.notice_baseline_at`,
      ).bind(
        p.id,
        predictedAt,
        p.cadenceMs,
        reviewAt,
        delayReason,
        delaySince,
        delayBaseline,
        episode,
        Number(armed),
        reason,
        safetyRevision,
        noticeBaseline,
        quality,
      ),
    )
    statements.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO queue_forecast_anchor(entry_id,predicted_at,created_at,legacy_eta_minutes) VALUES (?,?,?,?)',
      ).bind(p.id, predictedAt, now, (p.position - 1) * state.baseline),
    )
    if (changed)
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO queue_estimate_intent(entry_id,revision,payload,created_at,status) VALUES (?,?,?,?,'policy_evaluated')",
        ).bind(p.id, revision, JSON.stringify(snapshot), now),
      )
    // Joined snapshots created in the same transaction receive this exact deadline.
    statements.push(
      env.DB.prepare(
        `UPDATE notification_outbox SET payload_snapshot=json_patch(payload_snapshot,?),revision=?
      WHERE entry_id=? AND kind='queue_joined' AND (status='pending' OR json_extract(payload_snapshot,'$.projectionPending')=1) AND payload_version=2
      AND (json_extract(payload_snapshot,'$.projectionPending')=1 OR json_extract(payload_snapshot,'$.estimatorVersion') IS NULL OR ?=1)`,
      ).bind(
        JSON.stringify({
          ...snapshot,
          resourceName: undefined,
          arrivalDeadlineAt: undefined,
          projectionPending: null,
          customerMinimumAt: null,
        }),
        revision,
        p.id,
        Number(learning.transitioning),
      ),
    )
    propagatedSafety =
      reviewDue || safetyPropagation || delayReason === 'safety'
    previousAt = predictedAt
    previousRaw = p.predictedAt
  }
  // Use the prospective party set: entry status updates have not committed yet.
  statements.push(
    env.DB.prepare(
      `UPDATE queue_adaptive_projection SET safety_review_at=NULL WHERE safety_review_at IS NOT NULL AND entry_id IN
    (SELECT id FROM queue_entry WHERE queue_id=?) AND entry_id NOT IN (SELECT value FROM json_each(?))`,
    ).bind(queueId, JSON.stringify(state.parties.map((p) => p.id))),
  )
  return statements
}
