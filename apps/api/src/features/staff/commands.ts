import {
  queueCommandSchema,
  queueSettingsSchema,
  type QueueCommand,
} from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'
import { queueAccess, audit } from '../../auth/access'
import { hash } from '../queue/crypto'
export async function runQueueCommand(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  key: string,
  input: QueueCommand,
) {
  const access = await queueAccess(env, actor, queueId, 'queue.operate')
  queueCommandSchema.parse(input)
  const fingerprint = await hash(JSON.stringify({ queueId, input }))
  const previous = await env.DB.prepare(
    'SELECT request_hash,result FROM staff_command WHERE actor_id=? AND request_key=?',
  )
    .bind(actor, key)
    .first<{ request_hash: string; result: string }>()
  if (previous) {
    if (previous.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    return JSON.parse(previous.result) as { ok: true }
  }
  const entry = await env.DB.prepare(
    'SELECT status,version,called_at FROM queue_entry WHERE id=? AND queue_id=?',
  )
    .bind(input.entryId, queueId)
    .first<{ status: string; version: number; called_at: number | null }>()
  if (!entry) throw new HTTPException(404, { message: 'not_found' })
  if (entry.version !== input.version)
    throw new HTTPException(409, { message: 'version_conflict' })
  const transitions: Record<string, readonly string[]> = {
    call: ['waiting'],
    complete: ['called'],
    cancel: ['waiting', 'called'],
    no_show: ['called'],
    skip: ['waiting'],
  }
  if (!transitions[input.action]!.includes(entry.status))
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (input.action === 'no_show') {
    const q = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
      .bind(queueId)
      .first<{ config: string }>()
    const grace = (JSON.parse(q!.config) as { graceMinutes: number })
      .graceMinutes
    if (!entry.called_at || Date.now() < entry.called_at + grace * 60000)
      throw new HTTPException(409, { message: 'arrival_grace_active' })
  }
  const status = {
    call: 'called',
    complete: 'completed',
    cancel: 'cancelled',
    no_show: 'no_show',
    skip: 'waiting',
  }[input.action]
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE queue_entry SET status=?,version=version+1,called_at=?,sequence=CASE WHEN ?='skip' THEN (SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?) ELSE sequence END WHERE id=? AND queue_id=? AND version=?`,
    ).bind(
      status,
      input.action === 'call' ? Date.now() : entry.called_at,
      input.action,
      queueId,
      input.entryId,
      queueId,
      input.version,
    ),
    env.DB.prepare(
      'INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      input.entryId,
      status === 'waiting' ? 'skipped' : status,
      Date.now(),
    ),
    audit(
      env,
      actor,
      access.organizationId,
      access.venueId,
      `queue.${input.action}`,
      input.entryId,
    ),
    env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)').bind(
      actor,
      key,
      fingerprint,
      JSON.stringify({ ok: true }),
    ),
  ])
  return { ok: true }
}
export async function configureQueue(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  body: unknown,
) {
  const access = await queueAccess(env, actor, queueId, 'queue.configure')
  const parsed = queueSettingsSchema.safeParse(body)
  if (!parsed.success)
    throw new HTTPException(400, { message: 'invalid_settings' })
  const { version, open, ...config } = parsed.data
  const current = await env.DB.prepare('SELECT version FROM queue WHERE id=?')
    .bind(queueId)
    .first<{ version: number }>()
  if (!current || current.version !== version)
    throw new HTTPException(409, { message: 'version_conflict' })
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE queue SET capacity=?,average_minutes=?,open=?,name=?,config=?,version=version+1 WHERE id=? AND version=?',
    ).bind(
      config.capacity,
      config.averageMinutes,
      Number(open),
      config.name,
      JSON.stringify(config),
      queueId,
      version,
    ),
    audit(
      env,
      actor,
      access.organizationId,
      access.venueId,
      'queue.configured',
      queueId,
    ),
  ])
  return { ok: true }
}
