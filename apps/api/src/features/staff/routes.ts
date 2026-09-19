import { hash } from '../queue/crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  inviteSchema,
  membershipUpdateSchema,
  provisionSchema,
  queueCommandSchema,
  serviceSchema,
} from '@noqueue/contracts/staff'
import { createAuth } from '../../auth/server'
import { isCommercial } from '../../auth/permissions'
import { audit, queueAccess, venueAccess } from '../../auth/access'
import { provision } from './provision'
import {
  credentialStatements,
  membershipStatements,
} from '../../auth/credentials'
import { hashPassword } from 'better-auth/crypto'
import { passwordSchema } from '@noqueue/contracts/staff'

type StaffEnv = {
  Bindings: CloudflareBindings
  Variables: {
    actor: { id: string; email: string; username: string; role: string }
  }
}
export const staffRoutes = new Hono<StaffEnv>()
staffRoutes.use('*', bodyLimit({ maxSize: 65536 }))
staffRoutes.onError((error, c) => {
  if (error instanceof SyntaxError)
    return c.json({ error: 'invalid_json' }, 400)
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status)
  console.error('staff_request_failed')
  return c.json({ error: 'temporarily_unavailable' }, 503)
})
staffRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  if (
    c.req.method !== 'GET' &&
    c.req.header('Origin') !== c.env.PUBLIC_APP_ORIGIN
  )
    throw new HTTPException(403, { message: 'origin_not_allowed' })
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) throw new HTTPException(401, { message: 'unauthorized' })
  // Authoritative row on every request; stale session role caches never authorize platform actions.
  const user = await c.env.DB.prepare(
    'SELECT id,email,username,role,emailVerified,banned FROM user WHERE id=?',
  )
    .bind(session.user.id)
    .first<{
      id: string
      email: string
      username: string
      role: string
      emailVerified: number
      banned: number
    }>()
  if (!user || user.banned)
    throw new HTTPException(403, { message: 'account_unavailable' })
  c.set('actor', user)
  if (c.req.method !== 'GET') {
    const key = `${user.id}:${Math.floor(Date.now() / 60000)}`
    const rate = await c.env.DB.prepare(
      'INSERT INTO staff_rate VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
    )
      .bind(key)
      .first<{ count: number }>()
    if (!rate || rate.count > 60)
      throw new HTTPException(429, { message: 'rate_limited' })
  }
  await next()
})
const commercial = (role: string) => {
  if (!isCommercial(role))
    throw new HTTPException(403, { message: 'forbidden' })
}
const uuid = (key: string | undefined) => {
  const result = z.uuid().safeParse(key)
  if (!result.success)
    throw new HTTPException(400, { message: 'invalid_idempotency_key' })
  return result.data
}
staffRoutes.get('/me', async (c) => {
  const user = c.get('actor')
  const venues = await c.env.DB.prepare(
    `SELECT v.id,v.name,v.organization_id AS organizationId,o.name AS organizationName,vm.role FROM venue v JOIN organization o ON o.id=v.organization_id JOIN tenant_account t ON t.organization_id=o.id JOIN venue_membership vm ON vm.venue_id=v.id JOIN member m ON m.organizationId=o.id AND m.userId=vm.user_id WHERE vm.user_id=? AND vm.active=1 AND t.status='active' ORDER BY v.name`,
  )
    .bind(user.id)
    .all()
  return c.json({
    user: { id: user.id, email: user.email, username: user.username },
    commercial: isCommercial(user.role),
    venues: venues.results,
  })
})
staffRoutes.post('/commercial/organizations', async (c) => {
  commercial(c.get('actor').role)
  const parsed = provisionSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json(
      { error: 'invalid_provisioning', issues: parsed.error.flatten() },
      400,
    )
  const result = await provision(
    c.env,
    c.get('actor').id,
    uuid(c.req.header('Idempotency-Key')),
    parsed.data,
  )
  return c.json(result, 201)
})
staffRoutes.get('/commercial/organizations', async (c) => {
  commercial(c.get('actor').role)
  const rows = await c.env.DB.prepare(
    `SELECT o.id,o.name,o.slug,t.status,v.id AS venueId,v.name AS venueName FROM organization o JOIN tenant_account t ON t.organization_id=o.id JOIN venue v ON v.organization_id=o.id WHERE t.created_by=? OR ?='platform_admin' ORDER BY o.createdAt DESC LIMIT 100`,
  )
    .bind(c.get('actor').id, c.get('actor').role)
    .all()
  return c.json(rows.results)
})
async function canManage(c: Context<StaffEnv>, venueId: string) {
  const actor = c.get('actor')
  if (isCommercial(actor.role)) {
    const row = await c.env.DB.prepare(
      `SELECT v.organization_id AS organizationId FROM venue v JOIN tenant_account t ON t.organization_id=v.organization_id WHERE v.id=? AND (t.created_by=? OR ?='platform_admin')`,
    )
      .bind(venueId, actor.id, actor.role)
      .first<{ organizationId: string }>()
    if (!row) throw new HTTPException(404, { message: 'not_found' })
    return row
  }
  return venueAccess(c.env, actor.id, venueId, 'members.manage')
}
staffRoutes.get('/venues/:id/members', async (c) => {
  await canManage(c, c.req.param('id'))
  const rows = await c.env.DB.prepare(
    'SELECT u.id,u.name,u.email,u.username,vm.role,vm.active FROM venue_membership vm JOIN user u ON u.id=vm.user_id WHERE vm.venue_id=? ORDER BY u.name',
  )
    .bind(c.req.param('id'))
    .all()
  return c.json({ members: rows.results })
})
staffRoutes.post('/venues/:id/members', async (c) => {
  const access = await canManage(c, c.req.param('id'))
  const parsed = inviteSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_member' }, 400)
  const { username, password, name, role } = parsed.data
  const id = crypto.randomUUID()
  try {
    await c.env.DB.batch([
      ...(await credentialStatements(c.env, id, name, username, password)),
      ...membershipStatements(
        c.env,
        id,
        access.organizationId,
        c.req.param('id'),
        role,
      ),
      audit(
        c.env,
        c.get('actor').id,
        access.organizationId,
        c.req.param('id'),
        'member.created',
        id,
      ),
    ])
  } catch (error) {
    if (
      await c.env.DB.prepare('SELECT id FROM user WHERE username=?')
        .bind(username)
        .first()
    )
      return c.json({ error: 'username_unavailable' }, 409)
    throw error
  }
  return c.json({ id, username }, 201)
})
staffRoutes.post('/venues/:id/members/:userId/password', async (c) => {
  const access = await canManage(c, c.req.param('id'))
  const actor = c.get('actor'),
    targetId = c.req.param('userId')
  const target = await c.env.DB.prepare(
    'SELECT vm.role,u.role AS platformRole FROM venue_membership vm JOIN user u ON u.id=vm.user_id WHERE vm.user_id=? AND vm.venue_id=? AND vm.active=1',
  )
    .bind(targetId, c.req.param('id'))
    .first<{ role: string; platformRole: string }>()
  const memberships = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM member WHERE userId=?',
  )
    .bind(targetId)
    .first<{ n: number }>()
  // Tenant admins cannot reset a global/multi-tenant identity or another owner.
  if (
    !target ||
    target.platformRole !== 'user' ||
    memberships?.n !== 1 ||
    targetId === actor.id ||
    (target.role === 'owner' && !isCommercial(actor.role))
  )
    throw new HTTPException(403, { message: 'password_reset_forbidden' })
  const parsed = z
    .object({ password: passwordSchema })
    .safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_password' }, 400)
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE account SET password=?,updatedAt=? WHERE userId=? AND providerId='credential'",
    ).bind(
      await hashPassword(parsed.data.password),
      new Date().toISOString(),
      targetId,
    ),
    c.env.DB.prepare('DELETE FROM session WHERE userId=?').bind(targetId),
    audit(
      c.env,
      actor.id,
      access.organizationId,
      c.req.param('id'),
      'password.reset',
      targetId,
    ),
  ])
  return c.json({ ok: true })
})
staffRoutes.patch('/venues/:id/members/:userId', async (c) => {
  const access = await canManage(c, c.req.param('id'))
  const parsed = membershipUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_membership' }, 400)
  const target = await c.env.DB.prepare(
    'SELECT role FROM venue_membership WHERE venue_id=? AND user_id=?',
  )
    .bind(c.req.param('id'), c.req.param('userId'))
    .first<{ role: string }>()
  if (!target) throw new HTTPException(404, { message: 'not_found' })
  if (target.role === 'owner' || c.req.param('userId') === c.get('actor').id)
    throw new HTTPException(403, { message: 'owner_or_self_change_forbidden' })
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE venue_membership SET role=?,active=? WHERE user_id=? AND venue_id=? AND role!='owner'",
    ).bind(
      parsed.data.role,
      Number(parsed.data.active),
      c.req.param('userId'),
      c.req.param('id'),
    ),
    audit(
      c.env,
      c.get('actor').id,
      access.organizationId,
      c.req.param('id'),
      'membership.updated',
      c.req.param('userId'),
    ),
  ])
  return c.json({ ok: true })
})
staffRoutes.get('/venues/:id/queues', async (c) => {
  await venueAccess(c.env, c.get('actor').id, c.req.param('id'), 'queue.read')
  const rows = await c.env.DB.prepare(
    'SELECT id,name,venue_id AS venueId,capacity,average_minutes AS averageMinutes,open,version,config FROM queue WHERE venue_id=?',
  )
    .bind(c.req.param('id'))
    .all<{ id: string; config: string }>()
  return c.json(
    rows.results.map((row) => ({ ...row, config: JSON.parse(row.config) })),
  )
})
staffRoutes.get('/queues/:id/entries', async (c) => {
  await queueAccess(c.env, c.get('actor').id, c.req.param('id'), 'queue.read')
  const rows = await c.env.DB.prepare(
    `SELECT id,code,party_size AS partySize,status,sequence,version,called_at AS calledAt FROM queue_entry WHERE queue_id=? ORDER BY CASE WHEN status IN ('waiting','called') THEN 0 ELSE 1 END,CASE WHEN status IN ('waiting','called') THEN sequence ELSE -sequence END LIMIT 500`,
  )
    .bind(c.req.param('id'))
    .all()
  return c.json(rows.results)
})
function coordinator(env: CloudflareBindings, id: string) {
  return (
    env.APP_ENV === 'local'
      ? env.QUEUE_COORDINATOR
      : env.QUEUE_COORDINATOR.jurisdiction('eu')
  ).getByName(id)
}
staffRoutes.post('/queues/:id/commands', async (c) => {
  await queueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.operate',
  )
  const input = queueCommandSchema.safeParse(await c.req.json())
  if (!input.success) return c.json({ error: 'invalid_command' }, 400)
  const result = await coordinator(c.env, c.req.param('id')).staffCommand(
    c.get('actor').id,
    c.req.param('id'),
    uuid(c.req.header('Idempotency-Key')),
    input.data,
  )
  return c.json(result.body, result.status as 200)
})
staffRoutes.patch('/queues/:id', async (c) => {
  await queueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.configure',
  )
  const result = await coordinator(c.env, c.req.param('id')).staffConfigure(
    c.get('actor').id,
    c.req.param('id'),
    await c.req.json(),
  )
  return c.json(result.body, result.status as 200)
})
staffRoutes.get('/venues/:id/audit', async (c) => {
  await canManage(c, c.req.param('id'))
  const rows = await c.env.DB.prepare(
    'SELECT action,target_id AS targetId,created_at AS createdAt FROM staff_audit WHERE venue_id=? ORDER BY created_at DESC LIMIT 100',
  )
    .bind(c.req.param('id'))
    .all()
  return c.json(rows.results)
})
// Adding a service uses the same schema as sales onboarding and queue settings.
staffRoutes.post('/venues/:id/queues', async (c) => {
  const access = await venueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.configure',
  )
  const parsed = serviceSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_settings' }, 400)
  const key = uuid(c.req.header('Idempotency-Key'))
  const fingerprint = await hash(
    JSON.stringify({ venueId: c.req.param('id'), service: parsed.data }),
  )
  const previous = await c.env.DB.prepare(
    'SELECT request_hash,result FROM staff_command WHERE actor_id=? AND request_key=?',
  )
    .bind(c.get('actor').id, key)
    .first<{ request_hash: string; result: string }>()
  if (previous) {
    if (previous.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    return c.json(JSON.parse(previous.result))
  }
  const id = crypto.randomUUID(),
    service = parsed.data
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,?,?,0,?,?)',
      ).bind(
        id,
        c.req.param('id'),
        service.capacity,
        service.averageMinutes,
        service.name,
        JSON.stringify(service),
      ),
      audit(
        c.env,
        c.get('actor').id,
        access.organizationId,
        c.req.param('id'),
        'queue.created',
        id,
      ),
      c.env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)').bind(
        c.get('actor').id,
        key,
        fingerprint,
        JSON.stringify({ id }),
      ),
    ])
  } catch (error) {
    const raced = await c.env.DB.prepare(
      'SELECT request_hash,result FROM staff_command WHERE actor_id=? AND request_key=?',
    )
      .bind(c.get('actor').id, key)
      .first<{ request_hash: string; result: string }>()
    if (raced?.request_hash === fingerprint)
      return c.json(JSON.parse(raced.result))
    throw error
  }
  return c.json({ id }, 201)
})
staffRoutes.patch('/commercial/organizations/:id/status', async (c) => {
  const actor = c.get('actor')
  commercial(actor.role)
  const account = await c.env.DB.prepare(
    "SELECT organization_id FROM tenant_account WHERE organization_id=? AND (created_by=? OR ?='platform_admin')",
  )
    .bind(c.req.param('id'), actor.id, actor.role)
    .first()
  if (!account) throw new HTTPException(404, { message: 'not_found' })
  const parsed = z
    .object({ status: z.enum(['active', 'suspended']) })
    .safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_status' }, 400)
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE tenant_account SET status=? WHERE organization_id=?',
    ).bind(parsed.data.status, c.req.param('id')),
    audit(
      c.env,
      actor.id,
      c.req.param('id'),
      null,
      `tenant.${parsed.data.status}`,
      c.req.param('id'),
    ),
  ])
  return c.json({ ok: true })
})
