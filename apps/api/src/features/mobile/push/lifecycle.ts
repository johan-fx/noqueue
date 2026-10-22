import { parseQueueNoticeSnapshot, type QueueNoticeKind, type QueueNoticeSnapshot } from '../../queue/notices'
import { z } from 'zod'

export const pushVariants = ['approaching', 'delayed', 'improved_wait_recommended', 'improved_wait_neutral', 'ready', 'improved_ready', 'expired', 'cancelled_staff', 'cancelled_unknown', 'service_ended'] as const
export type PushVariant = typeof pushVariants[number]
export type PushSnapshot = QueueNoticeSnapshot & { venue: string; locale: 'es' | 'en'; copyVariant: PushVariant }
const envelope = z.object({ venue: z.string().min(1), locale: z.enum(['es', 'en']), copyVariant: z.enum(pushVariants) })
export function parsePushSnapshot(raw: string): PushSnapshot {
  const value: unknown = JSON.parse(raw)
  const snapshot = parseQueueNoticeSnapshot(value)
  if (!snapshot) throw new Error('invalid_push_snapshot')
  return { ...snapshot, ...envelope.parse(value) }
}

/** Domain intent, atomic with the transition. Never requires WA configuration. */
export function pushNoticeStatement(env: CloudflareBindings, entryId: string, kind: QueueNoticeKind,
  now: number, snapshot: QueueNoticeSnapshot, revision: number, callCycle: number) {
  const pushKind = kind === 'ready' ? 'called' : kind
  const variant: PushVariant = kind === 'improved'
    ? snapshot.approachRecommended ? 'improved_wait_recommended' : 'improved_wait_neutral'
    : kind === 'cancelled' ? snapshot.reason === 'staff_cancel' ? 'cancelled_staff' : 'cancelled_unknown'
    : kind
  const waiting = ['approaching', 'delayed', 'improved'].includes(kind)
  // No channel-specific action signatures or WhatsApp profile in mobile data.
  const { actionContext: _action, copyVersion: _copy, copyVariant: _variant, ...context } = snapshot
  const identity = snapshot.extensionSequence !== undefined && kind === 'delayed'
    ? `extension:${snapshot.extensionSequence}`
    : kind === 'approaching' && snapshot.approachEpisode !== undefined
    ? `episode:${snapshot.approachEpisode}:r${revision}` : `r${revision}`
  return env.DB.prepare(`INSERT OR IGNORE INTO mobile_push_outbox
    (id,entry_id,installation_hash,entry_version,kind,next_attempt_at,expires_at,created_at,payload_version,payload_snapshot,event_key,revision,call_cycle)
    SELECT lower(hex(randomblob(16))),e.id,m.installation_hash,e.version+CASE WHEN ?=1 OR (?='called' AND e.call_cycle=?) THEN 0 ELSE 1 END,?,?,?, ?,2,
      json_patch(?,json_object('venue',v.name,'locale',e.locale,'copyVariant',
        CASE WHEN ?='called' AND s.reference_predicted_at-?>=MAX(0,COALESCE(json_extract(q.config,'$.etaChangeThresholdMinutes'),5))*60000
          THEN 'improved_ready' ELSE ? END)),
      e.id||':'||?||':c'||(CASE WHEN ?='called' THEN ? ELSE e.call_cycle END)||':'||?, ?,CASE WHEN ?='called' THEN ? ELSE e.call_cycle END
    FROM queue_entry e JOIN mobile_entry_installation m ON m.entry_id=e.id
    JOIN mobile_push_registration r ON r.installation_hash=m.installation_hash AND r.enabled=1
    JOIN queue q ON q.id=e.queue_id JOIN venue v ON v.id=q.venue_id
    LEFT JOIN mobile_push_state s ON s.entry_id=e.id
    WHERE e.id=? AND ?=1 AND ?=0
      AND (?=0 OR (e.status='waiting' AND s.entry_id IS NOT NULL AND s.eligible_after<=?))`)
    .bind(Number(waiting), pushKind, callCycle, pushKind, now, kind === 'ready' ? snapshot.arrivalDeadlineAt ?? now : now + 600000, now,
      JSON.stringify(context), pushKind, now, variant, pushKind, pushKind, callCycle, identity, revision, pushKind, callCycle, entryId,
      Number(env.MOBILE_PUSH_ENABLED === 'true'), Number(snapshot.reason === 'customer_cancel'), Number(waiting), now)
}

/** Called after canonical projection statements, including for an unregistered installation. */
export function pushProjectionStatements(env: CloudflareBindings, entryId: string, snapshot: QueueNoticeSnapshot,
  revision: number, now: number, screen = false, active = true, activation = false) {
  const disabled = env.MOBILE_PUSH_ENABLED !== 'true'
  return [
    env.DB.prepare(`UPDATE mobile_push_outbox SET status='discarded',last_error='superseded'
      WHERE entry_id=? AND status IN ('pending','sending') AND payload_version=2 AND (
        ?=1 OR ?=1 OR call_cycle<>(SELECT call_cycle FROM queue_entry WHERE id=?) OR
        (kind IN ('approaching','delayed','improved') AND (?=0 OR ?=1 OR
          ((kind<>'delayed' OR json_extract(payload_snapshot,'$.extensionSequence') IS NULL) AND revision<>?))))`)
      .bind(entryId, Number(screen), Number(disabled), entryId, Number(active), Number(activation), revision),
    env.DB.prepare(`INSERT INTO mobile_push_state(entry_id,reference_predicted_at,reference_operational_delta_ms,reference_minimum_at,
      reference_source,reference_at,reference_cycle,reference_revision,eligible_after)
      SELECT e.id,?,?,?, ?,?,e.call_cycle,?,? FROM queue_entry e
      JOIN mobile_entry_installation m ON m.entry_id=e.id WHERE e.id=?
      ON CONFLICT(entry_id) DO UPDATE SET reference_predicted_at=excluded.reference_predicted_at,
        reference_operational_delta_ms=excluded.reference_operational_delta_ms,reference_minimum_at=excluded.reference_minimum_at,
        reference_source=excluded.reference_source,reference_at=excluded.reference_at,reference_cycle=excluded.reference_cycle,
        reference_revision=excluded.reference_revision,reference_notice_id='',last_correction_accepted_at=NULL,
        last_accepted_safety_revision=NULL,eligible_after=excluded.eligible_after
      WHERE ?=1 OR ?=1 OR ?=1 OR mobile_push_state.reference_cycle<>excluded.reference_cycle OR NOT EXISTS(
        SELECT 1 FROM mobile_entry_installation m JOIN mobile_push_registration r ON r.installation_hash=m.installation_hash
        WHERE m.entry_id=excluded.entry_id AND r.enabled=1)`)
      .bind(snapshot.predictedAt, snapshot.operationalForecastDeltaMs ?? null, snapshot.customerMinimumAt ?? null,
        screen ? 'screen' : 'sync', now, revision, now, entryId, Number(screen), Number(disabled), Number(activation)),
  ]
}

/** First registration/re-enable starts at the current projection, never an old backlog.
 * Must run BEFORE the registration upsert, in the same atomic batch. Refresh and
 * token rotation leave the reference and pending events intact.
 */
export function registrationReferenceStatements(env: CloudflareBindings, owner: string, now: number) {
  const fresh = `NOT EXISTS(SELECT 1 FROM mobile_push_registration WHERE installation_hash=? AND enabled=1)`
  return [
    env.DB.prepare(`UPDATE mobile_push_outbox SET status='discarded',last_error='registration_sync'
      WHERE installation_hash=? AND status IN ('pending','sending') AND ${fresh}`).bind(owner, owner),
    env.DB.prepare(`INSERT INTO mobile_push_state(entry_id,reference_predicted_at,reference_operational_delta_ms,reference_minimum_at,
      reference_source,reference_at,reference_cycle,reference_revision,eligible_after)
      SELECT e.id,CASE WHEN p.estimator_version=2 THEN a.predicted_at
        ELSE MAX(COALESCE(p.customer_operational_at,p.predicted_at),COALESCE(p.customer_minimum_at,0)) END,
        p.operational_forecast_delta_ms,CASE WHEN p.estimator_version=2 THEN NULL ELSE p.customer_minimum_at END,
        'sync',?,e.call_cycle,COALESCE(p.revision,0),?
      FROM mobile_entry_installation m JOIN queue_entry e ON e.id=m.entry_id
      LEFT JOIN queue_projection p ON p.entry_id=e.id LEFT JOIN queue_adaptive_projection a ON a.entry_id=e.id
      WHERE m.installation_hash=? AND e.status IN ('waiting','called') AND ${fresh}
      ON CONFLICT(entry_id) DO UPDATE SET reference_predicted_at=excluded.reference_predicted_at,
        reference_operational_delta_ms=excluded.reference_operational_delta_ms,reference_minimum_at=excluded.reference_minimum_at,
        reference_source='sync',reference_at=excluded.reference_at,reference_cycle=excluded.reference_cycle,
        reference_revision=excluded.reference_revision,reference_notice_id='',last_correction_accepted_at=NULL,
        last_accepted_safety_revision=NULL,eligible_after=excluded.eligible_after`).bind(now, now, owner, owner),
  ]
}

export function acceptedPushReferenceStatement(env: CloudflareBindings, row: { id: string; entry_id: string; kind: string; call_cycle: number; revision: number }, snapshot: PushSnapshot, now: number) {
  return env.DB.prepare(`UPDATE mobile_push_state SET reference_predicted_at=?,reference_operational_delta_ms=?,reference_minimum_at=?,
    reference_source='fcm',reference_at=?,reference_cycle=?,reference_revision=?,reference_notice_id=?,
    last_correction_accepted_at=CASE WHEN ? IN ('delayed','improved') THEN ? ELSE last_correction_accepted_at END,
    last_accepted_safety_revision=CASE WHEN ?='delayed' THEN MAX(COALESCE(last_accepted_safety_revision,0),?) ELSE last_accepted_safety_revision END
    WHERE entry_id=? AND reference_at<=? AND reference_cycle<=? AND eligible_after<=?
      AND EXISTS(SELECT 1 FROM queue_entry e WHERE e.id=entry_id AND e.call_cycle=?)
      AND EXISTS(SELECT 1 FROM mobile_push_outbox n WHERE n.id=? AND n.status='accepted')`)
    .bind(snapshot.predictedAt, snapshot.operationalForecastDeltaMs ?? null, snapshot.customerMinimumAt ?? null,
      now, row.call_cycle, row.revision, row.id, row.kind, now, row.kind, snapshot.safetyRevision ?? 0,
      row.entry_id, now, row.call_cycle, now, row.call_cycle, row.id)
}
