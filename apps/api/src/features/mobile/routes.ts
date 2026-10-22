import { activeMobileRows, mobileActiveConflict } from './active-turn'
import { pushRoutes } from './push/routes'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { customerCommandSchema, mobileServiceJoinSchema } from '@noqueue/contracts/queue'
import { hash, hmac } from '../queue/crypto'
import { readEntry } from '../queue/entries'
import { publicService } from '../queue/public-context'
import { readPublicVenue } from '../queue/customer-routes'
import { publicSearchSchema } from '@noqueue/contracts/discovery'
import { searchServices } from '../discovery/search'

const origins = new Set(['capacitor://localhost', 'https://localhost'])
const coordinator = (env: CloudflareBindings, id: string) =>
  (env.APP_ENV === 'local' ? env.QUEUE_COORDINATOR : env.QUEUE_COORDINATOR.jurisdiction('eu')).getByName(id)

// Public anonymous enrollment, NOT device attestation. Origin is a browser
// boundary only; possession of a 256-bit secret proves installation ownership.
export const mobileRoutes = new Hono<{
  Bindings: CloudflareBindings
  Variables: { installationHash: string }
}>()
mobileRoutes.onError((error, c) => c.json({ error: error instanceof SyntaxError ? 'invalid_json' : 'temporarily_unavailable' }, error instanceof SyntaxError ? 400 : 503))
mobileRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Vary', 'Origin')
  const origin = c.req.header('Origin')
  if (!origin || !origins.has(origin)) return c.json({ error: 'origin_not_allowed' }, 403)
  c.header('Access-Control-Allow-Origin', origin)
  if (c.req.method === 'OPTIONS') {
    const method = c.req.header('Access-Control-Request-Method')
    const headers = (c.req.header('Access-Control-Request-Headers') ?? '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean)
    if (!method || !['GET', 'POST'].includes(method) || headers.some(h => !['authorization', 'content-type', 'idempotency-key'].includes(h)))
      return c.json({ error: 'preflight_not_allowed' }, 403)
    c.header('Access-Control-Allow-Methods', 'GET, POST')
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key')
    return c.body(null, 204)
  }
  const secret = /^Bearer ([a-f0-9]{64})$/.exec(c.req.header('Authorization') ?? '')?.[1]
  if (!secret) return c.json({ error: 'installation_required' }, 401)
  c.set('installationHash', await hash(`mobile-installation:v1:${secret}`))
  // IP limit cannot be reset by minting a new anonymous installation secret.
  const ip = await hmac(await hash(c.env.BETTER_AUTH_SECRET), `mobile-rate:v1:${c.req.header('CF-Connecting-IP') ?? 'local'}`)
  const joining = c.req.method === 'POST' && /\/services\/[^/]+\/entries$/.test(c.req.path)
  const searching = c.req.method === 'POST' && c.req.path.endsWith('/search')
  const group = joining ? 'join' : searching ? 'search' : c.req.method === 'POST' ? 'command' : 'read'
  for (const subject of [ip, c.get('installationHash')]) {
    const rate = await c.env.DB.prepare('INSERT INTO staff_rate VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count')
      .bind(`${await hash(`mobile-rate:${group}:${subject}`)}:${Math.floor(Date.now() / 60000)}`).first<{ count: number }>()
    if (!rate || rate.count > (joining ? 10 : searching ? 60 : group === 'command' ? 30 : 120)) return c.json({ error: 'rate_limited' }, 429)
  }
  await next()
})
mobileRoutes.use('*', bodyLimit({ maxSize: 2048, onError: c => c.json({ error: 'body_too_large' }, 413) }))
// Same catalog, visibility, search and availability rules as web. Only transport,
// native CORS and installation authentication differ; no WhatsApp dependency.
mobileRoutes.post('/search', async c => {
  const input = publicSearchSchema.safeParse(await c.req.json())
  if (!input.success) return c.json({ error: 'invalid_search' }, 400)
  return c.json(await searchServices(c.env, input.data))
})
mobileRoutes.get('/services/:id', async c => {
  const service = await publicService(c.env, c.req.param('id'))
  return service ? c.json(service) : c.json({ error: 'not_found' }, 404)
})
mobileRoutes.get('/venues/:id/services', async c => {
  const venue = await readPublicVenue(c.env, c.req.param('id'))
  return venue ? c.json(venue) : c.json({ error: 'not_found' }, 404)
})
mobileRoutes.post('/services/:id/entries', async c => {
  const input = mobileServiceJoinSchema.safeParse(await c.req.json())
  const key = z.uuid().safeParse(c.req.header('Idempotency-Key'))
  if (!input.success || !key.success) return c.json({ error: 'invalid_join' }, 400)
  const service = await publicService(c.env, c.req.param('id'))
  if (!service) return c.json({ error: 'not_found' }, 404)
  for (const row of await activeMobileRows(c.env, c.get('installationHash'))) {
    if (row.queue_id !== service.id) await coordinator(c.env, row.queue_id).refresh(row.queue_id)
  }
  const result = await coordinator(c.env, service.id).join(service.id, key.data,
    { ...input.data, whatsapp: { consent: false } }, false, 'mobile-app', c.get('installationHash'))
  return c.json(result.body, result.status as 200)
})
// Recovery within the same installation, including a lost join response. No
// names/phones are returned; ticket capabilities stay on authenticated TLS.
mobileRoutes.get('/entries', async c => {
  // Reconcile deadlines through each queue's coordinator before deciding empty.
  for (const row of await activeMobileRows(c.env, c.get('installationHash')))
    await coordinator(c.env, row.queue_id).refresh(row.queue_id)
  const conflict = await mobileActiveConflict(c.env, c.get('installationHash'))
  if (!conflict) return c.json({ entries: [] })
  if (conflict.body.entry) return c.json({ entries: [conflict.body.entry] })
  return c.json(conflict.body, conflict.status)
})
async function ownedQueue(env: CloudflareBindings, installationHash: string, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  return env.DB.prepare(`SELECT e.queue_id FROM queue_entry e
    JOIN mobile_entry_installation m ON m.entry_id=e.id JOIN queue q ON q.id=e.queue_id
    JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id
    WHERE e.recovery_hash=? AND m.installation_hash=? AND t.status='active'`)
    .bind(await hash(token), installationHash).first<{ queue_id: string }>()
}
mobileRoutes.get('/entries/:token', async c => {
  const token = c.req.param('token')
  if (!await ownedQueue(c.env, c.get('installationHash'), token)) return c.json({ error: 'not_found' }, 404)
  const entry = await readEntry(c.env, token)
  return entry ? c.json(entry) : c.json({ error: 'not_found' }, 404)
})
mobileRoutes.post('/entries/:token/commands', async c => {
  const input = customerCommandSchema.safeParse(await c.req.json())
  const key = z.uuid().safeParse(c.req.header('Idempotency-Key'))
  if (!input.success || !key.success) return c.json({ error: 'invalid_command' }, 400)
  const token = c.req.param('token')
  const entry = await ownedQueue(c.env, c.get('installationHash'), token)
  if (!entry) return c.json({ error: 'not_found' }, 404)
  const result = await coordinator(c.env, entry.queue_id).customerCommand(entry.queue_id, token, key.data, input.data)
  return c.json(result.body, result.status as 200)
})

mobileRoutes.route('/push', pushRoutes)
