import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const target = args[args.indexOf('--target') + 1]
if (
  !['sandbox', 'staging'].includes(target) ||
  !args.includes(
    target === 'staging' ? '--confirm-live-send' : '--confirm-send',
  )
) {
  console.error(
    'Use --target sandbox --confirm-send or --target staging --confirm-live-send. This performs ONE public join.',
  )
  process.exit(1)
}
const phone = process.env.SMOKE_RECIPIENT,
  pilot = process.env.SMOKE_PILOT_TOKEN,
  key = process.env.SMOKE_IDEMPOTENCY_KEY
if (
  !/^\+[1-9]\d{7,14}$/.test(phone ?? '') ||
  (pilot?.length ?? 0) < 32 ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    key ?? '',
  )
) {
  console.error(
    'Set SMOKE_RECIPIENT, SMOKE_PILOT_TOKEN, and a UUIDv4 SMOKE_IDEMPOTENCY_KEY outside source control. Reuse that key after any uncertain result.',
  )
  process.exit(1)
}
if (target === 'staging' && process.env.SMOKE_STAGING_APPROVED !== 'true') {
  console.error(
    'Staging requires approved template, approved consent and authorized recipient; set SMOKE_STAGING_APPROVED=true only after operator verification.',
  )
  process.exit(1)
}
const root = fileURLToPath(new URL('../', import.meta.url)),
  directory = path.join(root, '.wrangler')
await mkdir(directory, { recursive: true })
const lock = path.join(directory, `smoke-${target}.lock`)
try {
  await mkdir(lock)
} catch {
  console.error(
    'Another smoke run holds the local lock. Do not run concurrently from another machine.',
  )
  process.exit(1)
}
try {
  const origin = `https://${target}.noqueue-app.com`
  const response = await fetch(
    `${origin}/api/v1/public/queues/demo-queue/entries`,
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        'X-NoQueue-Pilot-Token': pilot,
      },
      body: JSON.stringify({
        partySize: 2,
        locale: 'es',
        whatsapp: {
          consent: true,
          phone,
          version: 'whatsapp-queue-updates-v1',
        },
      }),
    },
  )
  if (![200, 201].includes(response.status))
    throw new Error(
      `Public join rejected (${response.status}); no automatic retry`,
    )
  const entry = await response.json()
  if (!/^[a-f0-9]{64}$/.test(entry.recoveryToken))
    throw new Error('Invalid recovery receipt; no automatic retry')
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    const recovery = await fetch(
      `${origin}/api/v1/public/entries/${entry.recoveryToken}`,
      { redirect: 'error', signal: AbortSignal.timeout(10000) },
    )
    if (!recovery.ok)
      throw new Error('Recovery unavailable; retain idempotency key')
    const result = await recovery.json()
    if (
      (target === 'sandbox'
        ? ['sent', 'delivered', 'read']
        : ['delivered', 'read']
      ).includes(result.notification)
    ) {
      console.log(
        `PASS: ${target} join persisted and webhook confirmed ${result.notification}. Now manually send STOP/BAJA and verify revocation using the runbook.`,
      )
      process.exitCode = 0
      break
    }
    if (['failed', 'unknown', 'cancelled'].includes(result.notification))
      throw new Error(
        `Notification ${result.notification}; inspect safely before creating another entry`,
      )
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  if (process.exitCode !== 0)
    throw new Error(
      'Delivery not confirmed within two minutes; do not resend blindly',
    )
} catch (error) {
  console.error(
    error instanceof Error && !error.message.includes('fetch')
      ? error.message
      : 'Network result uncertain; reuse the same idempotency key. No automatic retry.',
  )
  process.exitCode = 1
} finally {
  await rm(lock, { recursive: true, force: true })
}
