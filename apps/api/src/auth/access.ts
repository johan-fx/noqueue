import { HTTPException } from 'hono/http-exception'
import type { Capability, StaffRole } from '@noqueue/contracts/staff'
import { isCommercial, permits } from './permissions'
export async function venueAccess(
  env: CloudflareBindings,
  userId: string,
  venueId: string,
  permission: Capability,
) {
  const row = await env.DB.prepare(
    `SELECT vm.role,v.organization_id AS organizationId FROM venue_membership vm
    JOIN venue v ON v.id=vm.venue_id JOIN member m ON m.organizationId=v.organization_id AND m.userId=vm.user_id
    JOIN user u ON u.id=vm.user_id JOIN tenant_account t ON t.organization_id=v.organization_id
    WHERE vm.user_id=? AND vm.venue_id=? AND vm.active=1 AND COALESCE(u.banned,0)=0 AND t.status='active'`,
  )
    .bind(userId, venueId)
    .first<{ role: StaffRole; organizationId: string }>()
  if (!row) {
    // Sales staff have no venue membership. They may read and edit services
    // only for tenants they created. Operating the queue stays forbidden.
    const commercial = await commercialVenue(env, userId, venueId, permission)
    if (commercial) return commercial
    throw new HTTPException(404, { message: 'not_found' })
  }
  if (!permits(row.role, permission))
    throw new HTTPException(403, { message: 'forbidden' })
  return row
}
async function commercialVenue(
  env: CloudflareBindings,
  userId: string,
  venueId: string,
  permission: Capability,
) {
  if (permission !== 'queue.read' && permission !== 'queue.configure') return
  const user = await env.DB.prepare('SELECT role FROM user WHERE id=?')
    .bind(userId)
    .first<{ role: string }>()
  if (!user || !isCommercial(user.role)) return
  const owned = await env.DB.prepare(
    `SELECT v.organization_id AS organizationId FROM venue v JOIN tenant_account t ON t.organization_id=v.organization_id WHERE v.id=? AND (t.created_by=? OR ?='platform_admin')`,
  )
    .bind(venueId, userId, user.role)
    .first<{ organizationId: string }>()
  if (!owned) return
  // Callers only need the organization id. The role is not used to authorize again.
  return { role: 'owner' as StaffRole, organizationId: owned.organizationId }
}
export async function queueAccess(
  env: CloudflareBindings,
  userId: string,
  queueId: string,
  permission: Capability,
) {
  const queue = await env.DB.prepare('SELECT venue_id FROM queue WHERE id=?')
    .bind(queueId)
    .first<{ venue_id: string }>()
  if (!queue) throw new HTTPException(404, { message: 'not_found' })
  return {
    ...(await venueAccess(env, userId, queue.venue_id, permission)),
    venueId: queue.venue_id,
  }
}
export function audit(
  env: CloudflareBindings,
  actor: string,
  org: string,
  venue: string | null,
  action: string,
  target: string,
) {
  return env.DB.prepare('INSERT INTO staff_audit VALUES (?,?,?,?,?,?,?)').bind(
    crypto.randomUUID(),
    actor,
    org,
    venue,
    action,
    target,
    Date.now(),
  )
}
