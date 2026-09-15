import { entrySchema, type JoinQueue } from '@noqueue/contracts/queue'
import { readConfirmation } from './confirmation'
import { encryptPhone, hash, hmac, phoneHash, recoveryToken } from './crypto'

interface StoredEntry {
  id: string
  code: string
  queue_id: string
  sequence: number
  request_hash: string
  status: string
}
export async function readEntry(env: CloudflareBindings, token: string) {
  const entry = await env.DB.prepare(
    'SELECT id,code,queue_id,sequence,request_hash,status FROM queue_entry WHERE recovery_hash=?',
  )
    .bind(await hash(token))
    .first<StoredEntry>()
  return entry ? presentEntry(env, entry) : null
}
async function presentEntry(env: CloudflareBindings, entry: StoredEntry) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM queue_entry WHERE queue_id=? AND status='waiting' AND sequence<=?) AS position,
    q.average_minutes, COALESCE(n.status,'disabled') AS notification FROM queue q LEFT JOIN notification_outbox n ON n.id=(SELECT latest.id FROM notification_outbox latest WHERE latest.entry_id=? ORDER BY latest.rowid DESC LIMIT 1) WHERE q.id=?`,
  )
    .bind(entry.queue_id, entry.sequence, entry.id, entry.queue_id)
    .first<{
      position: number
      average_minutes: number
      notification: string
    }>()
  if (!row) throw new Error('Entry queue missing')
  return entrySchema.parse({
    code: entry.code,
    position: entry.status === 'waiting' ? row.position : 0,
    etaMinutes:
      entry.status === 'waiting'
        ? Math.max(0, row.position - 1) * row.average_minutes
        : 0,
    status: entry.status,
    notification: row.notification,
    ...(await readConfirmation(env, entry.id)),
  })
}
export async function joinQueue(
  env: CloudflareBindings,
  queueId: string,
  key: string,
  input: JoinQueue,
  experiment = false,
) {
  const requestHash = await hmac(
    env.RECOVERY_TOKEN_KEY,
    `join-fingerprint:v1:${experiment ? 'confirmation:' : ''}${JSON.stringify(
      input,
    )}`,
  )
  const existing = await env.DB.prepare(
    'SELECT id,code,queue_id,sequence,request_hash,status FROM queue_entry WHERE queue_id=? AND idempotency_key=?',
  )
    .bind(queueId, key)
    .first<StoredEntry>()
  if (existing) {
    if (existing.request_hash !== requestHash)
      return { status: 409, body: { error: 'idempotency_conflict' } }
    return {
      status: 200,
      body: {
        ...(await presentEntry(env, existing)),
        recoveryToken: await recoveryToken(env, existing.id),
      },
    }
  }
  if (
    experiment &&
    input.whatsapp.consent &&
    queueId === 'confirmation-experiment'
  ) {
    const stopped = await env.DB.prepare(
      'SELECT 1 FROM whatsapp_contact_state WHERE phone_hash=? AND stopped_at IS NOT NULL',
    )
      .bind(await phoneHash(env, input.whatsapp.phone))
      .first()
    if (stopped) return { status: 403, body: { error: 'contact_stopped' } }
    const uncertain = await env.DB.prepare(
      `SELECT 1 FROM notification_outbox n JOIN queue_entry_contact p ON p.entry_id=n.entry_id
       JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id=? AND p.phone_hash=? AND n.status IN ('sending','unknown') LIMIT 1`,
    )
      .bind(queueId, await phoneHash(env, input.whatsapp.phone))
      .first()
    if (uncertain)
      return { status: 409, body: { error: 'unknown_delivery_unresolved' } }
    const active = await env.DB.prepare(
      "SELECT 1 FROM queue_entry_contact p JOIN queue_entry e ON e.id=p.entry_id WHERE e.queue_id=? AND e.status='waiting' LIMIT 1",
    )
      .bind(queueId)
      .first()
    if (active)
      return {
        status: 409,
        body: { error: 'experiment_tester_already_waiting' },
      }
  }
  const queue = await env.DB.prepare(
    `SELECT q.capacity,q.open,q.average_minutes,v.organization_id,
    (SELECT COUNT(*) FROM queue_entry WHERE queue_id=q.id AND status='waiting') AS waiting,
    (SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=q.id) AS sequence
    FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=?`,
  )
    .bind(queueId)
    .first<{
      capacity: number
      open: number
      average_minutes: number
      organization_id: string
      waiting: number
      sequence: number
    }>()
  if (!queue) return { status: 404, body: { error: 'queue_not_found' } }
  if (!queue.open || queue.waiting >= queue.capacity)
    return { status: 409, body: { error: 'queue_unavailable' } }
  const id = crypto.randomUUID(),
    now = Date.now(),
    token = await recoveryToken(env, id)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const code = Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (b) => alphabet[b % alphabet.length],
  ).join('')
  const statements = [
    env.DB.prepare(
      `INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      queueId,
      key,
      requestHash,
      await hash(token),
      code,
      input.partySize,
      input.locale,
      now,
      queue.sequence,
    ),
    env.DB.prepare('INSERT INTO queue_event VALUES (?,?,?,?)').bind(
      crypto.randomUUID(),
      id,
      'joined',
      now,
    ),
  ]
  if (input.whatsapp.consent) {
    statements.push(
      env.DB.prepare('INSERT INTO queue_entry_contact VALUES (?,?,?)').bind(
        id,
        await encryptPhone(env.PII_ENCRYPTION_KEY, input.whatsapp.phone),
        await phoneHash(env, input.whatsapp.phone),
      ),
      env.DB.prepare('INSERT INTO consent VALUES (?,?,?,?,?,?,NULL)').bind(
        crypto.randomUUID(),
        id,
        queue.organization_id,
        experiment ? 'confirmation_contact' : 'queue_updates',
        experiment ? 'confirmation-experiment-v1' : input.whatsapp.version,
        now,
      ),
      env.DB.prepare(
        'INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind) VALUES (?,?,?,?,?,?)',
      ).bind(
        id,
        id,
        `joined:${id}`,
        env.WHATSAPP_ENABLED === 'true' ? 'pending' : 'cancelled',
        now,
        experiment ? 'confirmation' : 'queue_joined',
      ),
    )
    if (experiment)
      statements.push(
        env.DB.prepare(
          'INSERT INTO queue_confirmation(entry_id,payload,contact_authorized_at,expires_at) VALUES (?,?,?,?)',
        ).bind(id, crypto.randomUUID(), now, now + 15 * 60 * 1000),
      )
  }
  await env.DB.batch(statements)
  // Publishing is best-effort only after the durable transaction. The scheduled sweep repairs this gap.
  if (input.whatsapp.consent && env.WHATSAPP_ENABLED === 'true') {
    try {
      await env.NOTIFICATIONS.send({
        kind: 'dispatch-notification',
        notificationId: id,
      })
    } catch {
      console.warn('notification_publish_deferred')
    }
  }
  return {
    status: 201,
    body: {
      code,
      position: queue.waiting + 1,
      etaMinutes: queue.waiting * queue.average_minutes,
      status: 'waiting',
      notification: input.whatsapp.consent
        ? env.WHATSAPP_ENABLED === 'true'
          ? 'pending'
          : 'cancelled'
        : 'disabled',
      ...(experiment ? { confirmation: 'pending' } : {}),
      recoveryToken: token,
    },
  }
}
