import {
  publicAdmission,
  resolveAdmission,
  type AdmissionRecord,
} from '../staff/availability'
import type { ServiceInput } from '@noqueue/contracts/staff'
import type {
  PublicSearchInput,
  PublicSearchResult,
} from '@noqueue/contracts/discovery'

const radians = Math.PI / 180
const radiusMeters = 5000
function matchExpression(text: string) {
  // Users never supply FTS operators. Each Unicode word is an escaped literal prefix.
  return (text.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((word) => `"${word}"*`)
    .join(' AND ')
}
export async function searchServices(
  env: CloudflareBindings,
  input: PublicSearchInput,
  now = Date.now(),
) {
  const values: (string | number)[] = []
  const filters = [
    "t.status='active'",
    'v.location_confirmed_at IS NOT NULL',
    'v.address_formatted IS NOT NULL',
    'v.latitude IS NOT NULL',
    'v.longitude IS NOT NULL',
  ]
  let distanceSql = 'NULL'
  if (input.coordinates) {
    const { latitude, longitude } = input.coordinates
    // Clamp floating point error so coincident/antipodal coordinates remain finite.
    distanceSql =
      '2*6371000*asin(sqrt(min(1,max(0,pow(sin((v.latitude-?)*?/2),2)+cos(?*?)*cos(v.latitude*?)*pow(sin((v.longitude-?)*?/2),2)))))'
    values.push(
      latitude,
      radians,
      latitude,
      radians,
      radians,
      longitude,
      radians,
    )
  }
  values.push(now, now - 120000, now)
  if (input.scope === 'nearby' && !input.text) {
    const { latitude, longitude } = input.coordinates!
    const latDelta = radiusMeters / 111000,
      lonDelta = latDelta / Math.max(0.000001, Math.cos(latitude * radians))
    filters.push('v.latitude BETWEEN ? AND ?')
    values.push(latitude - latDelta, latitude + latDelta)
    if (
      lonDelta < 180 &&
      longitude - lonDelta >= -180 &&
      longitude + lonDelta <= 180
    ) {
      filters.push('v.longitude BETWEEN ? AND ?')
      values.push(longitude - lonDelta, longitude + lonDelta)
    }
  }
  if (input.type) {
    filters.push("json_extract(d.normalized_config,'$.type')=?")
    values.push(input.type)
  }
  if (input.text) {
    const match = matchExpression(input.text)
    if (!match) return { items: [], page: input.page, hasMore: false }
    filters.push(
      'q.id IN (SELECT queue_id FROM service_search WHERE service_search MATCH ?)',
    )
    values.push(match)
  }
  if (input.recentIds) {
    if (!input.recentIds.length)
      return { items: [], page: input.page, hasMore: false }
    filters.push(`q.id IN (${input.recentIds.map(() => '?').join(',')})`)
    values.push(...input.recentIds)
  }
  const within =
    input.scope === 'nearby' && !input.text ? 'distanceMeters<=5000' : '1'
  const result = await env.DB.prepare(
    `
    WITH candidates AS (
      SELECT q.id,v.id venueId,q.name,v.name venueName,json_extract(d.normalized_config,'$.type') type,
        v.address_formatted address,v.location_attribution attribution,v.timezone,d.normalized_config config,
        a.window_id,a.override_state,a.activated_at,a.reminder_ack,a.legacy_paused_at,a.legacy_config,a.legacy_timezone,
        (SELECT COALESCE(SUM(party_size),0) FROM queue_entry WHERE queue_id=q.id AND status='waiting') waitingPeople,
        (SELECT COUNT(*) FROM queue_entry WHERE queue_id=q.id AND status='waiting') waitingCount,
        ${distanceSql} distanceMeters,
        (SELECT ROUND(AVG(max(0,(p.predicted_at-?)/60000.0))) FROM queue_entry e JOIN queue_projection p ON p.entry_id=e.id
          WHERE e.queue_id=q.id AND e.status='waiting' AND p.quality IN ('estimated','provisional')
            AND p.predicted_at IS NOT NULL AND p.updated_at>=? AND p.updated_at<=?) predictedWait
      FROM venue v JOIN queue q ON q.venue_id=v.id
        JOIN service_directory_config d ON d.queue_id=q.id AND d.source_config=q.config AND d.normalized_config IS NOT NULL
        JOIN tenant_account t ON t.organization_id=v.organization_id
        LEFT JOIN queue_admission a ON a.queue_id=q.id
      WHERE ${filters.join(' AND ')}
    ) SELECT * FROM candidates WHERE ${within}
  `,
  )
    .bind(...values)
    .all<
      Omit<PublicSearchResult, 'open' | 'attribution'> &
        AdmissionRecord & {
          config: string
          timezone: string
          predictedWait: number | null
          attribution: string
          waitingPeople: number
          waitingCount: number
        }
    >()
  const items = result.results.map((row) => {
    const config = JSON.parse(row.config) as ServiceInput
    const admission = resolveAdmission(
      config,
      row.timezone,
      row,
      row.waitingPeople,
      new Date(now),
      row.waitingCount,
    )
    const direct =
      admission.serviceOpen &&
      admission.queueState === 'inactive' &&
      row.waitingPeople === 0
    return {
      id: row.id,
      venueId: row.venueId,
      name: row.name,
      venueName: row.venueName,
      type: row.type,
      address: row.address,
      distanceMeters: row.distanceMeters,
      attribution: JSON.parse(
        row.attribution,
      ) as PublicSearchResult['attribution'],
      ...publicAdmission(admission),
      open: admission.canJoin,
      waitMinutes: direct
        ? 0
        : admission.serviceOpen && admission.queueState !== 'paused'
        ? row.predictedWait
        : null,
    }
  })
  const rank = (i: (typeof items)[number]) =>
    !i.serviceOpen || i.queueState === 'paused'
      ? 2
      : i.waitMinutes === null
      ? 1
      : 0
  items.sort((a, b) =>
    input.recentIds
      ? input.recentIds.indexOf(a.id) - input.recentIds.indexOf(b.id)
      : input.sort === 'distance'
      ? (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) ||
        a.id.localeCompare(b.id)
      : rank(a) - rank(b) ||
        (a.waitMinutes ?? Infinity) - (b.waitMinutes ?? Infinity) ||
        a.id.localeCompare(b.id),
  )
  const offset = (input.page - 1) * input.pageSize
  return {
    items: items.slice(offset, offset + input.pageSize),
    page: input.page,
    hasMore: items.length > offset + input.pageSize,
  }
}
