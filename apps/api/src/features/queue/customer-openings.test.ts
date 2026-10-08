import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { hash } from './crypto'
import { customerRoutes } from './customer-routes'

async function fixture(acceptedAt: number | null = Date.now()) {
  const entryId = crypto.randomUUID()
  const notificationId = crypto.randomUUID()
  const token = crypto.randomUUID().replaceAll('-', '').repeat(2)
  const now = Date.now()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,'demo-queue',?,?,?,?,'2','es',?,?)",
  )
    .bind(
      entryId,
      entryId,
      'request-hash',
      await hash(token),
      `OPEN-${entryId.slice(0, 8)}`,
      now,
      Number.parseInt(entryId.replaceAll('-', '').slice(0, 10), 16),
    )
    .run()
  await env.DB.prepare(
    "INSERT INTO notification_outbox(id,entry_id,idempotency_key,kind,status,updated_at,payload_version,accepted_at) VALUES (?,?,?,'ready','accepted',?,2,?)",
  )
    .bind(notificationId, entryId, notificationId, now, acceptedAt)
    .run()
  return { entryId, notificationId, token }
}

it('records one protected opening for an accepted lifecycle notice', async () => {
  const { notificationId, token } = await fixture()
  const path = `/entries/${token}/notices/${notificationId}/opened`

  const first = await customerRoutes.request(path, { method: 'POST' }, env)
  const replay = await customerRoutes.request(path, { method: 'POST' }, env)

  expect(first.status).toBe(204)
  expect(replay.status).toBe(204)
  expect(
    await env.DB.prepare(
      'SELECT opened_at FROM notification_outbox WHERE id=?',
    )
      .bind(notificationId)
      .first(),
  ).toEqual(expect.objectContaining({ opened_at: expect.any(Number) }))
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM notification_trace WHERE notification_id=? AND event='opened'",
    )
      .bind(notificationId)
      .first(),
  ).toEqual({ count: 1 })
})

it('does not record openings for unknown tokens or unaccepted notices', async () => {
  const { notificationId, token } = await fixture(null)
  const unaccepted = await customerRoutes.request(
    `/entries/${token}/notices/${notificationId}/opened`,
    { method: 'POST' },
    env,
  )
  const unknownToken = await customerRoutes.request(
    `/entries/${'0'.repeat(64)}/notices/${notificationId}/opened`,
    { method: 'POST' },
    env,
  )

  expect(unaccepted.status).toBe(404)
  expect(unknownToken.status).toBe(404)
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM notification_trace WHERE notification_id=? AND event='opened'",
    )
      .bind(notificationId)
      .first(),
  ).toEqual({ count: 0 })
})
