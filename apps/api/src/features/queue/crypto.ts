const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
export async function hash(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}
function secretBytes(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret))
    throw new Error('Invalid cryptographic configuration')
  return Uint8Array.from(secret.match(/../g) ?? [], (v) => parseInt(v, 16))
}
export async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}
export async function secureEqual(actual: string, expected: string) {
  if (!expected || expected.length < 32) return false
  const a = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(actual)),
  )
  const b = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  )
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return difference === 0
}
export const recoveryToken = (env: CloudflareBindings, id: string) =>
  hmac(env.RECOVERY_TOKEN_KEY, `entry-recovery:v1:${id}`)
export const phoneHash = (env: CloudflareBindings, phone: string) =>
  hmac(env.PHONE_HASH_KEY, `demo-org:${phone}`)
export async function encryptPhone(secret: string, phone: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(secret),
    'AES-GCM',
    false,
    ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode('phone:v1') },
    key,
    encoder.encode(phone),
  )
  return `${hex(iv.buffer)}:${hex(encrypted)}`
}
export async function decryptPhone(secret: string, cipher: string) {
  const [ivHex, dataHex] = cipher.split(':')
  if (
    !ivHex ||
    !dataHex ||
    !/^[a-f0-9]{24}$/.test(ivHex) ||
    !/^(?:[a-f0-9]{2})+$/.test(dataHex)
  )
    throw new Error('Invalid ciphertext')
  const bytes = (value: string) =>
    Uint8Array.from(value.match(/../g) ?? [], (v) => parseInt(v, 16))
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(secret),
    'AES-GCM',
    false,
    ['decrypt'],
  )
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes(ivHex),
        additionalData: encoder.encode('phone:v1'),
      },
      key,
      bytes(dataHex),
    ),
  )
}
