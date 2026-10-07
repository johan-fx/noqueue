import { noticeStatement, publishNotice } from './notices'
import { HTTPException } from 'hono/http-exception'
import {
  customerCommandSchema,
  type CustomerCommand,
} from '@noqueue/contracts/queue'
import { encryptDisplayName, hash, hmac } from './crypto'
import { eligibleResources } from './engine'
import { loadQueueState, recalculateQueue } from './projection'

export function customerPhase(
  status: string,
  position: number,
  eta: number,
  quality: string | undefined,
  config: { approachTurns?: number; approachMinutes?: number },
) {
  if (status === 'completed' || status === 'served') return 'arrived'
  if (status === 'no_show' || status === 'expired') return 'expired'
  if (status === 'called' || status === 'cancelled') return status
  return Math.max(position - 1, 0) <= (config.approachTurns ?? 2) ||
    (quality !== 'unknown' &&
      quality !== undefined &&
      eta <= (config.approachMinutes ?? 10))
    ? 'approaching'
    : 'waiting'
}

/** Called inside the queue coordinator; every statement commits together. */
export async function expireArrivals(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  const due = await env.DB.prepare(
    "SELECT id FROM queue_entry WHERE queue_id=? AND status='called' AND arrival_deadline_at<=?",
  )
    .bind(queueId, now)
    .all<{ id: string }>()
  if (!due.results.length) return
  const statements = due.results.flatMap(({ id }) => [
    noticeStatement(env, id, 'expired', now),
    env.DB.prepare(
      "INSERT INTO queue_event(id,entry_id,kind,created_at) SELECT ?,id,'expired',? FROM queue_entry WHERE id=? AND status='called'",
    ).bind(crypto.randomUUID(), now, id),
    env.DB.prepare(
      "UPDATE queue_allocation SET released_at=?,outcome='expired' WHERE entry_id=? AND released_at IS NULL AND EXISTS(SELECT 1 FROM queue_entry WHERE id=? AND status='called')",
    ).bind(now, id, id),
    env.DB.prepare(
      "UPDATE queue_entry SET status='expired',version=version+1 WHERE id=? AND status='called' AND arrival_deadline_at<=?",
    ).bind(id, now),
  ])
  await env.DB.batch(statements)
  for (const { id } of due.results) await publishNotice(env, id, 'expired')
}

export async function runCustomerCommand(
  env: CloudflareBindings,
  queueId: string,
  token: string,
  key: string,
  input: CustomerCommand,
  now = Date.now(),
) {
  customerCommandSchema.parse(input)
  await expireArrivals(env, queueId, now)
  const entry = await env.DB.prepare(
    'SELECT id,status,version,sequence FROM queue_entry WHERE recovery_hash=? AND queue_id=?',
  )
    .bind(await hash(token), queueId)
    .first<{
      id: string
      status: string
      version: number
      sequence: number
    }>()
  if (!entry) throw new HTTPException(404, { message: 'not_found' })
  // Keyed fingerprints do not reveal names through offline dictionary attacks.
  const fingerprint = await hmac(env.RECOVERY_TOKEN_KEY, JSON.stringify(input))
  const prior = await env.DB.prepare(
    'SELECT request_hash,result FROM customer_command WHERE entry_id=? AND request_key=?',
  )
    .bind(entry.id, key)
    .first<{ request_hash: string; result: string }>()
  if (prior) {
    if (prior.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    return JSON.parse(prior.result) as { ok: true }
  }
  if (entry.version !== input.version)
    throw new HTTPException(409, { message: 'version_conflict' })
  if (entry.status !== 'waiting')
    throw new HTTPException(409, { message: 'invalid_transition' })
  const state = await loadQueueState(env, queueId, now)
  if (state.config?.type !== 'restaurant')
    throw new HTTPException(409, { message: 'unsupported_service' })
  const statements: D1PreparedStatement[] = []
  let metadata: Record<string, unknown> = {}
  if (input.action === 'update') {
    const party = { id: entry.id, sequence: entry.sequence, ...input }
    if (
      !eligibleResources(
        party,
        state.resources,
        state.config.assignmentPreference,
      ).length
    )
      throw new HTTPException(400, { message: 'invalid_space_preference' })
    statements.push(
      env.DB.prepare(
        'UPDATE queue_entry SET display_name_cipher=?,party_size=?,preferred_space_id=?,locale=?,version=version+1 WHERE id=?',
      ).bind(
        await encryptDisplayName(env.PII_ENCRYPTION_KEY, input.displayName),
        input.partySize,
        input.preferredSpaceId,
        input.locale,
        entry.id,
      ),
    )
    metadata = {
      partySize: input.partySize,
      preferredSpaceId: input.preferredSpaceId,
    }
  } else if (input.action === 'cancel') {
    statements.push(
      env.DB.prepare(
        "UPDATE queue_allocation SET released_at=?,outcome='cancelled' WHERE entry_id=? AND released_at IS NULL",
      ).bind(now, entry.id),
      env.DB.prepare(
        "UPDATE queue_entry SET status='cancelled',version=version+1 WHERE id=?",
      ).bind(entry.id),
    )
  } else {
    const party = state.parties.find((p) => p.id === entry.id)!
    const resources = new Set(
      eligibleResources(
        party,
        state.resources,
        state.config.assignmentPreference,
      ).map((r) => r.id),
    )
    const successor = state.parties.find(
      (p) =>
        p.sequence > entry.sequence &&
        eligibleResources(
          p,
          state.resources,
          state.config!.assignmentPreference,
        ).some((r) => resources.has(r.id)),
    )
    if (!successor)
      throw new HTTPException(409, { message: 'no_compatible_successor' })
    statements.push(
      env.DB.prepare(
        'UPDATE queue_entry SET sequence=(SELECT MAX(sequence)+1 FROM queue_entry WHERE queue_id=?) WHERE id=?',
      ).bind(queueId, entry.id),
      env.DB.prepare(
        'UPDATE queue_entry SET sequence=?,version=version+1 WHERE id=?',
      ).bind(entry.sequence, successor.id),
      env.DB.prepare(
        'UPDATE queue_entry SET sequence=?,version=version+1 WHERE id=?',
      ).bind(successor.sequence, entry.id),
      env.DB.prepare(
        "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'yield_received',?)",
      ).bind(crypto.randomUUID(), successor.id, now),
    )
    metadata = {
      successorId: successor.id,
      fromSequence: entry.sequence,
      toSequence: successor.sequence,
    }
  }
  const eventId = crypto.randomUUID()
  statements.push(
    env.DB.prepare(
      'INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,?,?)',
    ).bind(eventId, entry.id, `customer_${input.action}`, now),
    env.DB.prepare('INSERT INTO customer_event_detail VALUES (?,?)').bind(
      eventId,
      JSON.stringify(metadata),
    ),
    env.DB.prepare('INSERT INTO customer_command VALUES (?,?,?,?,?)').bind(
      entry.id,
      key,
      fingerprint,
      JSON.stringify({ ok: true }),
      now,
    ),
  )
  await env.DB.batch(statements)
  await recalculateQueue(env, queueId, now)
  return { ok: true }
}
