import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'
import { app } from '../../app'
import { cleanupPrivacyConsents, cleanupPrivacyLimits } from './routes'
const origin = 'https://app.noqueue-app.com'
const bindings = { ...env, APP_ENV: 'production', PUBLIC_APP_ORIGIN: origin }
const decision = () => ({ decisionId: crypto.randomUUID(), consentId: crypto.randomUUID(), revision: 1, locale: 'es', analytics: true })
const send = (body: unknown, requestOrigin = origin, overrides: RequestInit = {}) => app.request('/api/v1/privacy/consents', {
  method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...overrides,
}, bindings)
beforeEach(async () => { await env.DB.batch([env.DB.prepare('DELETE FROM privacy_consent_receipt'), env.DB.prepare('DELETE FROM privacy_consent_limit')]) })
it('persists only the strict receipt and server origin/time, idempotently', async () => {
  const body = decision(), before = Date.now()
  const response = await send(body)
  expect(response.status).toBe(204); expect(response.headers.get('access-control-allow-origin')).toBe(origin)
  expect(response.headers.has('access-control-allow-credentials')).toBe(false)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect((await send(body)).status).toBe(204)
  const rows = await env.DB.prepare('SELECT * FROM privacy_consent_receipt').all()
  expect(rows.results).toHaveLength(1)
  expect(rows.results[0]).toEqual({ decision_id: body.decisionId, consent_id: body.consentId, revision: 1, locale: 'es', analytics: 1, origin, received_at: expect.any(Number) })
  expect(Number(rows.results[0]!.received_at)).toBeGreaterThanOrEqual(before)
  expect((await send({ ...body, analytics: false })).status).toBe(409)
  expect((await send(body, 'https://noqueue-app.com')).status).toBe(409)
})
it('rejects unknown fields, invalid values, oversized and non-JSON bodies', async () => {
  for (const patch of [{ token: 'secret' }, { url: 'https://test' }, { ip: '127.0.0.1' }, { revision: 2 }, { analytics: 'true' }, { locale: 'fr' }, { decisionId: 'bad' }]) expect((await send({ ...decision(), ...patch })).status).toBe(400)
  expect((await send({ ...decision(), junk: 'a'.repeat(1500) })).status).toBe(413)
  expect((await send(decision(), origin, { headers: { Origin: origin, 'Content-Type': 'text/plain' } })).status).toBe(415)
  expect((await send(decision(), origin, { body: '{' })).status).toBe(400)
})
it('restricts CORS and refuses non-production deployments', async () => {
  for (const host of ['https://staging.noqueue-app.com', 'https://evil.test', 'null', '']) expect((await send(decision(), host)).status).toBe(403)
  expect((await send(decision(), 'https://noqueue-app.com')).status).toBe(204)
  const preflight = await app.request('/api/v1/privacy/consents', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }, bindings)
  expect(preflight.status).toBe(204); expect(preflight.headers.has('access-control-allow-credentials')).toBe(false)
  const blocked = await app.request('/api/v1/privacy/consents', { method: 'POST', headers: { Origin: origin } }, { ...bindings, APP_ENV: 'staging' })
  expect(blocked.status).toBe(404)
})
it('bounds decisions without storing IP and permits idempotent retries at the limit', async () => {
  const body = decision()
  for (let i = 0; i < 10; i++) expect((await send({ ...body, decisionId: crypto.randomUUID() })).status).toBe(204)
  expect((await send(body)).status).toBe(429)
  const row = await env.DB.prepare('SELECT decision_id FROM privacy_consent_receipt LIMIT 1').first<{ decision_id: string }>()
  expect((await send({ ...body, decisionId: row!.decision_id })).status).toBe(204)
})
it('retains 13 calendar months and cleans transient budgets separately', async () => {
  const body = decision(); await send(body)
  const now = Date.UTC(2026, 9, 16), cutoff = Date.UTC(2025, 8, 16)
  await env.DB.prepare('UPDATE privacy_consent_receipt SET received_at=?').bind(cutoff - 1).run()
  await cleanupPrivacyConsents(env, now)
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM privacy_consent_receipt').first<{ n: number }>())!.n).toBe(0)
  await send({ ...body, decisionId: crypto.randomUUID() })
  await env.DB.prepare('UPDATE privacy_consent_receipt SET received_at=?').bind(cutoff).run()
  await cleanupPrivacyConsents(env, now)
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM privacy_consent_receipt').first<{ n: number }>())!.n).toBe(1)
  await cleanupPrivacyLimits(env, Date.now() + 180000)
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM privacy_consent_limit').first<{ n: number }>())!.n).toBe(0)
})
it('handles concurrent duplicates/conflicts and enforces aggregate admission', async () => {
  const body = decision()
  const duplicates = await Promise.all([send(body), send(body)])
  expect(duplicates.map((r) => r.status)).toEqual([204, 204])
  const conflict = decision()
  const statuses = (await Promise.all([send(conflict), send({ ...conflict, analytics: false })])).map((r) => r.status).sort()
  expect(statuses).toEqual([204, 409])
  await env.DB.prepare('UPDATE privacy_consent_limit SET count=600 WHERE key LIKE ?').bind('all:%').run()
  expect((await send(decision())).status).toBe(429)
  expect((await send(body)).status).toBe(204)
})
it('rejects arbitrary preflight methods and headers', async () => {
  for (const [method, header] of [['DELETE', 'content-type'], ['POST', 'authorization']]) {
    const response = await app.request('/api/v1/privacy/consents', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method!, 'Access-Control-Request-Headers': header! } }, bindings)
    expect(response.status).toBe(403)
  }
})
it('cleans more than one indexed batch and clamps the 13-month cutoff at month end', async () => {
  const now = Date.UTC(2026, 9, 31), cutoff = Date.UTC(2025, 8, 30)
  await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1001)
    INSERT INTO privacy_consent_receipt (decision_id,consent_id,origin,revision,locale,analytics,received_at)
    SELECT 'expired-'||x,'consent',?,1,'es',0,? FROM n`).bind(origin, cutoff - 1).run()
  const body = decision(); await send(body)
  await env.DB.prepare('UPDATE privacy_consent_receipt SET received_at=? WHERE decision_id=?').bind(cutoff, body.decisionId).run()
  await cleanupPrivacyConsents(env, now)
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM privacy_consent_receipt').first<{ n: number }>())!.n).toBe(1)
})
