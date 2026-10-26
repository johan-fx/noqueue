import { replacementEnabled } from '../queue/call'
import { metricsQuerySchema, venueMetricsQuerySchema } from '@noqueue/contracts/metrics'
import { readMetrics, readVenueMetrics, metricsVenuePage } from '../metrics/read'
import { touchVenueConfiguration } from './configuration'
import { validateQueueIds, replaceQueueAssignments } from './queue-assignments'
import { venueLogosEnabled } from '../../lib/venue-logo'
import { mutateVenueLogo, readVenueLogo, venueLogoAccess, venueLogoFields } from './logo'
import { VENUE_LOGO_MAX_BYTES, venueLogoMutationSchema } from '@noqueue/contracts/staff'
import {
  deliveryRetentionMs,
  notificationDeliverySummary,
} from '../queue/delivery-trace'
import { assignmentContext } from './assignment'
import { allowedEntryActions, roleCapabilities } from '@noqueue/contracts/staff'
import { loadQueueState } from '../queue/projection'
import { directoryConfigStatement } from '../discovery/configuration'
import {
  locationResolveSchema,
  venueLocationUpdateSchema,
} from '@noqueue/contracts/discovery'
import {
  resolveLocation,
  readVenueLocation,
  updateVenueLocation,
} from './location'
import { admissionState, serviceWindow } from './availability'
import { readiness, inventoryConfirmed } from '../queue/opening-state'
import { queueLifecycleSchema } from '@noqueue/contracts/staff'
import { normalizeConfig, readProjection } from '../queue/projection'
import { manualJoinSchema } from '@noqueue/contracts/queue'
import { manualJoinRequiresWhatsapp } from '../queue/entries'
import { hash, decryptDisplayName } from '../queue/crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  inviteSchema,
  validQueueAssignment,
  membershipUpdateSchema,
  memberDetailsSchema,
  provisionSchema,
  queueCommandSchema,
  serviceSchema,
  storedServiceSchema,
  type StaffMember,
} from '@noqueue/contracts/staff'
import { readAuthSession } from '../../auth/server'
import { StaffReadTrace, staffReadRoute } from './read-trace'
import { isCommercial, permits } from '../../auth/permissions'
import {
  audit,
  queueAccess,
  venueAccess,
  venueLocationEditAccess,
} from '../../auth/access'
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
    readTrace: StaffReadTrace
  }
}
export const staffRoutes = new Hono<StaffEnv>()
staffRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  const route = staffReadRoute(c.req.path)
  const trace = new StaffReadTrace(c.env.APP_ENV === 'staging' && c.req.method === 'GET' && route !== null, route ?? 'other')
  c.set('readTrace', trace)
  try { await next() } finally { trace.finish(c.res.status) }
})
staffRoutes.use('*', (c, next) => {
  const upload = c.req.method === 'PUT' && /\/venues\/[^/]+\/logo$/.test(c.req.path)
  return bodyLimit({
    maxSize: upload ? VENUE_LOGO_MAX_BYTES + 65536 : 65536,
    onError: (ctx) => ctx.json({ error: upload ? 'logo_too_large' : 'request_too_large' }, 413),
  })(c, next)
})
staffRoutes.onError((error, c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
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
  const trace = c.get('readTrace')
  trace.phase('auth_init')
  let context: ExecutionContext | undefined
  // app.request unit tests have no execution context; real Workers always do.
  try { context = c.executionCtx as ExecutionContext } catch { /* test adapter */ }
  const session = await readAuthSession(c.env, c.req.raw.headers, context, () => trace.phase('session'))
  if (!session) throw new HTTPException(401, { message: 'unauthorized' })
  trace.phase('user_d1')
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
  // Reject non-commercial address mutations before consuming staff or provider quota.
  if (
    (c.req.method === 'PATCH' && /\/venues\/[^/]+$/.test(c.req.path)) ||
    (c.req.method === 'POST' &&
      /\/locations\/(?:resolve|autocomplete)$/.test(c.req.path))
  )
    commercial(user.role)
  if (c.req.method !== 'GET') {
    const key = `${user.id}:${Math.floor(Date.now() / 60000)}`
    const rate = await c.env.DB.prepare(
      'INSERT INTO staff_rate VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
    )
      .bind(key)
      .first<{ count: number }>()
    if (!rate || rate.count > 60) {
      c.header(
        'Retry-After',
        String(Math.ceil((60000 - (Date.now() % 60000)) / 1000)),
      )
      throw new HTTPException(429, { message: 'rate_limited' })
    }
  }
  trace.phase('handler_d1')
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
async function geocode(
  c: Context<StaffEnv>,
  operation: 'search' | 'autocomplete',
) {
  const parsed = locationResolveSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_location' }, 400)
  const actor = c.get('actor')
  if (parsed.data.scope.kind === 'provision') commercial(actor.role)
  else await venueLocationEditAccess(c.env, actor, parsed.data.scope.id)
  const bucket = Math.floor(Date.now() / 60000)
  const rate = await c.env.DB.prepare(
    'INSERT INTO staff_rate VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(`geocode:${actor.id}:${bucket}`)
    .first<{ count: number }>()
  if (!rate || rate.count > 30) {
    c.header(
      'Retry-After',
      String(Math.ceil((60000 - (Date.now() % 60000)) / 1000)),
    )
    return c.json({ error: 'rate_limited' }, 429)
  }
  return c.json(await resolveLocation(c.env, actor.id, parsed.data, operation))
}
staffRoutes.post('/locations/resolve', (c) => geocode(c, 'search'))
staffRoutes.post('/locations/autocomplete', (c) => geocode(c, 'autocomplete'))
staffRoutes.get('/venues/:id/location', async (c) => {
  await venueAccess(c.env, c.get('actor').id, c.req.param('id'), 'queue.read')
  return c.json(await readVenueLocation(c.env, c.req.param('id')))
})
staffRoutes.patch('/venues/:id', async (c) => {
  const actor = c.get('actor'),
    venueId = c.req.param('id')
  const access = await venueLocationEditAccess(c.env, actor, venueId)
  const parsed = venueLocationUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_location' }, 400)
  return c.json(
    await updateVenueLocation(
      c.env,
      actor.id,
      access.organizationId,
      venueId,
      parsed.data,
    ),
  )
})
staffRoutes.get('/venues/:id/logo', (c) =>
  readVenueLogo(c.env, c.get('actor'), c.req.param('id')).then((state) => c.json(state)),
)
staffRoutes.put('/venues/:id/logo', async (c) => {
  const actor = c.get('actor'), venueId = c.req.param('id')
  await venueLogoAccess(c.env, actor, venueId, true)
  if (!venueLogosEnabled(c.env)) return c.json({ error: 'venue_logos_disabled' }, 503)
  const key = uuid(c.req.header('Idempotency-Key'))
  if (!c.req.header('Content-Type')?.startsWith('multipart/form-data;'))
    return c.json({ error: 'invalid_logo' }, 400)
  let data: FormData
  try { data = await c.req.raw.formData() } catch { return c.json({ error: 'invalid_logo' }, 400) }
  const file = data.get('file'), rawVersion = data.get('version')
  if (!(file instanceof File) || data.getAll('file').length !== 1 ||
    data.getAll('version').length !== 1 || typeof rawVersion !== 'string' ||
    !/^(0|[1-9]\d*)$/.test(rawVersion) ||
    [...data.keys()].some((key) => key !== 'file' && key !== 'version'))
    return c.json({ error: 'invalid_logo' }, 400)
  if (file.size > VENUE_LOGO_MAX_BYTES) return c.json({ error: 'logo_too_large' }, 413)
  const parsed = venueLogoMutationSchema.safeParse({ version: Number(rawVersion) })
  if (!parsed.success) return c.json({ error: 'invalid_logo' }, 400)
  return c.json(await mutateVenueLogo(c.env, actor, venueId, parsed.data.version, key, file))
})
staffRoutes.delete('/venues/:id/logo', async (c) => {
  const actor = c.get('actor'), venueId = c.req.param('id')
  await venueLogoAccess(c.env, actor, venueId, true)
  if (!venueLogosEnabled(c.env)) return c.json({ error: 'venue_logos_disabled' }, 503)
  const key = uuid(c.req.header('Idempotency-Key'))
  const parsed = venueLogoMutationSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_logo' }, 400)
  return c.json(await mutateVenueLogo(c.env, actor, venueId, parsed.data.version, key, null))
})
staffRoutes.get('/me', async (c) => {
  const user = c.get('actor')
  const venues = await c.env.DB.prepare(
    `SELECT v.id,v.name,v.timezone,v.organization_id AS organizationId,o.name AS organizationName,vm.role,v.logo_key,v.logo_name,v.logo_type,v.logo_size,v.logo_version,t.created_by FROM venue v JOIN organization o ON o.id=v.organization_id JOIN tenant_account t ON t.organization_id=o.id JOIN venue_membership vm ON vm.venue_id=v.id JOIN member m ON m.organizationId=o.id AND m.userId=vm.user_id WHERE vm.user_id=? AND vm.active=1 AND t.status='active' ORDER BY v.name`,
  )
    .bind(user.id)
    .all<{ id: string; name: string; timezone: string; organizationId: string; organizationName: string; role: string; created_by: string; logo_key: string | null; logo_name: string | null; logo_type: 'image/png' | 'image/jpeg' | null; logo_size: number | null; logo_version: number }>()
  return c.json({
    user: { id: user.id, email: user.email, username: user.username },
    commercial: isCommercial(user.role),
    platformAdmin: user.role === 'platform_admin',
    features: { venueLogos: venueLogosEnabled(c.env), metrics: c.env.METRICS_DASHBOARD_ENABLED === 'true' && (isCommercial(user.role) || venues.results.some((v) => permits(v.role, 'metrics.read'))) },
    venues: venues.results.map((row) => ({
      id: row.id, name: row.name, organizationId: row.organizationId,
      organizationName: row.organizationName, role: row.role, timezone: row.timezone,
      canReadMetrics: c.env.METRICS_DASHBOARD_ENABLED === 'true' && permits(row.role, 'metrics.read'),
      ...venueLogoFields(c.env, row, row.role === 'owner' || user.role === 'platform_admin' ||
        (user.role === 'commercial_operator' && row.created_by === user.id)),
    })),
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
staffRoutes.get('/venues/:id/metrics', async (c) => {
  const query = venueMetricsQuerySchema.safeParse(c.req.query())
  if (!query.success) return c.json({ error: 'invalid_metrics_query' }, 400)
  return c.json(await readVenueMetrics(c.env, c.get('actor'), c.req.param('id'), query.data))
})
staffRoutes.get('/commercial/metrics/venues', async (c) => {
  const page = z.coerce.number().int().min(1).max(100000).safeParse(c.req.query('page') ?? 1)
  if (!page.success) return c.json({ error: 'invalid_page' }, 400)
  return c.json(await metricsVenuePage(c.env, c.get('actor'), page.data))
})
staffRoutes.get('/commercial/metrics', async (c) => {
  const query = metricsQuerySchema.safeParse(c.req.query())
  if (!query.success) return c.json({ error: 'invalid_metrics_query' }, 400)
  return c.json(await readMetrics(c.env, c.get('actor'), query.data))
})
staffRoutes.get('/commercial/organizations', async (c) => {
  commercial(c.get('actor').role)
  const rawPage = c.req.query('page') ?? '1'
  const page = Number(rawPage)
  if (
    !/^[1-9]\d*$/.test(rawPage) ||
    !Number.isSafeInteger(page) ||
    page > Math.floor(Number.MAX_SAFE_INTEGER / 24)
  )
    return c.json({ error: 'invalid_page' }, 400)
  const status = c.req.query('status')
  if (status && status !== 'active' && status !== 'suspended')
    return c.json({ error: 'invalid_status' }, 400)
  const q = (c.req.query('q') ?? '').trim()
  const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'
  const rows = await c.env.DB.prepare(
    `SELECT o.id,o.name,o.slug,t.status,v.id AS venueId,v.name AS venueName,
      (SELECT COUNT(*) FROM queue q WHERE q.venue_id=v.id) AS serviceCount,
      v.configuration_updated_at AS configurationUpdatedAt
      FROM organization o JOIN tenant_account t ON t.organization_id=o.id JOIN venue v ON v.organization_id=o.id
      WHERE (t.created_by=? OR ?='platform_admin') AND (?='' OR t.status=?)
      AND (v.name LIKE ? ESCAPE '\\' OR o.name LIKE ? ESCAPE '\\')
      ORDER BY o.createdAt DESC,o.id,v.id LIMIT 25 OFFSET ?`,
  )
    .bind(
      c.get('actor').id,
      c.get('actor').role,
      status ?? '',
      status ?? '',
      pattern,
      pattern,
      (page - 1) * 24,
    )
    .all()
  return c.json({
    items: rows.results.slice(0, 24),
    page,
    hasMore: rows.results.length > 24,
  })
})
staffRoutes.get('/commercial/venues/:id', async (c) => {
  const actor = c.get('actor')
  commercial(actor.role)
  const venue = await c.env.DB.prepare(
    `SELECT v.id,v.name,v.organization_id AS organizationId,o.name AS organizationName FROM venue v JOIN organization o ON o.id=v.organization_id JOIN tenant_account t ON t.organization_id=o.id WHERE v.id=? AND (t.created_by=? OR ?='platform_admin')`,
  )
    .bind(c.req.param('id'), actor.id, actor.role)
    .first()
  if (!venue) throw new HTTPException(404, { message: 'not_found' })
  return c.json({ ...venue, ...await readVenueLogo(c.env, actor, c.req.param('id')) })
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
function memberActorAccessSql(role: string) {
  return isCommercial(role)
    ? `EXISTS (SELECT 1 FROM user manager JOIN venue v JOIN tenant_account t ON t.organization_id=v.organization_id WHERE manager.id=? AND v.id=? AND manager.role IN ('commercial_operator','platform_admin') AND (t.created_by=manager.id OR manager.role='platform_admin') AND COALESCE(manager.banned,0)=0)`
    : `EXISTS (SELECT 1 FROM venue_membership av JOIN venue v ON v.id=av.venue_id JOIN member am ON am.organizationId=v.organization_id AND am.userId=av.user_id JOIN user manager ON manager.id=av.user_id JOIN tenant_account t ON t.organization_id=v.organization_id WHERE av.user_id=? AND av.venue_id=? AND av.active=1 AND av.role='owner' AND t.status='active' AND COALESCE(manager.banned,0)=0)`
}
// Count all grants, including revoked ones: a shared identity is never venue-local.
const editableMemberSql = `u.role='user' AND vm.role!='owner' AND u.id!=?
  AND (SELECT COUNT(*) FROM member WHERE userId=u.id)=1
  AND (SELECT COUNT(*) FROM venue_membership WHERE user_id=u.id)=1
  AND EXISTS (SELECT 1 FROM member m JOIN venue v ON v.organization_id=m.organizationId WHERE m.userId=u.id AND v.id=vm.venue_id)`
staffRoutes.get('/venues/:id/members', async (c) => {
  await canManage(c, c.req.param('id'))
  const rows = await c.env.DB.prepare(
    `SELECT u.id,u.name,u.email,COALESCE(u.username,'') AS username,vm.role,vm.active,
      (${editableMemberSql}) AS canEditDetails
      FROM venue_membership vm JOIN user u ON u.id=vm.user_id WHERE vm.venue_id=? ORDER BY u.name`,
  )
    .bind(c.get('actor').id, c.req.param('id'))
    .all<
      Omit<StaffMember, 'canEditDetails' | 'queueIds'> & {
        email: string
        canEditDetails: number
      }
    >()
  const grants = await c.env.DB.prepare(
    'SELECT user_id,queue_id FROM staff_queue_assignment WHERE venue_id=? ORDER BY queue_id',
  )
    .bind(c.req.param('id'))
    .all<{ user_id: string; queue_id: string }>()
  const queueIds = new Map<string, string[]>()
  for (const grant of grants.results) {
    const ids = queueIds.get(grant.user_id) ?? []
    ids.push(grant.queue_id)
    queueIds.set(grant.user_id, ids)
  }
  return c.json({
    members: rows.results.map((row) => ({
      ...row,
      queueIds: row.role === 'queue_staff' ? queueIds.get(row.id) ?? [] : [],
      canEditDetails: !!row.canEditDetails,
    })),
  })
})
staffRoutes.post('/venues/:id/members', async (c) => {
  const access = await canManage(c, c.req.param('id'))
  const parsed = inviteSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_member' }, 400)
  const { username, password, name, role, queueIds } = parsed.data
  await validateQueueIds(c.env, c.req.param('id'), queueIds)
  const auditId = crypto.randomUUID()
  const id = crypto.randomUUID()
  try {
    await c.env.DB.batch([
      // NULL target aborts the entire batch if authority was revoked after canManage.
      c.env.DB.prepare(
        `INSERT INTO staff_audit VALUES (?,?,?,?,?,CASE WHEN ${memberActorAccessSql(
          c.get('actor').role,
        )} THEN ? ELSE NULL END,?)`,
      ).bind(
        auditId,
        c.get('actor').id,
        access.organizationId,
        c.req.param('id'),
        'member.created',
        c.get('actor').id,
        c.req.param('id'),
        id,
        Date.now(),
      ),
      ...(await credentialStatements(c.env, id, name, username, password)),
      ...membershipStatements(
        c.env,
        id,
        access.organizationId,
        c.req.param('id'),
        role,
      ),
      ...replaceQueueAssignments(
        c.env,
        id,
        c.req.param('id'),
        queueIds,
        auditId,
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
staffRoutes.patch('/venues/:id/members/:userId/details', async (c) => {
  const venueId = c.req.param('id'),
    targetId = c.req.param('userId'),
    actor = c.get('actor')
  const access = await canManage(c, venueId)
  const parsed = memberDetailsSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_member' }, 400)
  const eligible = await c.env.DB.prepare(
    `SELECT u.id FROM venue_membership vm JOIN user u ON u.id=vm.user_id WHERE ${editableMemberSql} AND vm.venue_id=? AND u.id=?`,
  )
    .bind(actor.id, venueId, targetId)
    .first()
  if (!eligible)
    throw new HTTPException(403, { message: 'member_details_forbidden' })
  const { name, username, role, queueIds } = parsed.data
  await validateQueueIds(c.env, venueId, queueIds)
  const auditId = crypto.randomUUID(),
    now = new Date().toISOString()
  // The audit row is the transaction-local eligibility gate. Every write depends
  // on it; D1 rolls the entire batch back on a uniqueness or database failure.
  // Recheck both target isolation and manager authority inside the transaction.
  const actorAccess = memberActorAccessSql(actor.role)
  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO staff_audit SELECT ?,?,?,?,?,?,? FROM venue_membership vm JOIN user u ON u.id=vm.user_id WHERE ${editableMemberSql} AND vm.venue_id=? AND u.id=? AND ${actorAccess}`,
      ).bind(
        auditId,
        actor.id,
        access.organizationId,
        venueId,
        'member.details_updated',
        targetId,
        Date.now(),
        actor.id,
        venueId,
        targetId,
        actor.id,
        venueId,
      ),
      c.env.DB.prepare(
        'DELETE FROM session WHERE userId=? AND EXISTS (SELECT 1 FROM staff_audit WHERE id=?) AND EXISTS (SELECT 1 FROM user WHERE id=? AND username IS NOT ?)',
      ).bind(targetId, auditId, targetId, username),
      c.env.DB.prepare(
        'UPDATE user SET name=?,username=?,displayUsername=?,updatedAt=? WHERE id=? AND EXISTS (SELECT 1 FROM staff_audit WHERE id=?)',
      ).bind(name, username, username, now, targetId, auditId),
      c.env.DB.prepare(
        'UPDATE venue_membership SET role=? WHERE user_id=? AND venue_id=? AND EXISTS (SELECT 1 FROM staff_audit WHERE id=?)',
      ).bind(role, targetId, venueId, auditId),
      ...replaceQueueAssignments(c.env, targetId, venueId, queueIds, auditId),
    ])
    if (!results[0]?.meta.changes)
      throw new HTTPException(403, { message: 'member_details_forbidden' })
  } catch (error) {
    if (
      await c.env.DB.prepare('SELECT id FROM user WHERE username=? AND id!=?')
        .bind(username, targetId)
        .first()
    )
      return c.json({ error: 'username_unavailable' }, 409)
    throw error
  }
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
    throw new HTTPException(403, {
      message: 'owner_or_self_change_forbidden',
    })
  const { role, active, queueIds } = parsed.data
  const replace = queueIds !== undefined || role !== target.role
  const nextIds = queueIds ?? []
  if (replace && !validQueueAssignment({ role, queueIds: nextIds }))
    return c.json({ error: 'invalid_queue_assignments' }, 400)
  if (replace) await validateQueueIds(c.env, c.req.param('id'), nextIds)
  const auditId = crypto.randomUUID()
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO staff_audit SELECT ?,?,?,?,?,?,? FROM venue_membership vm
       WHERE vm.user_id=? AND vm.venue_id=? AND vm.role=? AND vm.role!='owner'
       AND ${memberActorAccessSql(c.get('actor').role)}`,
    ).bind(
      auditId,
      c.get('actor').id,
      access.organizationId,
      c.req.param('id'),
      'membership.updated',
      c.req.param('userId'),
      Date.now(),
      c.req.param('userId'),
      c.req.param('id'),
      target.role,
      c.get('actor').id,
      c.req.param('id'),
    ),
    c.env.DB.prepare(
      'UPDATE venue_membership SET role=?,active=? WHERE user_id=? AND venue_id=? AND EXISTS (SELECT 1 FROM staff_audit WHERE id=?)',
    ).bind(
      role,
      Number(active),
      c.req.param('userId'),
      c.req.param('id'),
      auditId,
    ),
    ...(replace
      ? replaceQueueAssignments(
          c.env,
          c.req.param('userId'),
          c.req.param('id'),
          nextIds,
          auditId,
        )
      : []),
  ])
  if (!results[0]?.meta.changes)
    throw new HTTPException(403, { message: 'forbidden' })
  return c.json({ ok: true })
})
staffRoutes.get('/venues/:id/queues', async (c) => {
  const access = await venueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.read',
  )
  const venue = await c.env.DB.prepare('SELECT timezone FROM venue WHERE id=?')
    .bind(c.req.param('id'))
    .first<{ timezone: string }>()
  const rows = await c.env.DB.prepare(
    "SELECT id,name,venue_id AS venueId,capacity,average_minutes AS averageMinutes,open,version,config,(SELECT COUNT(*) FROM queue_entry e WHERE e.queue_id=queue.id AND e.status='waiting') AS waitingCount FROM queue WHERE venue_id=? AND (? != 'queue_staff' OR EXISTS (SELECT 1 FROM staff_queue_assignment a WHERE a.queue_id=queue.id AND a.venue_id=queue.venue_id AND a.user_id=?))",
  )
    .bind(c.req.param('id'), access.role, c.get('actor').id)
    .all<{ id: string; config: string }>()
  return c.json(
    await Promise.all(
      rows.results.map(async (row) => {
        const config = normalizeConfig(
          storedServiceSchema.parse(JSON.parse(row.config)),
        )
        return {
          ...row,
          config,
          manualJoinWhatsappRequired: manualJoinRequiresWhatsapp(c.env),
          autoReplacementEnabled: replacementEnabled(c.env),
          ...(await admissionState(c.env, row.id)),
          outsideSchedule: !serviceWindow(config, venue!.timezone).serviceOpen,
          inventoryConfirmed: await inventoryConfirmed(c.env, row.id, config),
          readiness: await readiness(c.env, row.id, config),
        }
      }),
    ),
  )
})
staffRoutes.get('/queues/:id/automation', async (c) => {
  await queueAccess(c.env, c.get('actor').id, c.req.param('id'), 'queue.read')
  const raw = c.req.query('after')
  if (raw !== undefined && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))))
    throw new HTTPException(400, { message: 'invalid_feedback_cursor' })
  c.get('readTrace').phase('coordinator')
  return c.json(await coordinator(c.env, c.req.param('id')).automation(c.req.param('id'), raw === undefined ? undefined : Number(raw)))
})
staffRoutes.get('/queues/:id/replacement-decisions', async (c) => {
  await queueAccess(c.env,c.get('actor').id,c.req.param('id'),'queue.operate')
  return c.json(await coordinator(c.env,c.req.param('id')).replacementDecisions(c.req.param('id')))
})
staffRoutes.get('/queues/:id/entries', async (c) => {
  const access = await queueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.read',
  )
  c.get('readTrace').phase('coordinator')
  await coordinator(c.env, c.req.param('id')).refresh(c.req.param('id'))
  c.get('readTrace').phase('entries_d1')
  const rows = await c.env.DB.prepare(
    `SELECT e.id,e.code,e.party_size AS partySize,e.status,e.sequence,e.version,
      e.priority_rank AS priorityRank,e.created_at AS waitingSince,
      CASE WHEN EXISTS(SELECT 1 FROM queue_event WHERE entry_id=e.id AND kind='service_ended') THEN 'service_ended' ELSE NULL END AS cancellationReason,
      e.display_name_cipher AS displayNameCipher,e.reception_service AS receptionService,e.preferred_space_id AS preferredSpaceId,
      e.called_at AS calledAt,e.arrival_deadline_at AS arrivalDeadlineAt,NULL AS resourceId,
      o.space_id AS assignedSpaceId,o.seats AS assignedSeats,
      COALESCE(r.cause,r.origin) AS replacementOrigin,r.eligible AS replacementEligible,r.result AS replacementResult,
      r.successor_entry_id AS successorId,successor.code AS successorCode,
      e.manual_only AS manualOnly,c.id AS automationId,c.capacity AS automationCapacity,c.reception_service AS automationService,c.state AS automationState,c.reason AS automationReason,
      CASE WHEN e.id=c.current_entry_id AND e.call_cycle=c.current_call_cycle THEN
        (SELECT COUNT(*) FROM queue_call_replacement attempt WHERE attempt.automation_cycle_id=c.id)
        ELSE NULL END AS automationAttempt
      FROM queue_entry e LEFT JOIN queue_assignment_observation o
      ON o.entry_id=e.id AND o.call_cycle=e.call_cycle AND o.provenance='confirmed'
        AND e.status IN ('called','completed','served')
      LEFT JOIN queue_call_replacement r ON r.entry_id=e.id AND r.call_cycle=(SELECT MAX(call_cycle) FROM queue_call_replacement WHERE entry_id=e.id)
      LEFT JOIN queue_automation_cycle c ON c.id=r.automation_cycle_id
      LEFT JOIN queue_entry successor ON successor.id=r.successor_entry_id AND successor.queue_id=e.queue_id
      WHERE e.queue_id=? ORDER BY CASE WHEN e.status IN ('waiting','called','completed') THEN 0 ELSE 1 END,
      CASE WHEN e.status='waiting' AND e.priority_rank IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN e.status='waiting' THEN e.priority_rank ELSE NULL END,
      CASE WHEN e.status IN ('waiting','called','completed') THEN e.sequence ELSE -e.sequence END LIMIT 500`,
  )
    .bind(c.req.param('id'))
    .all()
  const stored = await c.env.DB.prepare('SELECT config FROM queue WHERE id=?')
    .bind(c.req.param('id'))
    .first<{ config: string | null }>()
  const parsedConfig = storedServiceSchema.safeParse(
    stored?.config ? JSON.parse(stored.config) : null,
  )
  const config = parsedConfig.success
    ? normalizeConfig(parsedConfig.data)
    : null
  const state = await loadQueueState(c.env, c.req.param('id'))
  const resourceSpaces = new Map<string, string>()
  for (const space of config?.spaces ?? [])
    for (const type of space.tableTypes?.length
      ? space.tableTypes
      : [{ seats: 100, count: space.tables }])
      for (let index = 0; index < type.count; index++)
        resourceSpaces.set(`${space.id}:${type.seats}:${index}`, space.id!)
  return c.json(
    await Promise.all(
      rows.results.map(async (row) => {
        const {
          displayNameCipher,
          assignedSpaceId,
          assignedSeats,
          cancellationReason,
          manualOnly, automationId, automationCapacity, automationService, automationState, automationReason, automationAttempt,
          replacementOrigin, replacementEligible, replacementResult, successorId, successorCode,
          ...entry
        } = row
        const projection =
          row.status === 'waiting' && !row.manualOnly
            ? await readProjection(c.env, String(row.id))
            : null
        const waitProjection =
          row.status === 'waiting' && !row.manualOnly
            ? await readProjection(c.env, String(row.id), true)
            : null
        const preferred =
          row.preferredSpaceId && row.preferredSpaceId !== 'fastest'
            ? String(row.preferredSpaceId)
            : null
        // Exact generated identity matching also supports space IDs containing colons.
        const predicted = projection?.resourceId
          ? resourceSpaces.get(projection.resourceId)
          : null
        const spaceId = assignedSpaceId ?? preferred ?? predicted
        const space = config?.spaces.find((space) => space.id === spaceId)
        return {
          ...entry,
          manualOnly: !!manualOnly,
          automationCycle: automationId ? { id: automationId, capacity: automationCapacity, receptionService: automationService, state: automationState, reason: automationReason,
            ...(automationAttempt == null ? {} : { attempt: Number(automationAttempt) }),
          } : null,
          automaticReplacement: replacementOrigin ? {
            origin: replacementOrigin, eligible: !!replacementEligible, result: replacementResult,
            successor: successorId && successorCode ? { id: String(successorId), code: String(successorCode) } : null,
          } : null,
          assignedSeating:
            assignedSpaceId && assignedSeats != null
              ? {
                  spaceId: String(assignedSpaceId),
                  seats: Number(assignedSeats),
                  spaceName: space?.name ?? 'Espacio ya no configurado',
                }
              : null,
          ...(cancellationReason ? { cancellationReason } : {}),
          ...projection,
          ...(row.status === 'waiting'
            ? {
                waitEstimate: {
                  predictedAt: waitProjection?.predictedAt ?? null,
                  estimateQuality: waitProjection?.estimateQuality ?? 'unknown',
                },
              }
            : {}),
          allowedActions: allowedEntryActions(
            config?.type ?? 'reception',
            String(row.status),
            !isCommercial(c.get('actor').role) &&
              roleCapabilities[access.role].includes('queue.operate'),
          ).filter(action => !manualOnly || (action !== 'prioritize' && (action !== 'pass' || row.status === 'called'))),
          ...(row.status === 'waiting'
            ? {
                assignment: await assignmentContext(
                  row.manualOnly ? { ...state, parties: [...state.parties, { id: String(row.id), sequence: Number(row.sequence), version: Number(row.version), partySize: Number(row.partySize), preferredSpaceId: row.preferredSpaceId == null ? null : String(row.preferredSpaceId) }] } : state,
                  String(row.id),
                  Date.now(),
                ),
              }
            : {}),
          displayName: displayNameCipher
            ? await decryptDisplayName(
                c.env.PII_ENCRYPTION_KEY,
                String(displayNameCipher),
              )
            : null,
          space: space
            ? {
                id: space.id,
                name: space.name,
                source: assignedSpaceId
                  ? 'assigned'
                  : preferred
                  ? 'preferred'
                  : 'predicted',
              }
            : null,
        }
      }),
    ),
  )
})
function coordinator(env: CloudflareBindings, id: string) {
  return (
    env.APP_ENV === 'local'
      ? env.QUEUE_COORDINATOR
      : env.QUEUE_COORDINATOR.jurisdiction('eu')
  ).getByName(id)
}
staffRoutes.post('/queues/:id/entries', async (c) => {
  await queueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.operate',
  )
  const input = manualJoinSchema.safeParse(await c.req.json())
  if (!input.success) return c.json({ error: 'invalid_join' }, 400)
  const result = await coordinator(c.env, c.req.param('id')).staffJoin(
    c.get('actor').id,
    c.req.param('id'),
    uuid(c.req.header('Idempotency-Key')),
    input.data,
  )
  return c.json(result.body, result.status as 200)
})
staffRoutes.post('/queues/:id/commands', async (c) => {
  await queueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.operate',
  )
  const raw = await c.req.json()
  if (raw?.action === 'release')
    return c.json({ error: 'operation_retired' }, 410)
  const input = queueCommandSchema.safeParse(raw)
  if (!input.success) return c.json({ error: 'invalid_command' }, 400)
  const result = await coordinator(c.env, c.req.param('id')).staffCommand(
    c.get('actor').id,
    c.req.param('id'),
    uuid(c.req.header('Idempotency-Key')),
    input.data,
  )
  return c.json(result.body, result.status as 200)
})
staffRoutes.get('/queues/:id/opening-context', async (c) => {
  await queueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.operate',
  )
  return c.json(
    await coordinator(c.env, c.req.param('id')).openingContext(
      c.req.param('id'),
    ),
  )
})
staffRoutes.post('/queues/:id/lifecycle', async (c) => {
  await queueAccess(
    c.env,
    c.get('actor').id,
    c.req.param('id'),
    'queue.operate',
  )
  const raw = await c.req.json()
  if (['release_unit', 'occupancy', 'confirm_inventory'].includes(raw?.action))
    return c.json({ error: 'operation_retired' }, 410)
  const input = queueLifecycleSchema.safeParse(raw)
  if (!input.success) return c.json({ error: 'invalid_inventory' }, 400)
  const result = await coordinator(c.env, c.req.param('id')).lifecycle(
    c.get('actor').id,
    c.req.param('id'),
    uuid(c.req.header('Idempotency-Key')),
    input.data,
  )
  return c.json(result.body, result.status as 200)
})
staffRoutes.get('/queues/:id/configuration-context', async (c) => {
  const actor = c.get('actor').id
  const queueId = c.req.param('id')
  await queueAccess(c.env, actor, queueId, 'queue.configure')
  return c.json(await coordinator(c.env, queueId).configurationContext(actor, queueId))
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
staffRoutes.get('/queues/:id/delivery-trace', async (c) => {
  await queueAccess(c.env, c.get('actor').id, c.req.param('id'), 'queue.read')
  const queueId = c.req.param('id')
  const since = Date.now() - deliveryRetentionMs
  const rows = await c.env.DB.prepare(
    `SELECT t.id,e.code,n.kind,t.event,t.attempt,t.http_status AS httpStatus,t.provider_code AS providerCode,t.occurred_at AS occurredAt,t.recorded_at AS recordedAt
    FROM notification_trace t JOIN notification_outbox n ON n.id=t.notification_id JOIN queue_entry e ON e.id=n.entry_id
    WHERE e.queue_id=? AND t.recorded_at>=? ORDER BY t.recorded_at DESC,t.id LIMIT 200`,
  )
    .bind(queueId, since)
    .all()
  return c.json({
    summary: await notificationDeliverySummary(c.env, queueId, since),
    events: rows.results,
  })
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
  if (
    parsed.data.intelligencePolicy === 'disabled' ||
    parsed.data.resourceStateKnown ||
    parsed.data.estimationMode === 'active'
  )
    throw new HTTPException(400, {
      message: 'operational_initialization_required',
    })
  if (parsed.data.adjustments?.length)
    await venueAccess(
      c.env,
      c.get('actor').id,
      c.req.param('id'),
      'queue.operate',
    )
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
    service = normalizeConfig(parsed.data)
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
      directoryConfigStatement(c.env, id, JSON.stringify(service)),
      touchVenueConfiguration(c.env, c.req.param('id')),
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
      'UPDATE venue SET configuration_updated_at=? WHERE organization_id=? AND EXISTS (SELECT 1 FROM tenant_account WHERE organization_id=? AND status IS NOT ?)',
    ).bind(
      Date.now(),
      c.req.param('id'),
      c.req.param('id'),
      parsed.data.status,
    ),
    c.env.DB.prepare(
      'UPDATE tenant_account SET status=? WHERE organization_id=? AND status IS NOT ?',
    ).bind(parsed.data.status, c.req.param('id'), parsed.data.status),
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
