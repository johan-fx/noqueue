import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { customerCommandSchema } from '@noqueue/contracts/queue'
import { hash, hmac } from './crypto'
import { publicService } from './public-context'

export const customerRoutes = new Hono<{ Bindings: CloudflareBindings }>()
customerRoutes.use('*', bodyLimit({ maxSize: 2048 }))
customerRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  await next()
})
customerRoutes.onError((error, c) =>
  c.json(
    {
      error:
        error instanceof SyntaxError
          ? 'invalid_json'
          : 'temporarily_unavailable',
    },
    error instanceof SyntaxError ? 400 : 503,
  ),
)
const coordinator = (env: CloudflareBindings, id: string) =>
  (env.APP_ENV === 'local'
    ? env.QUEUE_COORDINATOR
    : env.QUEUE_COORDINATOR.jurisdiction('eu')
  ).getByName(id)
customerRoutes.get('/venues/:id/services', async (c) => {
  const venue = await c.env.DB.prepare(
    "SELECT v.id,v.name FROM venue v JOIN tenant_account t ON t.organization_id=v.organization_id WHERE v.id=? AND t.status='active'",
  )
    .bind(c.req.param('id'))
    .first<{ id: string; name: string }>()
  if (!venue) return c.json({ error: 'not_found' }, 404)
  const queues = await c.env.DB.prepare(
    'SELECT id FROM queue WHERE venue_id=? AND config IS NOT NULL ORDER BY rowid',
  )
    .bind(venue.id)
    .all<{ id: string }>()
  const services = []
  for (const queue of queues.results) {
    await coordinator(c.env, queue.id).refresh(queue.id)
    const service = await publicService(c.env, queue.id)
    if (!service) continue
    const counts = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(e.party_size),0) AS waitingPeople,AVG(CASE WHEN p.quality!='unknown' AND p.predicted_at IS NOT NULL THEN p.eta_minutes END) AS averageWaitMinutes FROM queue_entry e LEFT JOIN queue_projection p ON p.entry_id=e.id WHERE e.queue_id=? AND e.status='waiting'",
    )
      .bind(queue.id)
      .first<{ waitingPeople: number; averageWaitMinutes: number | null }>()
    services.push({
      ...service,
      waitingPeople: counts?.waitingPeople ?? 0,
      averageWaitMinutes:
        counts?.averageWaitMinutes == null
          ? null
          : Math.round(counts.averageWaitMinutes),
    })
  }
  return c.json({ ...venue, services })
})
customerRoutes.post('/entries/:token/commands', async (c) => {
  if (c.req.header('Origin') !== c.env.PUBLIC_APP_ORIGIN)
    return c.json({ error: 'origin_not_allowed' }, 403)
  const token = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .safeParse(c.req.param('token'))
  const key = z.uuid().safeParse(c.req.header('Idempotency-Key'))
  const input = customerCommandSchema.safeParse(await c.req.json())
  if (!token.success || !key.success || !input.success)
    return c.json({ error: 'invalid_command' }, 400)
  const ip = await hmac(
    await hash(c.env.BETTER_AUTH_SECRET),
    'customer-rate:v1:' + (c.req.header('CF-Connecting-IP') ?? 'local'),
  )
  const rate = await c.env.DB.prepare(
    'INSERT INTO staff_rate VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(`${ip}:${Math.floor(Date.now() / 60000)}`)
    .first<{ count: number }>()
  if (!rate || rate.count > 30) return c.json({ error: 'rate_limited' }, 429)
  const entry = await c.env.DB.prepare(
    "SELECT e.queue_id FROM queue_entry e JOIN queue q ON q.id=e.queue_id JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id WHERE e.recovery_hash=? AND t.status='active'",
  )
    .bind(await hash(token.data))
    .first<{ queue_id: string }>()
  if (!entry) return c.json({ error: 'not_found' }, 404)
  const result = await coordinator(c.env, entry.queue_id).customerCommand(
    entry.queue_id,
    token.data,
    key.data,
    input.data,
  )
  return c.json(result.body, result.status as 200)
})
