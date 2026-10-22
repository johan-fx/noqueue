import { admissionState } from '../../staff/availability'
import { customerEstimate, stableOperationalAt } from '../../queue/customer-estimate'
import { evaluateAdaptiveNotice, evaluateEstimateNotice } from '../../queue/estimate-notices'
import type { PushSnapshot } from './lifecycle'

export type LifecycleRow = { entry_id: string; kind: string; call_cycle: number; revision: number; attempts: number }
/** Same business policies as WA, evaluated against the mobile channel's own reference. */
export async function currentPushSnapshot(env: CloudflareBindings, row: LifecycleRow, s: PushSnapshot, now: number): Promise<PushSnapshot | null> {
  const expected = row.kind === 'called' ? ['ready', 'improved_ready']
    : row.kind === 'improved' ? ['improved_wait_recommended', 'improved_wait_neutral']
    : row.kind === 'cancelled' ? ['cancelled_staff', 'cancelled_unknown'] : [row.kind]
  if (!expected.includes(s.copyVariant)) return null
  const c = await env.DB.prepare(`SELECT e.status,e.call_cycle,e.arrival_deadline_at,e.queue_id,q.config,
    p.revision,p.estimator_version,p.predicted_at,p.customer_operational_at,p.quality,p.position,p.updated_at,
    p.customer_minimum_at,p.operational_forecast_delta_ms,
    a.predicted_at AS adaptive_at,a.quality AS adaptive_quality,a.approach_episode,a.correction_reason,a.safety_revision,a.notice_baseline_at,
    n.reference_predicted_at,n.reference_operational_delta_ms,n.reference_minimum_at,n.last_correction_accepted_at,n.last_accepted_safety_revision
    FROM queue_entry e JOIN queue q ON q.id=e.queue_id LEFT JOIN queue_projection p ON p.entry_id=e.id
    LEFT JOIN queue_adaptive_projection a ON a.entry_id=e.id LEFT JOIN mobile_push_state n ON n.entry_id=e.id WHERE e.id=?`)
    .bind(row.entry_id).first<{
      status: string; call_cycle: number; arrival_deadline_at: number | null; queue_id: string; config: string;
      revision: number | null; estimator_version: number | null; predicted_at: number | null; customer_operational_at: number | null;
      quality: 'estimated' | 'provisional' | 'unknown' | null; position: number | null; updated_at: number | null;
      customer_minimum_at: number | null; operational_forecast_delta_ms: number | null;
      adaptive_at: number | null; adaptive_quality: 'estimated' | 'provisional' | 'unknown' | null;
      approach_episode: number | null; correction_reason: string | null; safety_revision: number | null; notice_baseline_at: number | null;
      reference_predicted_at: number | null; reference_operational_delta_ms: number | null; reference_minimum_at: number | null;
      last_correction_accepted_at: number | null; last_accepted_safety_revision: number | null;
    }>()
  if (!c || row.call_cycle !== c.call_cycle) return null
  if (row.kind === 'called') return c.status === 'called' && (c.arrival_deadline_at ?? 0) > now ? s : null
  if (row.kind === 'expired') return c.status === 'expired' ? s : null
  if (row.kind === 'cancelled' || row.kind === 'service_ended') {
    if (c.status !== 'cancelled') return null
    const ended = !!await env.DB.prepare("SELECT 1 FROM queue_event WHERE entry_id=? AND kind='service_ended' LIMIT 1").bind(row.entry_id).first()
    return (row.kind === 'service_ended') === ended ? s : null
  }
  if (c.status !== 'waiting' || c.updated_at === null || c.updated_at < now - 120000 || c.updated_at > now) return null
  const adaptive = c.estimator_version === 2
  if (adaptive !== (s.estimatorVersion === 2)) return null
  let config: { approachMinutes?: number; etaChangeThresholdMinutes?: number; notificationCooldownMinutes?: number }
  try { config = JSON.parse(c.config); if (!config) return null } catch { return null }
  const operational = adaptive ? c.adaptive_at : stableOperationalAt(c.predicted_at, c.customer_operational_at)
  const effective = customerEstimate({ predictedAt: operational, quality: (adaptive ? c.adaptive_quality : c.quality) ?? 'unknown' }, adaptive ? null : c.customer_minimum_at, now)
  if (effective.estimateQuality === 'unknown' || effective.predictedAt === null) return null
  const extension = row.kind === 'delayed' && s.extensionSequence !== undefined
  if (!extension && (row.revision !== c.revision || (adaptive && s.estimationRevision !== c.revision))) return null
  if (adaptive) {
    const admission = await admissionState(env, c.queue_id, new Date(now))
    if (!admission?.serviceOpen || admission.queueState !== 'active') return null
  }
  if (extension) {
    if (!adaptive) return null
    const event = await env.DB.prepare('SELECT previous_at FROM queue_wait_extension WHERE entry_id=? AND call_cycle=? AND extension_sequence=?')
      .bind(row.entry_id, row.call_cycle, s.extensionSequence!).first<{ previous_at: number }>()
    if (!event || effective.predictedAt <= event.previous_at) return null
    // Each extension survives unrelated revisions, but its first attempted copy
    // reflects the latest forecast. A retry retains the exact attempted text.
    return row.attempts ? s : { ...s, ahead: c.position === null ? null : Math.max(0, c.position - 1),
      predictedAt: effective.predictedAt, etaMinutes: Math.max(0, Math.ceil((effective.predictedAt - now) / 60000)),
      estimateQuality: effective.estimateQuality, estimationRevision: c.revision ?? row.revision }
  }
  if (row.kind === 'approaching') return effective.predictedAt - now <= (config.approachMinutes ?? 10) * 60000 &&
    (!adaptive || s.approachEpisode === c.approach_episode) ? s : null
  const thresholdMinutes = config.etaChangeThresholdMinutes ?? 5, cooldownMinutes = config.notificationCooldownMinutes ?? 10
  let kind: string | null
  if (adaptive) {
    if (!s.correctionReason || s.correctionReason !== c.correction_reason || s.safetyRevision !== c.safety_revision) return null
    kind = evaluateAdaptiveNotice({ previousAcceptedAt: c.reference_predicted_at ?? c.notice_baseline_at,
      currentPredictedAt: effective.predictedAt, lastCorrectionAcceptedAt: c.last_correction_accepted_at,
      thresholdMinutes, cooldownMinutes, now, reason: s.correctionReason, safetyRevision: c.safety_revision ?? 0,
      lastAcceptedSafetyRevision: c.last_accepted_safety_revision })
  } else {
    if (s.customerMinimumAt !== c.customer_minimum_at || s.operationalForecastDeltaMs !== c.operational_forecast_delta_ms) return null
    kind = evaluateEstimateNotice({ previousAcceptedOperationalDeltaMs: c.reference_operational_delta_ms,
      currentOperationalDeltaMs: c.operational_forecast_delta_ms ?? 0, previousAcceptedMinimumAt: c.reference_minimum_at,
      currentMinimumAt: c.customer_minimum_at ?? undefined, currentOperationalPredictedAt: operational,
      previousAcceptedAt: c.reference_predicted_at, currentPredictedAt: effective.predictedAt,
      quality: effective.estimateQuality, lastCorrectionAcceptedAt: c.last_correction_accepted_at, thresholdMinutes, cooldownMinutes, now })
  }
  return kind === row.kind ? s : null
}
