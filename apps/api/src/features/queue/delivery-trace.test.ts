import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import {
  deliveryTraceStatement,
  purgeDeliveryTrace,
  deliveryRetentionMs,
  notificationDeliverySummary,
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

it('summarizes provider acceptance, delivery, read, failure, unknown, and openings by notice kind', async () => {
  const now = Date.now()
  const queueId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO queue(id,venue_id,capacity,average_minutes,name,config) VALUES (?,\'demo-venue\',99,30,\'Metrics test\',?)',
  )
    .bind(
      queueId,
      JSON.stringify({
        name: 'Metrics test',
        type: 'restaurant',
        capacity: 99,
        averageMinutes: 30,
        graceMinutes: 5,
        cutoffMinutes: 0,
        twentyFourHours: true,
        schedules: [],
        receptionServices: [],
        spaces: [],
      }),
    )
    .run()
  const notices = [
    { kind: 'queue_joined', status: 'accepted', acceptedAt: now, openedAt: null },
    { kind: 'ready', status: 'delivered', acceptedAt: now, openedAt: null },
    { kind: 'ready', status: 'read', acceptedAt: now, openedAt: now },
    { kind: 'approaching', status: 'failed', acceptedAt: null, openedAt: null },
    { kind: 'expired', status: 'unknown', acceptedAt: null, openedAt: null },
  ]
  for (const notice of notices) {
    const entryId = crypto.randomUUID()
    const notificationId = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,? ,?,?,?,?,'1','es',?,?)",
    )
      .bind(
        entryId,
        queueId,
        entryId,
        'request-hash',
        entryId,
        `METRIC-${entryId.slice(0, 8)}`,
        now,
        Number.parseInt(entryId.replaceAll('-', '').slice(0, 10), 16),
      )
      .run()
    await env.DB.prepare(
      'INSERT INTO notification_outbox(id,entry_id,idempotency_key,kind,status,updated_at,payload_version,accepted_at,opened_at) VALUES (?,?,?,?,?,?,2,?,?)',
    )
      .bind(
        notificationId,
        entryId,
        notificationId,
        notice.kind,
        notice.status,
        now,
        notice.acceptedAt,
        notice.openedAt,
      )
      .run()
    await deliveryTraceStatement(env, {
      id: `${notificationId}:status`,
      notificationId,
      event: notice.status,
      recordedAt: now,
    }).run()
    if (notice.status === 'delivered' || notice.status === 'read')
      await deliveryTraceStatement(env, {
        id: `${notificationId}:accepted`,
        notificationId,
        event: 'accepted',
        recordedAt: now,
      }).run()
    if (notice.openedAt !== null)
      await deliveryTraceStatement(env, {
        id: `${notificationId}:opened`,
        notificationId,
        event: 'opened',
        recordedAt: now,
      }).run()
  }

  const summary = await notificationDeliverySummary(env, queueId, now - 1000)

  expect(summary).toEqual([
    {
      kind: 'approaching',
      accepted: 0,
      delivered: 0,
      read: 0,
      failed: 1,
      unknown: 0,
      openings: 0,
    },
    {
      kind: 'expired',
      accepted: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      unknown: 1,
      openings: 0,
    },
    {
      kind: 'queue_joined',
      accepted: 1,
      delivered: 0,
      read: 0,
      failed: 0,
      unknown: 0,
      openings: 0,
    },
    {
      kind: 'ready',
      accepted: 2,
      delivered: 2,
      read: 1,
      failed: 0,
      unknown: 0,
      openings: 1,
    },
  ])
})
