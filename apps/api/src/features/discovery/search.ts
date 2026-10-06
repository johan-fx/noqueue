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
function localTime(timezone: string, now: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (key: string) => parts.find((p) => p.type === key)?.value ?? ''
  return [
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    Number(get('hour')) * 60 + Number(get('minute')),
  ]
}
export async function searchServices(
  env: CloudflareBindings,
  input: PublicSearchInput,
  now = Date.now(),
) {
  const timezones = await env.DB.prepare(
    'SELECT DISTINCT timezone FROM venue',
  ).all<{ timezone: string }>()
  const values: (string | number)[] = []
  const timezoneRows = timezones.results.map(({ timezone }) => {
    values.push(timezone, ...localTime(timezone, now))
    return '(?,?,?)'
  })
  if (!timezoneRows.length)
    return { items: [], page: input.page, hasMore: false }
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
  let order =
    input.sort === 'distance'
      ? 'distanceMeters,id'
      : 'CASE WHEN open=0 THEN 2 WHEN waitMinutes IS NULL THEN 1 ELSE 0 END,waitMinutes,id'
  if (input.recentIds) {
    order = `CASE id ${input.recentIds
      .map((_, i) => `WHEN ? THEN ${i}`)
      .join(' ')} END,id`
    values.push(...input.recentIds)
  }
  values.push(input.pageSize + 1, (input.page - 1) * input.pageSize)
  const result = await env.DB.prepare(
    `
    WITH local_time(timezone,day,minute) AS (VALUES ${timezoneRows.join(',')}),
    candidates AS (
      SELECT q.id,v.id venueId,q.name,v.name venueName,json_extract(d.normalized_config,'$.type') type,
        v.address_formatted address,v.location_attribution attribution,
        ${distanceSql} distanceMeters,
        CASE WHEN q.open=1 AND (
          json_extract(d.normalized_config,'$.twentyFourHours')=1 OR EXISTS(
            SELECT 1 FROM json_each(d.normalized_config,'$.schedules') s
            WHERE json_extract(s.value,'$.day')=lt.day
              AND lt.minute >= CAST(substr(json_extract(s.value,'$.from'),1,2) AS INTEGER)*60+CAST(substr(json_extract(s.value,'$.from'),4,2) AS INTEGER)
              AND lt.minute < CAST(substr(json_extract(s.value,'$.to'),1,2) AS INTEGER)*60+CAST(substr(json_extract(s.value,'$.to'),4,2) AS INTEGER)-COALESCE(json_extract(d.normalized_config,'$.cutoffMinutes'),0)
          )) THEN 1 ELSE 0 END open,
        (SELECT ROUND(AVG(max(0,(p.predicted_at-?)/60000.0))) FROM queue_entry e JOIN queue_projection p ON p.entry_id=e.id
          WHERE e.queue_id=q.id AND e.status='waiting' AND p.quality IN ('estimated','provisional')
            AND p.predicted_at IS NOT NULL AND p.updated_at>=? AND p.updated_at<=?) predictedWait
      FROM venue v JOIN queue q ON q.venue_id=v.id
        JOIN service_directory_config d ON d.queue_id=q.id AND d.source_config=q.config AND d.normalized_config IS NOT NULL
        JOIN tenant_account t ON t.organization_id=v.organization_id
        JOIN local_time lt ON lt.timezone=v.timezone
      WHERE ${filters.join(' AND ')}
    ), services AS (SELECT *,CASE WHEN open=1 THEN predictedWait ELSE NULL END waitMinutes FROM candidates)
    SELECT id,venueId,name,venueName,type,address,attribution,distanceMeters,open,waitMinutes FROM services
    WHERE ${within} ORDER BY ${order} LIMIT ? OFFSET ?
  `,
  )
    .bind(...values)
    .all<
      Omit<PublicSearchResult, 'open' | 'attribution'> & {
        open: number
        attribution: string
      }
    >()
  return {
    items: result.results.slice(0, input.pageSize).map((row) => ({
      ...row,
      open: !!row.open,
      attribution: JSON.parse(
        row.attribution,
      ) as PublicSearchResult['attribution'],
    })),
    page: input.page,
    hasMore: result.results.length > input.pageSize,
  }
}
