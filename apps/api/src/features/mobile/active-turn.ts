import { recoveryToken } from '../queue/crypto'

export async function activeMobileRows(env: CloudflareBindings, installationHash: string) {
  const rows = await env.DB.prepare(`SELECT e.id,e.queue_id,e.locale,t.status AS tenant_status
    FROM mobile_entry_installation m JOIN queue_entry e ON e.id=m.entry_id
    JOIN queue q ON q.id=e.queue_id JOIN venue v ON v.id=q.venue_id
    JOIN tenant_account t ON t.organization_id=v.organization_id
    WHERE m.installation_hash=? AND e.status IN ('waiting','called')
    ORDER BY e.created_at,e.id LIMIT 2`).bind(installationHash)
    .all<{ id: string; queue_id: string; locale: string; tenant_status: string }>()
  return rows.results
}
export async function mobileActiveConflict(env: CloudflareBindings, installationHash: string) {
  const rows = await activeMobileRows(env, installationHash)
  if (!rows.length) return null
  // No arbitrary winner and no capabilities/data from suspended establishments.
  if (rows.length > 1) return { status: 409 as const, body: { error: 'active_turn_inconsistent' } }
  const row = rows[0]!
  if (row.tenant_status !== 'active') return { status: 409 as const, body: { error: 'active_turn_unavailable' } }
  return { status: 409 as const, body: { error: 'active_turn_exists', entry: {
    serviceId: row.queue_id, locale: row.locale, recoveryToken: await recoveryToken(env, row.id),
  } } }
}
export function isMobileActiveConstraint(error: unknown): boolean {
  return error instanceof Error && (error.message.includes('mobile_active_turn_exists') || isMobileActiveConstraint(error.cause))
}
