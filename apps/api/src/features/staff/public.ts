import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { hmac, hash } from '../queue/crypto'
export const publicServices = new Hono<{ Bindings: CloudflareBindings }>()
publicServices.onError((error, c) => {
  if (error instanceof SyntaxError)
    return c.json({ error: 'invalid_json' }, 400)
  return c.json({ error: 'temporarily_unavailable' }, 503)
})
publicServices.use('*', bodyLimit({ maxSize: 2048 }))
publicServices.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})
publicServices.get('/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT q.id,q.name,q.open,v.name AS venueName FROM queue q JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id WHERE q.id=? AND q.config IS NOT NULL AND t.status='active'`,
  )
    .bind(c.req.param('id'))
    .first()
  return row ? c.json(row) : c.json({ error: 'not_found' }, 404)
})
publicServices.post('/:id/entries', async (c) => {
  if (c.req.header('Origin') !== c.env.PUBLIC_APP_ORIGIN)
    return c.json({ error: 'origin_not_allowed' }, 403)
  const parsed = z
    .object({
      partySize: z.number().int().min(1).max(20),
      locale: z.enum(['es', 'en']),
    })
    .safeParse(await c.req.json())
  const key = z.uuid().safeParse(c.req.header('Idempotency-Key'))
  if (!parsed.success || !key.success)
    return c.json({ error: 'invalid_join' }, 400)
  const row = await c.env.DB.prepare(
    `SELECT q.id FROM queue q JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id WHERE q.id=? AND q.config IS NOT NULL AND t.status='active'`,
  )
    .bind(c.req.param('id'))
    .first()
  if (!row) return c.json({ error: 'not_found' }, 404)
  const bucket = Math.floor(Date.now() / 60000)
  const ip = await hmac(
    await hash(c.env.BETTER_AUTH_SECRET),
    'public-rate:v1:' + (c.req.header('CF-Connecting-IP') ?? 'local'),
  )
  const limit = await c.env.DB.prepare(
    'INSERT INTO staff_rate VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(`${ip}:${bucket}`)
    .first<{ count: number }>()
  if (!limit || limit.count > 10) return c.json({ error: 'rate_limited' }, 429)
  const namespace =
    c.env.APP_ENV === 'local'
      ? c.env.QUEUE_COORDINATOR
      : c.env.QUEUE_COORDINATOR.jurisdiction('eu')
  const result = await namespace
    .getByName(c.req.param('id'))
    .join(c.req.param('id'), key.data, {
      ...parsed.data,
      whatsapp: { consent: false },
    })
  return c.json(result.body, result.status as 200)
})
