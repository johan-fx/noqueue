import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { privacyConsentSchema, privacyOrigins } from '@noqueue/contracts/privacy'

export const privacyRoutes = new Hono<{ Bindings: CloudflareBindings }>()

privacyRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Vary', 'Origin')
  // Never let a staging API receive production consent, even with copied frontend config.
  if (c.env.APP_ENV !== 'production' || c.env.PUBLIC_APP_ORIGIN !== privacyOrigins[1])
    return c.body(null, 404)
  const origin = c.req.header('Origin')
  if (!privacyOrigins.some((allowed) => allowed === origin)) return c.body(null, 403)
  c.header('Access-Control-Allow-Origin', origin!)
  await next()
})
privacyRoutes.options('/consents', (c) => {
  if (c.req.header('Access-Control-Request-Method') !== 'POST') return c.body(null, 403)
  const headers = c.req.header('Access-Control-Request-Headers')?.toLowerCase().split(',').map((s) => s.trim()) ?? []
  if (headers.some((h) => h !== 'content-type')) return c.body(null, 403)
  c.header('Access-Control-Allow-Methods', 'POST')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
  c.header('Access-Control-Max-Age', '600')
  return c.body(null, 204)
})
privacyRoutes.post('/consents', bodyLimit({ maxSize: 1024, onError: (c) => c.body(null, 413) }), async (c) => {
  if (c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json') return c.body(null, 415)
  const parsed = privacyConsentSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.body(null, 400)
  const input = parsed.data
  const origin = c.req.header('Origin')!
  const existing = await c.env.DB.prepare('SELECT * FROM privacy_consent_receipt WHERE decision_id=?')
    .bind(input.decisionId).first<{consent_id: string; origin: string; revision: number; locale: string; analytics: number}>()
  const matches = (row: NonNullable<typeof existing>) => row.consent_id === input.consentId && row.origin === origin && row.revision === input.revision && row.locale === input.locale && row.analytics === Number(input.analytics)
  if (existing) return c.body(null, matches(existing) ? 204 : 409)
  // No IP, UA or request URL is persisted. Global budget bounds writes by rotating IDs.
  const now = Date.now(), minute = Math.floor(now / 60000)
  for (const [key, limit] of [[`all:${minute}`, 600], [`${input.consentId}:${minute}`, 10]] as const) {
    const row = await c.env.DB.prepare(`INSERT INTO privacy_consent_limit(key,count,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key, now + 120000).first<{count: number}>()
    if (!row || row.count > limit) {
      c.header('Retry-After', '60')
      return c.body(null, 429)
    }
  }
  await c.env.DB.prepare(`INSERT INTO privacy_consent_receipt
    (decision_id,consent_id,origin,revision,locale,analytics,received_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(decision_id) DO NOTHING`)
    .bind(input.decisionId, input.consentId, origin, input.revision, input.locale, Number(input.analytics), now).run()
  // A concurrent request must not turn a conflicting payload into an acknowledgement.
  const stored = await c.env.DB.prepare('SELECT * FROM privacy_consent_receipt WHERE decision_id=?').bind(input.decisionId).first<NonNullable<typeof existing>>()
  return c.body(null, stored && matches(stored) ? 204 : 409)
})

export async function cleanupPrivacyLimits(env: Pick<CloudflareBindings, 'DB'>, now = Date.now()) {
  // Every 15 minutes, with a budget greater than the maximum admitted requests per interval.
  for (let batch = 0; batch < 20; batch++) {
    const result = await env.DB.prepare(`DELETE FROM privacy_consent_limit WHERE key IN
      (SELECT key FROM privacy_consent_limit WHERE expires_at < ? ORDER BY expires_at LIMIT 2000)`).bind(now).run()
    if (result.meta.changes < 2000) return
  }
  console.error('privacy_rate_cleanup_backlog')
}
export async function cleanupPrivacyConsents(env: Pick<CloudflareBindings, 'DB'>, now = Date.now()) {
  const cutoff = new Date(now)
  // Clamp month-end rather than rolling e.g. September 31 into October.
  const day = cutoff.getUTCDate()
  cutoff.setUTCDate(1)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 13)
  const end = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate()
  cutoff.setUTCDate(Math.min(day, end))
  // Indexed, bounded transactions. Daily budget exceeds the API's 864k/day admission ceiling.
  for (let batch = 0; batch < 900; batch++) {
    const result = await env.DB.prepare(`DELETE FROM privacy_consent_receipt WHERE decision_id IN
      (SELECT decision_id FROM privacy_consent_receipt WHERE received_at < ? ORDER BY received_at LIMIT 1000)`).bind(cutoff.getTime()).run()
    if (result.meta.changes < 1000) return
  }
  console.error('privacy_receipt_cleanup_backlog')
}
