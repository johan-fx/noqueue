import { cadenceFactor } from './adaptive-model'
import { venueLogoUrl } from '../../lib/venue-logo'
import type { PublicService } from '@noqueue/contracts/queue'
import { storedServiceSchema as serviceSchema } from '@noqueue/contracts/staff'
import { customerDeadlineSql, customerProvisionalSql, publicCustomerAverage } from './customer-estimate'
import { normalizeConfig } from './projection'
import { admissionState, publicAdmission, validWaitingSql, includesLegacyWaiting } from '../staff/availability'

export async function publicService(env: CloudflareBindings, id: string): Promise<PublicService | null> {
  const now = Date.now()
  const row = await env.DB.prepare(
    `SELECT q.id,q.name,q.open,q.config,v.id AS venueId,v.name AS venueName,v.logo_key,v.timezone FROM queue q JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id WHERE q.id=? AND q.config IS NOT NULL AND t.status='active'`,
  )
    .bind(id)
    .first<{
      id: string
      name: string
      open: number
      config: string
      venueId: string
      venueName: string
      logo_key: string | null
      timezone: string
    }>()
  if (!row) return null
  const config = normalizeConfig(serviceSchema.parse(JSON.parse(row.config)))
  const admission = await admissionState(env, id, new Date(now))
  const eligible = validWaitingSql(now, includesLegacyWaiting(config, row.timezone, new Date(now)), 'e')
  const deadline = customerDeadlineSql(now)
  const estimate = await env.DB.prepare(
    `SELECT COALESCE(SUM(MAX(0,(${deadline}-?)/60000.0)),0) AS sum,COUNT(${deadline}) AS count,MAX(${customerProvisionalSql(now)}) AS provisional FROM queue_entry e JOIN queue_projection p ON p.entry_id=e.id WHERE e.queue_id=? AND ${eligible} AND p.updated_at>=? AND p.updated_at<=?`,
  ).bind(now, id, now - 120000, now).first<{ sum: number; count: number; provisional: number }>()
  const ratios = config.estimatorVersion === 2 ? (await env.DB.prepare(
    'SELECT ratio FROM queue_assignment_observation WHERE queue_id=? AND ratio IS NOT NULL ORDER BY assigned_at DESC,rowid DESC LIMIT 30',
  ).bind(id).all<{ratio:number}>()).results.reverse().map(r => r.ratio) : []
  const initialMinutes = config.estimatorVersion === 2 ? Math.max(0.25,config.averageMinutes*cadenceFactor(ratios)) : config.averageMinutes
  return {
    ...publicCustomerAverage({ sum: estimate?.sum ?? 0, count: estimate?.count ?? 0, provisional: !!estimate?.provisional, waiting: admission?.waitingPeople ?? 0, active: !!admission?.serviceOpen && admission.queueState === 'active', configuredMinutes: initialMinutes, adaptive:config.estimatorVersion === 2 }),
    ...(admission ? publicAdmission(admission) : {}),
    id: row.id,
    name: row.name,
    venueId: row.venueId,
    venueName: row.venueName,
    venueLogoUrl: venueLogoUrl(env, row.logo_key),
    open: Number(admission?.canJoin ?? false),
    type: config.type,
    receptionServices: config.receptionServices,
    spaces: config.spaces.map((space) => ({
      id: space.id!,
      name: space.name,
      maxPartySize: space.tableTypes?.length
        ? Math.max(...space.tableTypes.map((t) => t.seats))
        : 20,
    })),
  }
}
