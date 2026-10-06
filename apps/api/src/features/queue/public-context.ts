import { serviceSchema } from '@noqueue/contracts/staff'
import { normalizeConfig } from './projection'
import { serviceAcceptsEntries } from '../staff/availability'

export async function publicService(env: CloudflareBindings, id: string) {
  const row = await env.DB.prepare(
    `SELECT q.id,q.name,q.open,q.config,v.id AS venueId,v.name AS venueName,v.timezone FROM queue q JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id WHERE q.id=? AND q.config IS NOT NULL AND t.status='active'`,
  )
    .bind(id)
    .first<{
      id: string
      name: string
      open: number
      config: string
      venueId: string
      venueName: string
      timezone: string
    }>()
  if (!row) return null
  const config = normalizeConfig(serviceSchema.parse(JSON.parse(row.config)))
  return {
    id: row.id,
    name: row.name,
    venueId: row.venueId,
    venueName: row.venueName,
    open: Number(!!row.open && serviceAcceptsEntries(config, row.timezone)),
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
