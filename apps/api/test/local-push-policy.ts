// Operator-only smoke policy. Not imported by production or deterministic harnesses.
import { hmac } from '../src/features/queue/crypto'

export const smokeGuardSchema = `CREATE TABLE local_push_guard (
  id INTEGER PRIMARY KEY CHECK(id=1), installation_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL, entry_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
  remaining INTEGER NOT NULL CHECK(remaining IN (0,1)), oauth_remaining INTEGER NOT NULL,
  notice_id TEXT, attempted_at INTEGER
)`
const project = 'nq-app-f3127'
type SmokeRequest = Pick<Request, 'method' | 'url' | 'redirect' | 'text'> & { json(): Promise<unknown> }
export async function allowSmokeRequest(request: SmokeRequest, env: CloudflareBindings) {
  if (env.APP_ENV !== 'local' || env.WHATSAPP_ENABLED !== 'false' || env.FCM_PROJECT_ID !== project ||
      env.FCM_CLIENT_EMAIL !== `noqueue-push-sender@${project}.iam.gserviceaccount.com` ||
      request.method !== 'POST' || request.redirect !== 'manual') return false
  const now = Date.now()
  if (request.url === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(await request.text())
    if (body.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return false
    const claim = body.get('assertion')?.split('.')[1]
    if (!claim) return false
    let claims
    try { claims = JSON.parse(atob(claim.replaceAll('-', '+').replaceAll('_', '/'))) } catch { return false }
    if (claims.iss !== env.FCM_CLIENT_EMAIL || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging' || claims.aud !== request.url) return false
    return !!await env.DB.prepare(`UPDATE local_push_guard SET oauth_remaining=oauth_remaining-1
      WHERE id=1 AND remaining=1 AND oauth_remaining>0 AND expires_at>? RETURNING id`).bind(now).first()
  }
  if (request.url !== `https://fcm.googleapis.com/v1/projects/${project}/messages:send`) return false
  let body
  try { body = await request.json() as { message?: { token?: unknown; topic?: unknown; condition?: unknown; data?: { type?: unknown; notificationId?: unknown }; apns?: { headers?: Record<string, string> } } } } catch { return false }
  const message = body.message, id = message?.data?.notificationId
  if (!message || typeof message.token !== 'string' || message.topic !== undefined || message.condition !== undefined ||
      message.data?.type !== 'queue-update' || typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) ||
      message.apns?.headers?.['apns-topic'] !== 'com.noqueue-app.ios') return false
  const tokenHash = await hmac(env.MOBILE_PUSH_TOKEN_KEY!, `push:fcm:${message.token}`)
  // Atomic consumption BEFORE egress. No automatic resend even on timeout.
  // Match actual outbox, registration, owner, version and live state, not just a token.
  return !!await env.DB.prepare(`UPDATE local_push_guard SET remaining=0,notice_id=?,attempted_at=?
    WHERE id=1 AND remaining=1 AND expires_at>? AND token_hash=? AND EXISTS (
      SELECT 1 FROM mobile_push_outbox n JOIN queue_entry e ON e.id=n.entry_id
      JOIN mobile_push_registration r ON r.installation_hash=n.installation_hash
      WHERE n.id=? AND n.entry_id=local_push_guard.entry_id
      AND n.installation_hash=local_push_guard.installation_hash AND r.token_hash=local_push_guard.token_hash
      AND r.platform='ios' AND r.provider='fcm' AND r.enabled=1 AND n.kind='called'
      AND n.status='sending' AND n.attempts=1 AND n.expires_at>? AND e.status='called' AND e.version=n.entry_version
    ) RETURNING id`).bind(id, now, now, tokenHash, id, now).first()
}
