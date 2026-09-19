import { HTTPException } from 'hono/http-exception'
import type { Capability, StaffRole } from '@noqueue/contracts/staff'
import { permits } from './permissions'
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
  if (!row) throw new HTTPException(404, { message: 'not_found' })
  if (!permits(row.role, permission))
    throw new HTTPException(403, { message: 'forbidden' })
  return row
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
