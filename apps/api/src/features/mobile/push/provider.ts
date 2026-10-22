import { z } from 'zod'

export type PushMessage = { id: string; kind: string; locale: string; expiresAt: number; platform?: 'ios' | 'android'; body?: string }
export type PushResult = { outcome: 'accepted' | 'retry' | 'invalid_token' | 'failed'; retryAfterMs?: number }
const encoder = new TextEncoder()
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const json64 = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)))
const cache = new Map<string, { value: string; expires: number }>()
async function jwt(pem: string, header: object, claims: object, ec: boolean) {
  const bytes = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', bytes, ec ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const unsigned = `${json64(header)}.${json64(claims)}`
  const signature = await crypto.subtle.sign(ec ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned))
  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}
async function post(url: string, headers: Record<string, string>, body: string) {
  return fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(10000) })
}
function retryAfter(response: Response, now: number) {
  const value = response.headers.get('retry-after')
  if (!value) return 60000
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(ms) ? Math.max(60000, Math.min(86400000, ms)) : 60000
}
export function pushProviderReady(env: CloudflareBindings, provider: string) {
  if (env.MOBILE_PUSH_ENABLED !== 'true' || !env.MOBILE_PUSH_TOKEN_KEY) return false
  if (provider !== 'apns' && provider !== 'fcm') return false
  // Credentials are not evidence of HTTP/2 support. This operational attestation
  // is scoped to the configured runtime/environment, never inferred from mocks
  // or the operator's Node.js probe. Keep iOS closed while Android is configured.
  if (provider === 'apns' && env.APNS_TRANSPORT_VERIFIED !== 'true') return false
  return provider === 'apns'
    ? !!env.APNS_PRIVATE_KEY && /^[A-Z0-9]{10}$/.test(env.APNS_KEY_ID ?? '') && /^[A-Z0-9]{10}$/.test(env.APNS_TEAM_ID ?? '') && /^[a-zA-Z0-9.-]+$/.test(env.APNS_TOPIC ?? '') && ['sandbox', 'production'].includes(env.APNS_ENVIRONMENT ?? '')
    : !!env.FCM_PRIVATE_KEY && /^[a-z0-9-]+$/.test(env.FCM_PROJECT_ID ?? '') && /^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(env.FCM_CLIENT_EMAIL ?? '')
}
/** iOS FCM is a separate rollout, never enabled just by configuring Android. */
export function pushPlatformReady(env: CloudflareBindings, platform: string) {
  if (platform !== 'ios' && platform !== 'android') return false
  return pushProviderReady(env, 'fcm') && (platform === 'android' ||
    (env.FCM_IOS_ENABLED === 'true' && env.FCM_IOS_BUNDLE_ID === 'com.noqueue-app.ios'))
}
async function authorization(env: CloudflareBindings, provider: string, now: number) {
  const key = provider === 'apns' ? `${env.APNS_KEY_ID}:${env.APNS_TEAM_ID}:${env.APNS_PRIVATE_KEY}` : `${env.FCM_CLIENT_EMAIL}:${env.FCM_PRIVATE_KEY}`
  const cached = cache.get(key)
  if (cached && cached.expires > now) return cached.value
  const seconds = Math.floor(now / 1000)
  let value: string, expires: number
  if (provider === 'apns') {
    value = await jwt(env.APNS_PRIVATE_KEY!, { alg: 'ES256', kid: env.APNS_KEY_ID }, { iss: env.APNS_TEAM_ID, iat: seconds }, true)
    expires = now + 50 * 60000
  } else {
    const assertion = await jwt(env.FCM_PRIVATE_KEY!, { alg: 'RS256', typ: 'JWT' }, {
      iss: env.FCM_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: seconds, exp: seconds + 3600,
    }, false)
    const response = await post('https://oauth2.googleapis.com/token', { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString())
    if (!response.ok) throw new Error('push_auth_failed')
    const auth = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).parse(await response.json())
    value = auth.access_token
    expires = now + Math.max(0, Math.min(3300, auth.expires_in - 60)) * 1000
  }
  // Bounded process-local cache; never logged or persisted.
  if (cache.size > 8) cache.clear()
  cache.set(key, { value, expires })
  return value
}
/** Provider acceptance is NOT delivery or human reading. Never include private turn URLs. */
export async function sendPush(env: CloudflareBindings, provider: string, token: string, message: PushMessage, now = Date.now()): Promise<PushResult> {
  if (!pushProviderReady(env, provider) || (provider === 'fcm' && !pushPlatformReady(env, message.platform ?? 'android'))) return { outcome: 'retry' }
  try {
    const auth = await authorization(env, provider, now)
    if (message.expiresAt <= Date.now()) return { outcome: 'failed' }
    const en = message.locale === 'en'
    const body = message.body ?? (message.kind === 'called'
      ? en ? 'It is your turn. Open NoQueue to see the current status.' : 'Es tu turno. Abre NoQueue para consultar el estado actual.'
      : en ? 'Your turn has changed. Open NoQueue to see the current status.' : 'Tu turno ha cambiado. Abre NoQueue para consultar el estado actual.')
    const data = { type: 'queue-update', notificationId: message.id }
    const response = provider === 'apns'
      ? await post(`https://${env.APNS_ENVIRONMENT === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'}/3/device/${token}`, {
        Authorization: `bearer ${auth}`, 'Content-Type': 'application/json', 'apns-topic': env.APNS_TOPIC!,
        'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(message.expiresAt / 1000)), 'apns-collapse-id': message.id,
      }, JSON.stringify({ aps: { alert: { title: 'NoQueue', body }, sound: 'default' }, ...data }))
      : await post(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
        Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json',
      }, JSON.stringify({ message: { token, notification: { title: 'NoQueue', body }, data,
        ...(message.platform === 'ios' ? { apns: { headers: {
          'apns-topic': env.FCM_IOS_BUNDLE_ID!, 'apns-push-type': 'alert', 'apns-priority': '10',
          'apns-expiration': String(Math.floor(message.expiresAt / 1000)), 'apns-collapse-id': message.id,
        }, payload: { aps: { alert: { title: 'NoQueue', body }, sound: 'default' } } } } : { android: { priority: 'high', ttl: `${Math.max(0, Math.floor((message.expiresAt - now) / 1000))}s`, notification: { channel_id: 'queue-updates', tag: message.id } } }),
      } }))
    if (response.ok) return { outcome: 'accepted' }
    const payload = await response.json().catch(() => ({})) as { reason?: string; error?: { details?: { errorCode?: string }[] } }
    // Do not revoke tokens on credentials/configuration failures (403 or INVALID_ARGUMENT).
    if (provider === 'apns' ? payload.reason === 'Unregistered' : payload.error?.details?.some(d => d.errorCode === 'UNREGISTERED'))
      return { outcome: 'invalid_token' }
    if (response.status === 429 || response.status >= 500) return { outcome: 'retry', retryAfterMs: retryAfter(response, now) }
    return { outcome: 'failed' }
  } catch {
    // Includes ambiguous timeouts: retry with stable notification ID; exactly-once delivery is not guaranteed.
    return { outcome: 'retry' }
  }
}
