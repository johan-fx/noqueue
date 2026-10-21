import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { checkFcm, email, project } from './check-fcm-credential.mjs'
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const credential = { type: 'service_account', project_id: project, client_email: email,
  private_key_id: 'a'.repeat(40), token_uri: 'https://oauth2.googleapis.com/token',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
test('offline by default; signs locally without using network or leaking the key', async () => {
  const result = await checkFcm(credential, { fetchImpl: () => { throw new Error('unexpected network') } })
  assert.equal(result.offlineSignature, 'passed')
  assert.equal(result.deliveryAttempted, false)
  assert.ok(!JSON.stringify(result).includes('PRIVATE KEY'))
})
test('online mode always uses validate_only and no device token; fixed endpoints, scope and no redirects', async () => {
  const requests = []
  const report = await checkFcm(credential, { online: true, fetchImpl: async (url, init) => {
    requests.push({ url, init })
    return Response.json(requests.length === 1 ? { access_token: 'test-only-token' } : {})
  } })
  assert.equal(requests.length, 2)
  assert.equal(requests[0].url, 'https://oauth2.googleapis.com/token')
  const jwt = new URLSearchParams(requests[0].init.body).get('assertion')
  assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging')
  assert.equal(requests[1].url, `https://fcm.googleapis.com/v1/projects/${project}/messages:send`)
  const body = JSON.parse(requests[1].init.body)
  assert.equal(body.validate_only, true)
  assert.match(body.message.topic, /^noqueue-validation-only-/)
  assert.ok(!('token' in body.message))
  assert.ok(requests.every(r => r.init.redirect === 'error' && r.init.signal))
  assert.equal(report.fcmValidateOnly, 'passed')
  assert.ok(!JSON.stringify(report).includes('test-only-token'))
})
test('rejects a different project/account or untrusted token endpoint before network', async () => {
  for (const change of [{ project_id: 'other' }, { client_email: 'firebase-adminsdk@example.com' }, { token_uri: 'https://evil.example/token' }]) {
    await assert.rejects(checkFcm({ ...credential, ...change }, { online: true, fetchImpl: () => assert.fail('network') }))
  }
})
test('authentication failure never proceeds to FCM and does not return raw response body', async () => {
  let count = 0
  await assert.rejects(checkFcm(credential, { online: true, fetchImpl: async () => { count++; return new Response('sensitive diagnostic', { status: 403 }) } }), /oauth_http_403/)
  assert.equal(count, 1)
})
test('validation denial is not reported as successful', async () => {
  let count = 0
  await assert.rejects(checkFcm(credential, { online: true, fetchImpl: async () => ++count === 1 ? Response.json({ access_token: 'test' }) : new Response('', { status: 403 }) }), /fcm_validation_http_403/)
})
