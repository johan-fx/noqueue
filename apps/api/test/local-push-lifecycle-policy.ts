// Operator-only, never imported by the production entrypoint.
import { hmac } from '../src/features/queue/crypto'
import { parsePushSnapshot } from '../src/features/mobile/push/lifecycle'
import { currentPushSnapshot } from '../src/features/mobile/push/validity'
import { renderPushCopy } from '../src/features/mobile/push/copy'

export const lifecycleGuardSchema = [
  `CREATE TABLE local_push_lifecycle_guard (
    id INTEGER PRIMARY KEY CHECK(id=1), platform TEXT NOT NULL CHECK(platform IN ('ios','android')),
    installation_hash TEXT NOT NULL,token_hash TEXT NOT NULL,entry_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,budget INTEGER NOT NULL CHECK(budget BETWEEN 1 AND 20),
    limits TEXT NOT NULL,oauth_remaining INTEGER NOT NULL CHECK(oauth_remaining BETWEEN 0 AND 2),armed INTEGER NOT NULL CHECK(armed IN (0,1)))`,
  `CREATE TABLE local_push_lifecycle_attempt (notice_id TEXT PRIMARY KEY,kind TEXT NOT NULL,attempted_at INTEGER NOT NULL)`,
]
const project = 'nq-app-f3127', email = `noqueue-push-sender@${project}.iam.gserviceaccount.com`
type LifecycleRequest = Pick<Request, 'method' | 'url' | 'redirect' | 'text'> & { json(): Promise<unknown> }
/** Atomic budget consumed BEFORE egress; a timeout can never resend an attempt. */
export async function allowLifecycleRequest(request: LifecycleRequest, env: CloudflareBindings) {
  if (env.APP_ENV !== 'local' || env.WHATSAPP_ENABLED !== 'false' || env.FCM_PROJECT_ID !== project ||
      env.FCM_CLIENT_EMAIL !== email || request.method !== 'POST' || request.redirect !== 'manual') return false
  const now = Date.now()
  if (request.url === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(await request.text()), encoded = body.get('assertion')?.split('.')[1]
    if (body.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || !encoded) return false
    let claims
    try { claims = JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/'))) } catch { return false }
    if (claims.iss !== email || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging' || claims.aud !== request.url) return false
    return !!await env.DB.prepare(`UPDATE local_push_lifecycle_guard SET oauth_remaining=oauth_remaining-1
      WHERE id=1 AND armed=1 AND expires_at>? AND oauth_remaining>0
      AND (SELECT COUNT(*) FROM local_push_lifecycle_attempt)<budget RETURNING id`).bind(now).first()
  }
  if (request.url !== `https://fcm.googleapis.com/v1/projects/${project}/messages:send`) return false
  let body
  try { body = await request.json() as { message?: { token?: unknown; topic?: unknown; condition?: unknown;
    data?: { type?: unknown; notificationId?: unknown }; notification?: { title?: string; body?: string };
    android?: { notification?: { channel_id?: string } }; apns?: { headers?: Record<string,string>; payload?: { aps?: { alert?: { title?: string; body?: string } } } } } } } catch { return false }
  const m = body.message, id = m?.data?.notificationId
  if (!m || typeof m.token !== 'string' || m.topic !== undefined || m.condition !== undefined || m.data?.type !== 'queue-update' ||
      typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || Object.keys(m.data).some(key => !['type','notificationId'].includes(key))) return false
  const platform = m.apns ? 'ios' : 'android'
  if (platform === 'ios' ? m.android !== undefined || m.apns?.headers?.['apns-topic'] !== 'com.noqueue-app.ios'
    : m.android?.notification?.channel_id !== 'queue-updates') return false
  const row = await env.DB.prepare("SELECT entry_id,kind,call_cycle,revision,attempts,payload_snapshot FROM mobile_push_outbox WHERE id=? AND payload_version=2 AND status='sending' AND attempts=1")
    .bind(id).first<{ entry_id: string; kind: string; call_cycle: number; revision: number; attempts: number; payload_snapshot: string }>()
  if (!row) return false
  const snapshot = await currentPushSnapshot(env, row, parsePushSnapshot(row.payload_snapshot), now)
  if (!snapshot || m.notification?.title !== 'NoQueue' || m.notification.body !== renderPushCopy(snapshot)) return false
  if (platform === 'ios' && (m.apns?.payload?.aps?.alert?.body !== m.notification.body || m.apns.payload.aps.alert.title !== 'NoQueue')) return false
  const tokenHash = await hmac(env.MOBILE_PUSH_TOKEN_KEY!, `push:fcm:${m.token}`)
  return !!await env.DB.prepare(`INSERT OR IGNORE INTO local_push_lifecycle_attempt(notice_id,kind,attempted_at)
    SELECT n.id,n.kind,? FROM local_push_lifecycle_guard g
    JOIN mobile_push_outbox n ON n.entry_id=g.entry_id AND n.installation_hash=g.installation_hash
    JOIN queue_entry e ON e.id=n.entry_id JOIN mobile_push_registration r ON r.installation_hash=g.installation_hash
    WHERE g.id=1 AND g.armed=1 AND g.expires_at>? AND g.token_hash=? AND g.platform=?
      AND r.token_hash=g.token_hash AND r.platform=g.platform AND r.provider='fcm' AND r.enabled=1
      AND n.id=? AND n.status='sending' AND n.attempts=1 AND n.expires_at>? AND n.call_cycle=e.call_cycle
      AND (SELECT COUNT(*) FROM local_push_lifecycle_attempt)<g.budget
      AND (SELECT COUNT(*) FROM local_push_lifecycle_attempt a WHERE a.kind=n.kind)<COALESCE(json_extract(g.limits,'$.'||n.kind),0)
    RETURNING notice_id`).bind(now, now, tokenHash, platform, id, now).first()
}
