import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import {
  deliveryTraceStatement,
  purgeDeliveryTrace,
  deliveryRetentionMs,
} from './delivery-trace'

it('retains seven days by server recording, not provider occurrence, without deleting the job', async () => {
  const id = crypto.randomUUID(),
    now = Date.now()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,'demo-queue',?,?,?,'TRACE',1,'es',?,1,'called')",
  )
    .bind(id, id, id, id, now)
    .run()
  await env.DB.prepare(
    'INSERT INTO notification_outbox(id,entry_id,idempotency_key,updated_at) VALUES (?,?,?,?)',
  )
    .bind(id, id, id, now)
    .run()
  await deliveryTraceStatement(env, {
    id: 'old-' + id,
    notificationId: id,
    event: 'attempt_started',
    recordedAt: now - deliveryRetentionMs - 1,
  }).run()
  await deliveryTraceStatement(env, {
    id: 'boundary-' + id,
    notificationId: id,
    event: 'accepted',
    recordedAt: now - deliveryRetentionMs,
  }).run()
  await deliveryTraceStatement(env, {
    id: 'late-' + id,
    notificationId: id,
    event: 'delivered',
    recordedAt: now,
    occurredAt: now - deliveryRetentionMs * 2,
  }).run()
  await purgeDeliveryTrace(env, now)
  expect(
    (
      await env.DB.prepare(
        "SELECT event FROM notification_trace WHERE notification_id=? AND event!='queued' ORDER BY recorded_at",
      )
        .bind(id)
        .all()
    ).results,
  ).toEqual([{ event: 'accepted' }, { event: 'delivered' }])
  expect(
    await env.DB.prepare('SELECT id FROM notification_outbox WHERE id=?')
      .bind(id)
      .first(),
  ).not.toBeNull()
})
