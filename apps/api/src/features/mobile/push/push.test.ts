import { env } from 'cloudflare:workers'
import { beforeEach, expect, it, vi } from 'vitest'
import { app } from '../../../app'
import { fixture } from '../../../../test/whatsapp-v4-fixture'
import { hash, decryptPushToken } from '../../queue/crypto'
import { joinQueue } from '../../queue/entries'
import { runQueueCommand } from '../../staff/commands'
import { expireArrivals } from '../../queue/customer'
import { dispatchPushSerialized } from './dispatch'
import * as provider from './provider'
const bindings = { ...env, MOBILE_PUSH_ENABLED: 'true', MOBILE_PUSH_TOKEN_KEY: '44'.repeat(32), FCM_PRIVATE_KEY: 'test-only', FCM_CLIENT_EMAIL: 'test@test.iam.gserviceaccount.com', FCM_PROJECT_ID: 'test-project' }
let identity: string, ip: string
beforeEach(() => { identity = crypto.randomUUID().replaceAll('-', '').repeat(2); ip = crypto.randomUUID(); vi.restoreAllMocks() })
function request(route: string, body?: unknown, owner = identity, enabled = true) {
  return app.request('https://test.invalid/api/v1/mobile/push' + route, {
    headers: { Origin: 'capacitor://localhost', Authorization: `Bearer ${owner}`, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  }, enabled ? bindings : { ...bindings, MOBILE_PUSH_ENABLED: 'false' })
}
const token = () => 'FCM-token-' + crypto.randomUUID()
const register = (value = token(), owner = identity) => request('/registration', { platform: 'android', token: value, locale: 'es' }, owner)
async function scenario() {
  const f = await fixture(), installation = await hash(`mobile-installation:v1:${identity}`)
  expect((await register()).status).toBe(200)
  await joinQueue(bindings, f.queue, crypto.randomUUID(), { displayName: 'Test', partySize: 1, receptionService: 'check_in', locale: 'es', whatsapp: { consent: false } }, false, undefined, 'mobile-app', installation)
  const e = await env.DB.prepare('SELECT id FROM queue_entry WHERE queue_id=?').bind(f.queue).first<{ id: string }>()
  await runQueueCommand(bindings, f.actor, f.queue, crypto.randomUUID(), { action: 'assign_next', expectedEntryId: e!.id, expectedVersion: 0 })
  const notice = await env.DB.prepare('SELECT id FROM mobile_push_outbox WHERE entry_id=?').bind(e!.id).first<{ id: string }>()
  return { ...f, entry: e!.id, notice: notice!.id, installation }
}
it('is OFF by default, bounds strict input and requires installation identity', async () => {
  expect((await request('/registration', { platform: 'android', token: token(), locale: 'es' }, identity, false)).status).toBe(503)
  expect((await request('/registration', undefined, '')).status).toBe(401)
  expect((await request('/registration', { platform: 'ios', token: 'not-apns', locale: 'es' })).status).toBe(400)
  expect((await request('/registration', { platform: 'android', token: token(), locale: 'es', installation: 'injected' })).status).toBe(400)
})
it('encrypts tokens and rotates only the owner, forbidding cross-installation token takeover', async () => {
  const first = token(), second = token()
  expect((await register(first)).status).toBe(200)
  expect((await register(first, 'ab'.repeat(32))).status).toBe(409)
  expect((await register(second)).status).toBe(200)
  const row = await env.DB.prepare('SELECT * FROM mobile_push_registration WHERE installation_hash=?').bind(await hash(`mobile-installation:v1:${identity}`)).first<{ token_cipher: string; token_hash: string }>()
  expect(JSON.stringify(row)).not.toContain(second)
  expect(await decryptPushToken(bindings.MOBILE_PUSH_TOKEN_KEY, row!.token_cipher)).toBe(second)
  expect(await (await request('/registration')).json()).toMatchObject({ available: true, enabled: true })
})

it('reports iOS unavailable and rejects its registration until transport is verified, independent of FCM', async () => {
  const configured = { ...bindings, APNS_PRIVATE_KEY: 'test-only', APNS_KEY_ID: 'ABC1234567', APNS_TEAM_ID: 'DEF1234567', APNS_TOPIC: 'com.noqueue-app.ios', APNS_ENVIRONMENT: 'sandbox' }
  const headers = { Origin: 'capacitor://localhost', Authorization: `Bearer ${identity}`, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }
  const status = await app.request('https://test.invalid/api/v1/mobile/push/registration', { headers }, configured)
  expect(await status.json()).toMatchObject({ providers: { ios: false, android: true } })
  const result = await app.request('https://test.invalid/api/v1/mobile/push/registration', { headers, method: 'POST', body: JSON.stringify({ platform: 'ios', provider: 'fcm', token: 'MiXeD-token-01234567890123456789', locale: 'es' }) }, configured)
  expect(result.status).toBe(503)
  expect(await env.DB.prepare('SELECT 1 FROM mobile_push_registration WHERE installation_hash=?').bind(await hash(`mobile-installation:v1:${identity}`)).first()).toBeNull()
})

it('does not consume attempts or delete an existing APNs token when transport is unverified', async () => {
  const f = await scenario(), send = vi.spyOn(provider, 'sendPush')
  await env.DB.prepare("UPDATE mobile_push_registration SET provider='apns' WHERE installation_hash=?").bind(f.installation).run()
  await dispatchPushSerialized({ ...bindings, APNS_PRIVATE_KEY: 'test-only', APNS_KEY_ID: 'ABC1234567', APNS_TEAM_ID: 'DEF1234567', APNS_TOPIC: 'com.noqueue-app.ios', APNS_ENVIRONMENT: 'sandbox' }, f.queue, f.notice)
  expect(send).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT status,attempts FROM mobile_push_outbox WHERE id=?').bind(f.notice).first()).toEqual({ status: 'pending', attempts: 0 })
  expect(await env.DB.prepare('SELECT enabled FROM mobile_push_registration WHERE installation_hash=?').bind(f.installation).first()).toEqual({ enabled: 1 })
})
it('commits independent deduplicated outbox without phone/WA; resolves known notice only to owner, including ended turns', async () => {
  const f = await scenario()
  expect(await env.DB.prepare('SELECT count(*) AS n FROM mobile_push_outbox WHERE entry_id=?').bind(f.entry).first()).toEqual({ n: 1 })
  for (const table of ['notification_outbox', 'queue_entry_contact', 'consent']) expect(await env.DB.prepare(`SELECT 1 FROM ${table} WHERE entry_id=?`).bind(f.entry).first()).toBeNull()
  expect((await request('/notices/' + f.notice, undefined, 'ab'.repeat(32))).status).toBe(404)
  const own = await (await request('/notices/' + f.notice)).json()
  await runQueueCommand(bindings, f.actor, f.queue, crypto.randomUUID(), { action: 'complete', entryId: f.entry, version: 1 })
  expect(await (await request('/notices/' + f.notice)).json()).toEqual(own)
  expect(own).toMatchObject({ recoveryToken: expect.stringMatching(/^[a-f0-9]{64}$/), locale: 'es' })
})
it('sends once on provider acceptance; contextual copy never contains capabilities, identity or personal names', async () => {
  const f = await scenario(), send = vi.spyOn(provider, 'sendPush').mockResolvedValue({ outcome: 'accepted' })
  await dispatchPushSerialized(bindings, f.queue, f.notice)
  await dispatchPushSerialized(bindings, f.queue, f.notice)
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]![3]).toEqual({ id: f.notice, kind: 'called', locale: 'es', platform: 'android', expiresAt: expect.any(Number), body: expect.stringContaining('Example venue') })
  expect(JSON.stringify(send.mock.calls[0]![3])).not.toContain(identity)
  expect(send.mock.calls[0]![3].body).not.toContain('Test')
  expect(await env.DB.prepare('SELECT status,attempts FROM mobile_push_outbox WHERE id=?').bind(f.notice).first()).toEqual({ status: 'accepted', attempts: 1 })
})
it('discards a called alert after completion, tenant suspension, or TTL expiry without sending', async () => {
  const f = await scenario(), send = vi.spyOn(provider, 'sendPush')
  await runQueueCommand(bindings, f.actor, f.queue, crypto.randomUUID(), { action: 'complete', entryId: f.entry, version: 1 })
  await dispatchPushSerialized(bindings, f.queue, f.notice)
  expect(send).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT status FROM mobile_push_outbox WHERE id=?').bind(f.notice).first()).toEqual({ status: 'discarded' })
})
it('creates expiry notification through real maintenance, discarding the old called notification', async () => {
  const f = await scenario(), send = vi.spyOn(provider, 'sendPush').mockResolvedValue({ outcome: 'accepted' })
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60000)
  await expireArrivals(bindings, f.queue, Date.now())
  const rows = await env.DB.prepare('SELECT id,kind FROM mobile_push_outbox WHERE entry_id=? ORDER BY entry_version').bind(f.entry).all<{ id: string; kind: string }>()
  expect(rows.results.map(r => r.kind)).toEqual(['called', 'expired'])
  for (const n of rows.results) await dispatchPushSerialized(bindings, f.queue, n.id)
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]![3].kind).toBe('expired')
})
it('retries with stable ID/backoff without duplicates; revocation deletes token and prevents new sends', async () => {
  const f = await scenario(), send = vi.spyOn(provider, 'sendPush').mockResolvedValue({ outcome: 'retry', retryAfterMs: 60000 })
  await dispatchPushSerialized(bindings, f.queue, f.notice)
  await dispatchPushSerialized(bindings, f.queue, f.notice)
  expect(send).toHaveBeenCalledTimes(1)
  const row = await env.DB.prepare('SELECT next_attempt_at FROM mobile_push_outbox WHERE id=?').bind(f.notice).first<{ next_attempt_at: number }>()
  send.mockResolvedValue({ outcome: 'accepted' })
  await dispatchPushSerialized(bindings, f.queue, f.notice, row!.next_attempt_at)
  expect(send).toHaveBeenCalledTimes(2)
  expect((await request('/revoke', {})).status).toBe(200)
  expect(await env.DB.prepare('SELECT 1 FROM mobile_push_registration WHERE installation_hash=?').bind(f.installation).first()).toBeNull()
  expect(await (await request('/registration')).json()).toMatchObject({ available: true, enabled: false })
})
it('invalid provider tokens are deleted but cannot delete a concurrently rotated token', async () => {
  const f = await scenario()
  vi.spyOn(provider, 'sendPush').mockImplementation(async () => { await register(); return { outcome: 'invalid_token' } })
  await dispatchPushSerialized(bindings, f.queue, f.notice)
  expect(await (await request('/registration')).json()).toMatchObject({ enabled: true })
})
it.each(['expiredTTL', 'suspendedTenant', 'revoked', 'noCredentials'] as const)('does not send for %s', async reason => {
  const f = await scenario(), send = vi.spyOn(provider, 'sendPush')
  if (reason === 'suspendedTenant') await env.DB.prepare("UPDATE tenant_account SET status='suspended' WHERE organization_id=(SELECT organization_id FROM venue WHERE id=(SELECT venue_id FROM queue WHERE id=?))").bind(f.queue).run()
  if (reason === 'revoked') await request('/revoke', {})
  await dispatchPushSerialized(reason === 'noCredentials' ? { ...bindings, FCM_PRIVATE_KEY: '' } : bindings, f.queue, f.notice, Date.now() + (reason === 'expiredTTL' ? 600000 : 0))
  expect(send).not.toHaveBeenCalled()
})
it('deletes definitively invalid tokens and keeps revoked notices resolvable only by owner', async () => {
  const f = await scenario(); vi.spyOn(provider, 'sendPush').mockResolvedValue({ outcome: 'invalid_token' })
  await dispatchPushSerialized(bindings, f.queue, f.notice)
  expect(await env.DB.prepare('SELECT 1 FROM mobile_push_registration WHERE installation_hash=?').bind(f.installation).first()).toBeNull()
  expect((await request('/notices/' + f.notice)).status).toBe(200)
})

const iosBindings = () => ({ ...bindings, FCM_IOS_ENABLED: 'true', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios' })
function iosRequest(body?: unknown, owner = identity) {
  return app.request('https://test.invalid/api/v1/mobile/push/registration', {
    headers: { Origin: 'capacitor://localhost', Authorization: `Bearer ${owner}`, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  }, iosBindings())
}
it('registers case-sensitive iOS FCM independently of APNs keys, rotates only its owner and rejects legacy requests', async () => {
  const value = 'MiXeD_Fcm:01234567890123456789'
  expect((await iosRequest({ platform: 'ios', provider: 'fcm', token: value, locale: 'es' })).status).toBe(200)
  const owner = await hash(`mobile-installation:v1:${identity}`)
  const row = await env.DB.prepare('SELECT * FROM mobile_push_registration WHERE installation_hash=?').bind(owner).first<{ provider: string; platform: string; token_cipher: string }>()
  expect(row).toMatchObject({ provider: 'fcm', platform: 'ios' })
  expect(await decryptPushToken(bindings.MOBILE_PUSH_TOKEN_KEY, row!.token_cipher)).toBe(value)
  expect((await iosRequest({ platform: 'ios', provider: 'fcm', token: value, locale: 'es' }, 'ef'.repeat(32))).status).toBe(409)
  expect((await iosRequest({ platform: 'ios', token: 'ab'.repeat(32), locale: 'es' })).status).toBe(400)
  expect((await iosRequest({ platform: 'ios', provider: 'apns', token: 'ab'.repeat(32), locale: 'es' })).status).toBe(400)
  expect(await (await iosRequest()).json()).toMatchObject({ enabled: true, providers: { ios: true, android: true } })
  expect((await iosRequest({ platform: 'ios', provider: 'fcm', token: 'ROTATED_Fcm:01234567890123456789', locale: 'en' })).status).toBe(200)
  expect((await request('/revoke', {})).status).toBe(200)
  expect(await env.DB.prepare('SELECT 1 FROM mobile_push_registration WHERE installation_hash=?').bind(owner).first()).toBeNull()
})
it('dispatches an iOS outbox through FCM only after its own gate, without changing admission identity', async () => {
  const f = await scenario()
  const value = 'iOS_MiXeD:01234567890123456789'
  expect((await iosRequest({ platform: 'ios', provider: 'fcm', token: value, locale: 'es' })).status).toBe(200)
  const send = vi.spyOn(provider, 'sendPush').mockResolvedValue({ outcome: 'accepted' })
  await dispatchPushSerialized(bindings, f.queue, f.notice) // Android on is not enough.
  expect(send).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT attempts FROM mobile_push_outbox WHERE id=?').bind(f.notice).first()).toEqual({ attempts: 0 })
  await dispatchPushSerialized(iosBindings(), f.queue, f.notice)
  expect(send).toHaveBeenCalledWith(expect.anything(), 'fcm', value, expect.objectContaining({ platform: 'ios', id: f.notice, kind: 'called' }), expect.any(Number))
  expect(await env.DB.prepare('SELECT installation_hash FROM mobile_entry_installation WHERE entry_id=?').bind(f.entry).first()).toEqual({ installation_hash: f.installation })
  expect(await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(f.entry).first()).toEqual({ status: 'called' })
  for (const table of ['notification_outbox', 'queue_entry_contact', 'consent']) expect(await env.DB.prepare(`SELECT 1 FROM ${table} WHERE entry_id=?`).bind(f.entry).first()).toBeNull()
})
