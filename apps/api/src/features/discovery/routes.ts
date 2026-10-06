import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { publicSearchSchema } from '@noqueue/contracts/discovery'
import { hash, hmac } from '../queue/crypto'
import { searchServices } from './search'
export const discoveryRoutes = new Hono<{ Bindings: CloudflareBindings }>()
discoveryRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  await next()
})
discoveryRoutes.use(
  '*',
  bodyLimit({
    maxSize: 2048,
    onError: (c) => c.json({ error: 'request_too_large' }, 413),
  }),
)
discoveryRoutes.onError((error, c) =>
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
discoveryRoutes.post('/search', async (c) => {
  if (c.req.header('Origin') !== c.env.PUBLIC_APP_ORIGIN)
    return c.json({ error: 'origin_not_allowed' }, 403)
  const parsed = publicSearchSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_search' }, 400)
  const ip = await hmac(
    await hash(c.env.BETTER_AUTH_SECRET),
    'discovery-rate:v1:' + (c.req.header('CF-Connecting-IP') ?? 'local'),
  )
  const bucket = Math.floor(Date.now() / 60000)
  const rate = await c.env.DB.prepare(
    'INSERT INTO staff_rate VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(`${ip}:${bucket}`)
    .first<{ count: number }>()
  if (!rate || rate.count > 60) return c.json({ error: 'rate_limited' }, 429)
  await c.env.DB.prepare(
    'DELETE FROM staff_rate WHERE key>=? AND key<? AND key!=?',
  )
    .bind(`${ip}:`, `${ip};`, `${ip}:${bucket}`)
    .run()
  return c.json(await searchServices(c.env, parsed.data))
})
