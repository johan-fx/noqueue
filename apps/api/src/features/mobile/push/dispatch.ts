import { decryptPushToken } from '../../queue/crypto'
import { pushPlatformReady, sendPush } from './provider'
import { recalculateQueue } from '../../queue/projection'
import { acceptedPushReferenceStatement, parsePushSnapshot, type PushSnapshot } from './lifecycle'
import { currentPushSnapshot } from './validity'
import { renderPushCopy } from './copy'

/** Only called within the owning queue's serialized coordinator. */
export async function dispatchPushSerialized(env: CloudflareBindings, queueId: string, id: string, now = Date.now()) {
  if (env.MOBILE_PUSH_ENABLED !== 'true') return
  const intent = await env.DB.prepare("SELECT kind FROM mobile_push_outbox WHERE id=? AND status IN ('pending','sending') AND entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)").bind(id, queueId).first<{ kind: string }>()
  if (intent && ['approaching','delayed','improved'].includes(intent.kind)) await recalculateQueue(env, queueId, now)
  const row = await env.DB.prepare(`SELECT n.*,r.provider,r.platform,r.token_cipher,r.token_hash,r.locale,r.enabled,r.updated_at AS registered_at,
    e.status AS entry_status,e.version AS current_version,t.status AS tenant_status
    FROM mobile_push_outbox n JOIN queue_entry e ON e.id=n.entry_id
    JOIN queue q ON q.id=e.queue_id JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id
    LEFT JOIN mobile_push_registration r ON r.installation_hash=n.installation_hash
    WHERE n.id=? AND e.queue_id=? AND n.status IN ('pending','sending') AND n.next_attempt_at<=?`)
    .bind(id, queueId, now).first<{
      id: string; installation_hash: string; entry_version: number; current_version: number; kind: string;
      attempts: number; expires_at: number; provider: string | null; platform: 'ios' | 'android'; token_cipher: string | null; token_hash: string;
      locale: string; registered_at: number; enabled: number | null; entry_status: string; tenant_status: string;
      entry_id: string; payload_version: number; payload_snapshot: string | null; revision: number; call_cycle: number;
    }>()
  if (!row) return
  const update = (status: string, error: string) => env.DB.prepare('UPDATE mobile_push_outbox SET status=?,last_error=? WHERE id=?').bind(status, error, id).run()
  if (row.enabled !== 1 || row.registered_at < now - 90 * 86400000 || row.tenant_status !== 'active' || row.expires_at <= now ||
      (row.payload_version === 1 && (row.current_version !== row.entry_version || row.entry_status !== row.kind))) {
    await update('discarded', 'stale_or_unavailable'); return
  }
  let snapshot: PushSnapshot | null = null
  if (row.payload_version === 2) {
    try { snapshot = await currentPushSnapshot(env, row, parsePushSnapshot(row.payload_snapshot ?? ''), now) } catch { /* malformed snapshots fail closed */ }
    if (!snapshot) { await update('discarded', 'obsolete_snapshot'); return }
    if (snapshot.extensionSequence !== undefined && await env.DB.prepare(`SELECT 1 FROM mobile_push_outbox
      WHERE entry_id=? AND call_cycle=? AND kind='delayed' AND status IN ('pending','sending')
      AND json_extract(payload_snapshot,'$.extensionSequence')<? LIMIT 1`).bind(row.entry_id, row.call_cycle, snapshot.extensionSequence).first()) return
    if (row.attempts === 0) await env.DB.prepare('UPDATE mobile_push_outbox SET payload_snapshot=? WHERE id=? AND attempts=0').bind(JSON.stringify(snapshot), id).run()
  }
  if (row.attempts >= 5) { await update('failed', 'attempt_limit'); return }
  // Legacy APNs tokens cannot be sent to FCM or silently reinterpreted.
  if (row.provider !== 'fcm' || !pushPlatformReady(env, row.platform)) return
  // Lease persists across process loss; same coordinator serializes state transitions and sends.
  await env.DB.prepare("UPDATE mobile_push_outbox SET status='sending',attempts=attempts+1,next_attempt_at=? WHERE id=?")
    .bind(now + 60000, id).run()
  let result: Awaited<ReturnType<typeof sendPush>>
  try {
    const token = await decryptPushToken(env.MOBILE_PUSH_TOKEN_KEY!, row.token_cipher!)
    result = await sendPush(env, row.provider, token, { id, kind: row.kind, locale: snapshot?.locale ?? row.locale, platform: row.platform, expiresAt: row.expires_at,
      ...(snapshot ? { body: renderPushCopy(snapshot) } : {}) }, now)
  } catch { result = { outcome: 'failed' } }
  if (result.outcome === 'invalid_token') {
    // Conditional deletion prevents an old provider response from deleting a rotated token.
    await env.DB.prepare('DELETE FROM mobile_push_registration WHERE installation_hash=? AND token_hash=?').bind(row.installation_hash, row.token_hash).run()
  }
  const next = now + Math.max(result.retryAfterMs ?? 0, Math.min(600000, 60000 * 2 ** row.attempts))
  const status = result.outcome === 'accepted' ? 'accepted' : result.outcome === 'retry' && row.attempts < 4 && next < row.expires_at ? 'pending' : 'failed'
  await env.DB.batch([
    env.DB.prepare("UPDATE mobile_push_outbox SET status=?,next_attempt_at=?,accepted_at=?,last_error=? WHERE id=? AND status='sending'")
      .bind(status, next, result.outcome === 'accepted' ? now : null, result.outcome === 'accepted' ? null : result.outcome, id),
    ...(result.outcome === 'accepted' && snapshot?.predictedAt != null ? [acceptedPushReferenceStatement(env, row, snapshot, now)] : []),
  ])
}
export async function dispatchQueuePush(env: CloudflareBindings, queueId?: string) {
  if (env.MOBILE_PUSH_ENABLED !== 'true') return
  const rows = await env.DB.prepare(`SELECT n.id,e.queue_id FROM mobile_push_outbox n JOIN queue_entry e ON e.id=n.entry_id
    WHERE n.status IN ('pending','sending') AND n.next_attempt_at<=? ${queueId ? 'AND e.queue_id=?' : ''} ORDER BY n.next_attempt_at LIMIT 25`)
    .bind(Date.now(), ...(queueId ? [queueId] : [])).all<{ id: string; queue_id: string }>()
  for (const row of rows.results) {
    try {
      await (env.APP_ENV === 'local' ? env.QUEUE_COORDINATOR : env.QUEUE_COORDINATOR.jurisdiction('eu')).getByName(row.queue_id).dispatchPush(row.queue_id, row.id)
    } catch { console.error('mobile_push_dispatch_failed') }
  }
}

/** Bounded maintenance: registration refreshed on app resume, notice hints retained 30 days. */
export async function cleanupPush(env: CloudflareBindings, now = Date.now()) {
  if (env.MOBILE_PUSH_ENABLED !== 'true') return
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mobile_push_registration WHERE installation_hash IN (SELECT installation_hash FROM mobile_push_registration WHERE updated_at<? LIMIT 100)').bind(now - 90 * 86400000),
    env.DB.prepare('DELETE FROM mobile_push_outbox WHERE id IN (SELECT id FROM mobile_push_outbox WHERE created_at<? LIMIT 100)').bind(now - 30 * 86400000),
  ])
}
