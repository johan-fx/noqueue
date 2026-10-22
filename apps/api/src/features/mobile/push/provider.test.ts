import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupNetwork } from '../../../../test/fake-network'
import { pushProviderReady, sendPush } from './provider'
let rsa: string, ec: string, ecPublic: CryptoKey
const network = setupNetwork()
async function pem(key: CryptoKey) {
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', key) as ArrayBuffer)))}\n-----END PRIVATE KEY-----`
}
beforeAll(async () => {
  rsa = await pem((await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair).privateKey)
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  ec = await pem(pair.privateKey)
  ecPublic = pair.publicKey
})
beforeEach(() => network.resetHandlers())
const settings = () => ({ ...env, MOBILE_PUSH_ENABLED: 'true', MOBILE_PUSH_TOKEN_KEY: '44'.repeat(32),
  APNS_TRANSPORT_VERIFIED: 'true', // Synthetic HTTP mocks only, not runtime attestation.
  APNS_KEY_ID: 'ABC1234567', APNS_TEAM_ID: 'DEF1234567', APNS_TOPIC: 'com.noqueue-app.ios', APNS_ENVIRONMENT: 'sandbox', APNS_PRIVATE_KEY: ec,
  FCM_PROJECT_ID: 'noqueue-test', FCM_CLIENT_EMAIL: `${crypto.randomUUID()}@test.iam.gserviceaccount.com`, FCM_PRIVATE_KEY: rsa })
const message = () => ({ id: '12'.repeat(16), kind: 'called', locale: 'es', expiresAt: Date.now() + 300000 })
function oauth() { network.use(http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
  const body = new URLSearchParams(await request.text())
  expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
  const claims = JSON.parse(atob(body.get('assertion')!.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/')))
  expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging')
  expect(claims.aud).toBe('https://oauth2.googleapis.com/token')
  return HttpResponse.json({ access_token: 'fake-local-oauth-token', expires_in: 3600 })
})) }
it('builds an APNs alert with opaque hint, TTL and collapse ID; never sends capabilities or PII', async () => {
  let calls = 0
  network.use(http.post('https://api.sandbox.push.apple.com/3/device/:token', async ({ request, params }) => {
    calls++; expect(params.token).toBe('aa'.repeat(32))
    expect(request.headers.get('apns-topic')).toBe('com.noqueue-app.ios')
    expect(request.headers.get('apns-collapse-id')).toBe('12'.repeat(16))
    expect(request.headers.get('apns-push-type')).toBe('alert')
    const jwt = request.headers.get('authorization')!.split(' ')[1]!
    expect(JSON.parse(atob(jwt.split('.')[0]!))).toMatchObject({ alg: 'ES256', kid: 'ABC1234567' })
    const [header, claims, encodedSignature] = jwt.split('.')
    const signature = Uint8Array.from(atob(encodedSignature!.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
    expect(signature.byteLength).toBe(64) // JOSE R||S, not DER.
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ecPublic, signature, new TextEncoder().encode(`${header}.${claims}`))).toBe(true)
    expect(JSON.parse(atob(claims!))).toMatchObject({ iss: 'DEF1234567', iat: expect.any(Number) })
    const body = await request.json() as any
    expect(Object.keys(body).sort()).toEqual(['aps', 'notificationId', 'type'])
    expect(body.aps.alert.body).toContain('Es tu turno')
    return new HttpResponse(null, { status: 200 })
  }))
  expect(await sendPush(settings(), 'apns', 'aa'.repeat(32), message())).toEqual({ outcome: 'accepted' }); expect(calls).toBe(1)
})
it('selects the production APNs host only for the explicit production environment', async () => {
  let calls = 0
  network.use(http.post('https://api.push.apple.com/3/device/:token', ({ request }) => {
    calls++
    expect(request.headers.get('apns-topic')).toBe('com.noqueue-app.ios')
    return new HttpResponse(null, { status: 200 })
  }))
  expect(await sendPush({ ...settings(), APNS_ENVIRONMENT: 'production' }, 'apns', 'aa'.repeat(32), message())).toEqual({ outcome: 'accepted' })
  expect(calls).toBe(1)
})
it('uses FCM HTTPv1 OAuth, notification+data (not data-only), native channel and bounded TTL', async () => {
  oauth()
  network.use(http.post('https://fcm.googleapis.com/v1/projects/noqueue-test/messages:send', async ({ request }) => {
    expect(request.headers.get('authorization')).toBe('Bearer fake-local-oauth-token')
    const body = await request.json() as any
    expect(body.message.data).toEqual({ type: 'queue-update', notificationId: '12'.repeat(16) })
    expect(body.message.notification.title).toBe('NoQueue')
    expect(body.message.android.notification).toEqual({ channel_id: 'queue-updates', tag: '12'.repeat(16) })
    expect(body.message.android.ttl).toMatch(/^\d+s$/)
    return HttpResponse.json({ name: 'fake-local-message' })
  }))
  expect(await sendPush(settings(), 'fcm', 'dummy-fcm-token', message())).toEqual({ outcome: 'accepted' })
})
it.each([['Unregistered', 410, 'invalid_token'], ['BadDeviceToken', 400, 'failed'], ['InvalidProviderToken', 403, 'failed'], ['TooManyRequests', 429, 'retry']] as const)('classifies APNs %s safely', async (reason, status, outcome) => {
  network.use(http.post('https://api.sandbox.push.apple.com/3/device/:token', () => HttpResponse.json({ reason }, { status, headers: { 'Retry-After': '120' } })))
  const result = await sendPush(settings(), 'apns', 'aa'.repeat(32), message())
  expect(result.outcome).toBe(outcome)
  if (outcome === 'retry') expect(result.retryAfterMs).toBe(120000)
})
it('only invalidates definite FCM UNREGISTERED, not generic invalid arguments or credential errors', async () => {
  oauth()
  network.use(http.post('https://fcm.googleapis.com/v1/projects/noqueue-test/messages:send', () => HttpResponse.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 })))
  expect((await sendPush(settings(), 'fcm', 'test', message())).outcome).toBe('invalid_token')
})
it('does no network IO when disabled or provider configuration is missing', async () => {
  expect((await sendPush({ ...settings(), MOBILE_PUSH_ENABLED: 'false' }, 'apns', 'test', message())).outcome).toBe('retry')
  expect((await sendPush({ ...settings(), APNS_ENVIRONMENT: '' }, 'apns', 'test', message())).outcome).toBe('retry')
})

it('fails closed for unverified APNs without disabling FCM or accepting unknown providers', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  try {
    for (const flag of [undefined, '', 'false', 'TRUE']) {
      const config: CloudflareBindings = { ...settings() }
      if (flag === undefined) delete config.APNS_TRANSPORT_VERIFIED
      else config.APNS_TRANSPORT_VERIFIED = flag
      expect(pushProviderReady(config, 'apns')).toBe(false)
      expect(pushProviderReady(config, 'fcm')).toBe(true)
      expect(pushProviderReady(config, 'unknown')).toBe(false)
      expect(await sendPush(config, 'apns', 'aa'.repeat(32), message())).toEqual({ outcome: 'retry' })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally { fetchSpy.mockRestore() }
})

it('never follows provider redirects with credentials or recipient data', async () => {
  network.use(http.post('https://api.sandbox.push.apple.com/3/device/:token', () => new HttpResponse(null, { status: 307, headers: { Location: 'https://never-contact.invalid' } })))
  expect((await sendPush(settings(), 'apns', 'aa'.repeat(32), message())).outcome).toBe('failed')
})

it('sends iOS via FCM with explicit APNs expiry/collapse and without Android fields', async () => {
  oauth()
  const notice = { ...message(), platform: 'ios' as const }
  let calls = 0
  network.use(http.post('https://fcm.googleapis.com/v1/projects/noqueue-test/messages:send', async ({ request }) => {
    calls++
    const { message: payload } = await request.json() as any
    expect(payload.token).toBe('MiXeD_Fcm:01234567890123456789')
    expect(payload.android).toBeUndefined()
    expect(payload.apns.headers).toEqual({ 'apns-topic': 'com.noqueue-app.ios', 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(notice.expiresAt / 1000)), 'apns-collapse-id': notice.id })
    expect(payload.apns.payload.aps).toEqual({ alert: { title: 'NoQueue', body: expect.stringContaining('Es tu turno') }, sound: 'default' })
    expect(payload.data).toEqual({ type: 'queue-update', notificationId: notice.id })
    return HttpResponse.json({ name: 'synthetic-message' })
  }))
  expect(await sendPush({ ...settings(), FCM_IOS_ENABLED: 'true', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios' }, 'fcm', 'MiXeD_Fcm:01234567890123456789', notice)).toEqual({ outcome: 'accepted' })
  expect(calls).toBe(1)
})
it('iOS FCM stays closed independently of Android and legacy APNs configuration', async () => {
  const spy = vi.spyOn(globalThis, 'fetch')
  try {
    for (const config of [settings(), { ...settings(), FCM_IOS_ENABLED: 'false', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios' }, { ...settings(), FCM_IOS_ENABLED: 'true', FCM_IOS_BUNDLE_ID: 'wrong.bundle' }]) {
      expect((await sendPush(config, 'fcm', 'test-token', { ...message(), platform: 'ios' })).outcome).toBe('retry')
    }
    expect(spy).not.toHaveBeenCalled()
  } finally { spy.mockRestore() }
})

it.each(['ios', 'android'] as const)('keeps lifecycle text but only opaque navigation data on %s', async platform => {
  oauth()
  const notice = { ...message(), platform, kind: 'delayed', body: 'La espera en Venue se ha ampliado. Abre NoQueue.' }
  network.use(http.post('https://fcm.googleapis.com/v1/projects/noqueue-test/messages:send', async ({ request }) => {
    const { message: payload } = await request.json() as any
    expect(payload.notification).toEqual({ title: 'NoQueue', body: notice.body })
    expect(payload.data).toEqual({ type: 'queue-update', notificationId: notice.id })
    if (platform === 'ios') expect(payload.apns.payload.aps.alert.body).toBe(notice.body)
    else expect(payload.apns).toBeUndefined()
    return HttpResponse.json({ name: 'synthetic-lifecycle-message' })
  }))
  expect(await sendPush({ ...settings(), FCM_IOS_ENABLED: 'true', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios' }, 'fcm', 'synthetic-token', notice)).toEqual({ outcome: 'accepted' })
})
it('APNs credential errors from FCM never revoke a valid FCM registration', async () => {
  oauth()
  network.use(http.post('https://fcm.googleapis.com/v1/projects/noqueue-test/messages:send', () => HttpResponse.json({ error: { details: [{ errorCode: 'THIRD_PARTY_AUTH_ERROR' }] } }, { status: 401 })))
  expect((await sendPush({ ...settings(), FCM_IOS_ENABLED: 'true', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios' }, 'fcm', 'test-token', { ...message(), platform: 'ios' })).outcome).toBe('failed')
})
