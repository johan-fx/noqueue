import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'
import { allowSmokeRequest, smokeGuardSchema } from './local-push-policy'
import { fixture } from './whatsapp-v4-fixture'
import { hmac } from '../src/features/queue/crypto'
import { joinQueue } from '../src/features/queue/entries'
import { runQueueCommand } from '../src/features/staff/commands'
const bindings = { ...env, MOBILE_PUSH_ENABLED: 'true', APP_ENV: 'local', WHATSAPP_ENABLED: 'false', FCM_PROJECT_ID: 'nq-app-f3127',
  FCM_CLIENT_EMAIL: 'noqueue-push-sender@nq-app-f3127.iam.gserviceaccount.com', MOBILE_PUSH_TOKEN_KEY: '44'.repeat(32) }
const endpoint = 'https://fcm.googleapis.com/v1/projects/nq-app-f3127/messages:send'
const request = (body: unknown, url = endpoint) => new Request(url, { method: 'POST', redirect: 'manual', body: JSON.stringify(body) })
beforeEach(async () => { await env.DB.exec('DROP TABLE IF EXISTS local_push_guard'); await env.DB.exec(smokeGuardSchema.replaceAll('\n', ' ')) })
async function scenario(platform: 'ios' | 'android' = 'ios') {
  const f = await fixture(), owner = crypto.randomUUID().replaceAll('-', '').repeat(2), token = 'local-test-token-' + crypto.randomUUID()
  const tokenHash = await hmac(bindings.MOBILE_PUSH_TOKEN_KEY, `push:fcm:${token}`)
  await env.DB.prepare("INSERT INTO mobile_push_registration(installation_hash,provider,token_hash,token_cipher,locale,enabled,updated_at,platform) VALUES (?,'fcm',?,'not-used','es',1,?,?)").bind(owner, tokenHash, Date.now(), platform).run()
  await joinQueue(bindings, f.queue, crypto.randomUUID(), { displayName: 'Test', partySize: 1, receptionService: 'check_in', locale: 'es', whatsapp: { consent: false } }, false, undefined, 'mobile-app', owner)
  const e = await env.DB.prepare('SELECT id FROM queue_entry WHERE queue_id=?').bind(f.queue).first<{ id: string }>()
  await runQueueCommand(bindings, f.actor, f.queue, crypto.randomUUID(), { action: 'assign_next', expectedEntryId: e!.id, expectedVersion: 0 })
  const notice = await env.DB.prepare('SELECT id FROM mobile_push_outbox WHERE entry_id=?').bind(e!.id).first<{ id: string }>()
  await env.DB.prepare("UPDATE mobile_push_outbox SET status='sending',attempts=1 WHERE id=?").bind(notice!.id).run()
  await env.DB.prepare('INSERT INTO local_push_guard VALUES (1,?,?,?,?,?,1,1,NULL,NULL)').bind(platform, owner, tokenHash, e!.id, Date.now() + 120000).run()
  const body = { message: { token, data: { type: 'queue-update', notificationId: notice!.id }, ...(platform === 'ios' ? { apns: { headers: { 'apns-topic': 'com.noqueue-app.ios' } } } : { android: { notification: { channel_id: 'queue-updates' } } }) } }
  return { body, notice: notice!.id }
}
it('denies all traffic before arming and all nonlocal environments', async () => {
  expect(await allowSmokeRequest(request({}), bindings)).toBe(false)
  expect(await allowSmokeRequest(request({}, 'https://example.com/'), bindings)).toBe(false)
  const { body } = await scenario()
  expect(await allowSmokeRequest(request(body), { ...bindings, APP_ENV: 'production' })).toBe(false)
  expect(await allowSmokeRequest(request(body), { ...bindings, WHATSAPP_ENABLED: 'true' })).toBe(false)
  expect(await allowSmokeRequest(new Request(endpoint, { method: 'POST', body: JSON.stringify(body) }), bindings)).toBe(false)
})
it('allows exactly one pinned iOS recipient attempt atomically, even concurrently', async () => {
  const { body } = await scenario()
  const results = await Promise.all([allowSmokeRequest(request(body), bindings), allowSmokeRequest(request(body), bindings)])
  expect(results.sort()).toEqual([false, true])
  expect(await allowSmokeRequest(request(body), bindings)).toBe(false)
})
it('rejects different token, topic broadcast, project, notice and APNs topic without consuming budget', async () => {
  const { body } = await scenario()
  for (const patch of [{ token: 'another-device' }, { topic: 'all' }, { condition: "'x' in topics" }, { data: { type: 'queue-update', notificationId: 'ab'.repeat(16) } }, { apns: { headers: { 'apns-topic': 'other.bundle' } } }])
    expect(await allowSmokeRequest(request({ message: { ...body.message, ...patch } }), bindings)).toBe(false)
  expect(await allowSmokeRequest(request(body, endpoint.replace('nq-app-f3127', 'other-project')), bindings)).toBe(false)
  expect(await allowSmokeRequest(request(body), bindings)).toBe(true)
})
it('rejects stale/revoked/state mismatch and expires the manual authorization', async () => {
  const { body, notice } = await scenario()
  await env.DB.prepare("UPDATE mobile_push_outbox SET kind='cancelled' WHERE id=?").bind(notice).run()
  expect(await allowSmokeRequest(request(body), bindings)).toBe(false)
  await env.DB.prepare("UPDATE mobile_push_outbox SET kind='called' WHERE id=?").bind(notice).run()
  await env.DB.prepare('UPDATE local_push_guard SET expires_at=0').run()
  expect(await allowSmokeRequest(request(body), bindings)).toBe(false)
})
it('allows one correctly scoped OAuth request only while armed', async () => {
  const url = 'https://oauth2.googleapis.com/token'
  const make = (scope = 'https://www.googleapis.com/auth/firebase.messaging') => new Request(url, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: 'header.' + btoa(JSON.stringify({ iss: bindings.FCM_CLIENT_EMAIL, aud: url, scope })) + '.signature' }) })
  expect(await allowSmokeRequest(make(), bindings)).toBe(false)
  await scenario()
  expect(await allowSmokeRequest(make('wrong-scope'), bindings)).toBe(false)
  expect(await allowSmokeRequest(make(), bindings)).toBe(true)
  expect(await allowSmokeRequest(make(), bindings)).toBe(false)
})
it.each(['ios', 'android'] as const)('accepts actual %s provider requests through MSW without real egress', async (platform) => {
  const { http, HttpResponse } = await import('msw')
  const { setupNetwork } = await import('./fake-network')
  const { sendPush } = await import('../src/features/mobile/push/provider')
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']) as CryptoKeyPair
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer)))}\n-----END PRIVATE KEY-----`
  const { body, notice } = await scenario(platform), network = setupNetwork(), allowed: boolean[] = []
  const config = { ...bindings, MOBILE_PUSH_ENABLED: 'true', FCM_IOS_ENABLED: 'true', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios', FCM_PRIVATE_KEY: pem }
  network.use(http.all('*', async ({ request }) => {
    const ok = await allowSmokeRequest(request.clone(), config); allowed.push(ok)
    if (!ok) return HttpResponse.error()
    return request.url.includes('oauth2') ? HttpResponse.json({ access_token: 'fake', expires_in: 3600 }) : HttpResponse.json({ name: 'fake-accepted' })
  }))
  try {
    expect(await sendPush(config, 'fcm', body.message.token, { id: notice, kind: 'called', locale: 'es', platform, expiresAt: Date.now() + 60000 })).toEqual({ outcome: 'accepted' })
    expect(allowed).toEqual([true, true])
  } finally { network.resetHandlers() }
})

it('pins Android platform and consumes only one concurrent delivery attempt', async () => {
  const { body } = await scenario('android')
  expect(await allowSmokeRequest(request({ message: { ...body.message, apns: { headers: { 'apns-topic': 'com.noqueue-app.ios' } } } }), bindings)).toBe(false)
  expect(await allowSmokeRequest(request({ message: { ...body.message, android: { notification: { channel_id: 'other' } } } }), bindings)).toBe(false)
  expect((await Promise.all([allowSmokeRequest(request(body), bindings), allowSmokeRequest(request(body), bindings)])).sort()).toEqual([false, true])
})
it('rejects an Android payload against an iOS-pinned registration', async () => {
  const { body } = await scenario()
  const message = { token: body.message.token, data: body.message.data }
  expect(await allowSmokeRequest(request({ message: { ...message, android: { notification: { channel_id: 'queue-updates' } } } }), bindings)).toBe(false)
  expect(await allowSmokeRequest(request(body), bindings)).toBe(true)
})
