// Operator-only check. Never imported by the Worker and never capable of delivery.
import { createPrivateKey, createPublicKey, sign, verify, randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

export const project = 'nq-app-f3127'
export const email = `noqueue-push-sender@${project}.iam.gserviceaccount.com`
const oauth = 'https://oauth2.googleapis.com/token'
const scope = 'https://www.googleapis.com/auth/firebase.messaging'
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const requireCheck = (condition, code) => { if (!condition) throw new Error(code) }

export function checkCredential(value) {
  requireCheck(value?.type === 'service_account' && value.project_id === project && value.client_email === email, 'wrong_account')
  requireCheck(value.token_uri === oauth && /^[a-f0-9]{40}$/.test(value.private_key_id ?? ''), 'invalid_metadata')
  let key
  try { key = createPrivateKey(value.private_key) } catch { throw new Error('invalid_private_key') }
  requireCheck(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength >= 2048, 'invalid_key_algorithm')
  const probe = Buffer.from('NoQueue offline credential verification')
  requireCheck(verify('sha256', probe, createPublicKey(key), sign('sha256', probe, key)), 'signature_failed')
  return key
}

export async function checkFcm(value, { online = false, fetchImpl = fetch } = {}) {
  const key = checkCredential(value)
  const report = { project, account: email, keyId: value.private_key_id, offlineSignature: 'passed', deliveryAttempted: false }
  if (!online) return report
  const seconds = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: value.private_key_id })}.${encode({
    iss: email, scope, aud: oauth, iat: seconds, exp: seconds + 300,
  })}`
  const assertion = `${unsigned}.${sign('sha256', Buffer.from(unsigned), key).toString('base64url')}`
  const auth = await fetchImpl(oauth, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  })
  requireCheck(auth.ok, `oauth_http_${auth.status}`)
  const token = await auth.json()
  requireCheck(typeof token.access_token === 'string' && token.access_token.length > 0, 'oauth_invalid_response')
  // No real device token; no switch/argument can turn validate_only off.
  const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ validate_only: true, message: {
      topic: `noqueue-validation-only-${randomUUID()}`,
      data: { type: 'credential-validation-only' }, android: { ttl: '0s' },
    } }),
  })
  requireCheck(response.ok, `fcm_validation_http_${response.status}`)
  return { ...report, oauth: 'passed', fcmValidateOnly: 'passed', validatedAt: new Date().toISOString() }
}

async function main() {
  const args = process.argv.slice(2)
  requireCheck(args.length >= 1 && args.length <= 2 && (!args[1] || args[1] === '--validate-only'), 'usage_keyfile_optional_validate_only')
  const filename = await realpath(args[0])
  const repository = fileURLToPath(new URL('../../../', import.meta.url))
  requireCheck(!filename.startsWith(repository), 'credential_must_be_outside_repository')
  const info = await stat(filename), directory = await stat(path.dirname(filename))
  requireCheck(info.isFile() && (info.mode & 0o077) === 0 && (directory.mode & 0o077) === 0, 'credential_permissions_require_0600_directory_0700')
  const credential = JSON.parse(await readFile(filename, 'utf8'))
  console.log(JSON.stringify(await checkFcm(credential, { online: args[1] === '--validate-only' }), null, 2))
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // Never log provider bodies, JWTs, PEMs, access tokens, or raw network errors.
    const code = /^(wrong_account|invalid_metadata|invalid_private_key|invalid_key_algorithm|signature_failed|oauth_http_\d+|oauth_invalid_response|fcm_validation_http_\d+|usage_keyfile_optional_validate_only|credential_must_be_outside_repository|credential_permissions_require_0600_directory_0700)$/.test(error?.message) ? error.message : 'credential_check_failed'
    console.error(JSON.stringify({ status: 'failed', code, deliveryAttempted: false }))
    process.exitCode = 1
  })
}
