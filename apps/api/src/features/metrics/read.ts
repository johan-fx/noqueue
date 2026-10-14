import { HTTPException } from 'hono/http-exception'
import type {
  MetricsQuery,
  MetricsResponse,
  MetricsPattern,
  MetricCounts,
  MetricsVenuePage,
} from '@noqueue/contracts/metrics'
import {
  comparison,
  DAY,
  emptyCounts,
  localParts,
  midnight,
  QUARTER,
  retentionDate,
  shiftDate,
  summarize,
} from './calculation'

type Actor = { id: string; role: string }
type Daily = {
  dimension: string
  queue_id: string
  venue_id: string
  name: string
  service_type: string
  timezone: string
  date: string
  generated: number
  completed: number
  cancelled: number
  no_show: number
  pending: number
  unknown: number
  wait_sum_ms: number
  wait_samples: number
  historical: number
  people_ms: number
  observed_ms: number
  first_wait_at: number | null
  last_wait_at: number | null
  coverage_since: number
  backfill_complete: number | null
}
type Hourly = {
  queue_id: string
  venue_id: string
  dimension: string
  date: string
  hour: number
  generated: number
  wait_sum_ms: number
  wait_samples: number
  people_ms: number
  observed_ms: number
  service_type: string
}
export function requireMetrics(env: CloudflareBindings, actor: Actor) {
  if (!['platform_admin', 'commercial_operator'].includes(actor.role))
    throw new HTTPException(403, { message: 'forbidden' })
  if (env.METRICS_DASHBOARD_ENABLED !== 'true')
    throw new HTTPException(404, { message: 'not_found' })
}
export async function metricsVenuePage(
  env: CloudflareBindings,
  actor: Actor,
  page: number,
): Promise<MetricsVenuePage> {
  requireMetrics(env, actor)
  const rows = await env.DB.prepare(
    `SELECT v.id,v.name,v.timezone FROM venue v JOIN tenant_account t ON t.organization_id=v.organization_id WHERE (?='platform_admin' OR t.created_by=?) ORDER BY v.name,v.id LIMIT 51 OFFSET ?`,
  )
    .bind(actor.role, actor.id, (page - 1) * 50)
    .all<{ id: string; name: string; timezone: string }>()
  return {
    items: rows.results.slice(0, 50),
    page,
    hasMore: rows.results.length > 50,
  }
}
const add = (a: MetricCounts, r: Daily) => {
  a.generated += r.generated
  a.completed += r.completed
  a.cancelled += r.cancelled
  a.noShow += r.no_show
  a.pending += r.pending
  a.unknown += r.unknown
  a.waitSumMs += r.wait_sum_ms
  a.waitSamples += r.wait_samples
  return a
}
function totals(rows: Daily[]) {
  return summarize(
    rows.reduce(add, emptyCounts()),
    new Set(rows.filter((r) => r.generated > 0).map((r) => r.queue_id)).size,
    new Set(rows.filter((r) => r.generated > 0).map((r) => r.venue_id)).size,
  )
}
function fullDay(d: Daily, now: number) {
  const start = midnight(d.date, d.timezone),
    end = midnight(shiftDate(d.date, 1), d.timezone)
  return (
    d.backfill_complete !== null &&
    end <= now &&
    d.coverage_since <= start &&
    d.observed_ms >= end - start
  )
}
function pattern(
  daily: Daily[],
  hourly: Hourly[],
  serviceType: string,
  now: number,
): MetricsPattern {
  const ds =
    serviceType === 'all'
      ? daily
      : daily.filter((r) => r.service_type === serviceType)
  const hs =
    serviceType === 'all'
      ? hourly
      : hourly.filter((r) => r.service_type === serviceType)
  const bins = Array.from({ length: 24 }, () => ({
    generated: 0,
    waitSum: 0,
    waitCount: 0,
    peopleMs: 0,
    observedMs: 0,
  }))
  const days = new Map(ds.map((d) => [`${d.dimension}:${d.date}`, d]))
  const observed = new Map<
    string,
    { hour: number; peopleMs: number; duration: number }
  >()
  for (const h of hs) {
    const b = bins[h.hour]!
    b.generated += h.generated
    b.waitSum += h.wait_sum_ms
    b.waitCount += h.wait_samples
    const d = days.get(`${h.dimension}:${h.date}`)
    if (
      d &&
      (d.generated > 0 || d.people_ms > 0) &&
      d.backfill_complete !== null &&
      d.coverage_since <= midnight(d.date, d.timezone)
    ) {
      const key = `${h.queue_id}:${h.date}:${h.hour}`,
        bucket = observed.get(key) ?? { hour: h.hour, peopleMs: 0, duration: 0 }
      bucket.peopleMs += h.people_ms
      bucket.duration = Math.max(bucket.duration, h.observed_ms)
      observed.set(key, bucket)
    }
  }
  for (const bucket of observed.values()) {
    bins[bucket.hour]!.peopleMs += bucket.peopleMs
    bins[bucket.hour]!.observedMs += bucket.duration
  }
  let peak: number | null = null
  bins.forEach((b, h) => {
    if (
      b.generated > 0 &&
      (peak === null || b.generated > bins[peak]!.generated)
    )
      peak = h
  })
  const closed = ds.filter((d) => d.first_wait_at !== null && fullDay(d, now))
  const minute = (at: number, date: string, tz: string) => {
    if (at >= midnight(shiftDate(date, 1), tz)) return 1440
    const p = localParts(at, tz)
    return p.hour * 60 + p.minute + p.second / 60
  }
  const queueDays = new Map<string, { start: number; end: number }>()
  for (const d of closed) {
    const key = `${d.queue_id}:${d.date}`
    const previous = queueDays.get(key)
    const first = minute(d.first_wait_at!, d.date, d.timezone)
    const last = minute(d.last_wait_at!, d.date, d.timezone)
    queueDays.set(key, {
      start: Math.min(previous?.start ?? first, first),
      end: Math.max(previous?.end ?? last, last),
    })
  }
  const start = [...queueDays.values()].reduce((sum, d) => sum + d.start, 0)
  const end = [...queueDays.values()].reduce((sum, d) => sum + d.end, 0)
  const p = peak === null ? null : bins[peak]!
  return {
    serviceType,
    peakHour: peak,
    peakWaitMs: p?.waitCount ? p.waitSum / p.waitCount : null,
    peakQueuePeople: p?.observedMs ? p.peopleMs / p.observedMs : null,
    startMinute: queueDays.size ? start / queueDays.size : null,
    endMinute: queueDays.size ? end / queueDays.size : null,
    observedDays: queueDays.size,
  }
}
export async function readMetrics(
  env: CloudflareBindings,
  actor: Actor,
  input: MetricsQuery,
  now = Date.now(),
): Promise<MetricsResponse> {
  requireMetrics(env, actor)
  const days = (Date.parse(input.to) - Date.parse(input.from)) / DAY + 1
  if (days < 1 || days > 366 || input.from < retentionDate(now))
    throw new HTTPException(400, { message: 'invalid_metrics_range' })
  let timezone = 'Europe/Madrid'
  if (input.venueId) {
    const venue = await env.DB.prepare(
      "SELECT v.timezone FROM venue v JOIN tenant_account t ON t.organization_id=v.organization_id WHERE v.id=? AND (?='platform_admin' OR t.created_by=?)",
    )
      .bind(input.venueId, actor.role, actor.id)
      .first<{ timezone: string }>()
    if (!venue) throw new HTTPException(404, { message: 'not_found' })
    timezone = venue.timezone
  }
  const today = localParts(now, timezone).date
  if (input.to > today)
    throw new HTTPException(400, { message: 'future_metrics_range' })
  const previous = {
    from: shiftDate(input.from, -days),
    to: shiftDate(input.from, -1),
  }
  const start = previous.from < retentionDate(now) ? input.from : previous.from
  const params = [
    actor.role,
    actor.id,
    start,
    input.to,
    ...(input.venueId ? [input.venueId] : []),
    ...(input.serviceType ? [input.serviceType] : []),
  ]
  const scope = `(?='platform_admin' OR t.created_by=?) AND d.date>=? AND d.date<=?${
    input.venueId ? ' AND d.venue_id=?' : ''
  }${input.serviceType ? ' AND d.service_type=?' : ''}`
  // Authorization precedes aggregation; these queries only read bounded rollup partitions.
  const dailyQuery = env.DB.prepare(
    `SELECT d.*,v.name,b.completed_at AS backfill_complete,MAX(q.coverage_since,COALESCE(b.completed_at,q.coverage_since)) AS coverage_since FROM metrics_daily d INDEXED BY ${
      input.venueId ? 'metrics_daily_scope' : 'metrics_daily_date'
    } JOIN venue v ON v.id=d.venue_id JOIN tenant_account t ON t.organization_id=d.organization_id JOIN metrics_queue q ON q.dimension=d.dimension LEFT JOIN metrics_backfill b ON b.queue_id=d.queue_id WHERE ${scope} ORDER BY d.date`,
  ).bind(...params)
  const hourlyQuery = env.DB.prepare(
    `SELECT d.queue_id,d.venue_id,d.dimension,d.date,d.hour,d.service_type,SUM(d.generated) generated,SUM(d.wait_sum_ms) wait_sum_ms,SUM(d.wait_samples) wait_samples,SUM(d.people_ms) people_ms,SUM(d.observed_ms) observed_ms FROM metrics_hourly d INDEXED BY ${
      input.venueId ? 'metrics_hourly_scope' : 'metrics_hourly_date'
    } JOIN tenant_account t ON t.organization_id=d.organization_id WHERE ${scope} GROUP BY d.dimension,d.date,d.hour`,
  ).bind(...params)
  // D1 batch is one transaction: rollups, coverage and publication metadata cannot
  // come from different commits even if a processor finishes while the request runs.
  const snapshot = await env.DB.batch([
    dailyQuery,
    hourlyQuery,
    env.DB.prepare(
      'SELECT last_complete_at,target_at FROM metrics_control WHERE id=1',
    ),
    env.DB.prepare(
      'SELECT MIN(started_at) AS since,MAX(COALESCE(ended_at,?)) AS until FROM metrics_capture_gap',
    ).bind(now),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM queue q JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id LEFT JOIN metrics_backfill b ON b.queue_id=q.id WHERE q.id!='confirmation-experiment' AND (?='platform_admin' OR t.created_by=?) AND b.completed_at IS NULL${
        input.venueId ? ' AND v.id=?' : ''
      }`,
    ).bind(actor.role, actor.id, ...(input.venueId ? [input.venueId] : [])),
  ])
  const daily = snapshot[0] as D1Result<Daily>
  const hourly = snapshot[1] as D1Result<Hourly>
  const control = snapshot[2]!.results[0] as
    | { last_complete_at: number | null; target_at: number | null }
    | undefined
  const gap = snapshot[3]!.results[0] as
    | { since: number | null; until: number | null }
    | undefined
  const incompleteBackfill = snapshot[4]!.results[0] as
    | { n: number }
    | undefined
  const current = daily.results.filter((d) => d.date >= input.from)
  const prior = daily.results.filter((d) => d.date < input.from)
  const summary = totals(current),
    old = totals(prior)
  const provisional = input.to === today
  if (gap?.until != null) {
    for (const row of daily.results)
      row.coverage_since = Math.max(row.coverage_since, gap.until)
  }
  const quality = (rows: Daily[], from: string, to: string) =>
    rows.length === 0
      ? 'unavailable'
      : control?.target_at != null ||
        incompleteBackfill?.n ||
        rows.some(
          (d) =>
            d.historical ||
            d.coverage_since > midnight(from, d.timezone) ||
            (control?.last_complete_at ?? 0) <
              midnight(shiftDate(to, 1), d.timezone) ||
            !fullDay(d, now) ||
            (gap?.until != null && midnight(d.date, d.timezone) < gap.until),
        )
      ? 'partial'
      : 'complete'
  const coverage = quality(current, input.from, input.to),
    previousComplete =
      quality(prior, previous.from, previous.to) === 'complete' &&
      previous.from >= retentionDate(now)
  const compare = (
    a: number | null,
    b: number | null,
    unit: 'percent' | 'points' | 'absolute' = 'percent',
  ) =>
    comparison(
      a,
      coverage === 'complete' && previousComplete ? b : null,
      unit,
      provisional,
    )
  const metric = (
    value: number | null,
    priorValue: number | null,
    sampleSize: number,
    unit: 'percent' | 'points' | 'absolute' = 'percent',
  ) => ({ value, sampleSize, comparison: compare(value, priorValue, unit) })
  const groups = new Map<string, Daily[]>()
  for (const d of current) {
    const g = groups.get(d.venue_id) ?? []
    g.push(d)
    groups.set(d.venue_id, g)
  }
  const venues = [...groups]
    .filter(([, rows]) => rows.some((d) => d.generated > 0))
    .map(([venueId, rows]) => ({
      ...totals(rows),
      venueId,
      name: rows[0]!.name,
      peakHour: pattern(
        rows,
        hourly.results.filter(
          (h) => h.venue_id === venueId && h.date >= input.from,
        ),
        'all',
        now,
      ).peakHour,
    }))
    .sort(
      (a, b) => b.generated - a.generated || a.venueId.localeCompare(b.venueId),
    )
  const trend = new Map<
    string,
    { date: string; generated: number | null; completed: number | null }
  >()
  for (let date = input.from; date <= input.to; date = shiftDate(date, 1))
    trend.set(date, { date, generated: null, completed: null })
  for (const d of current) {
    const point = trend.get(d.date)!
    const observed =
      d.coverage_since <= midnight(d.date, d.timezone) && d.observed_ms > 0
    if (d.generated > 0 || observed) {
      point.generated = (point.generated ?? 0) + d.generated
      point.completed = (point.completed ?? 0) + d.completed
    }
  }
  const currentHours = hourly.results.filter((h) => h.date >= input.from)
  const services = [
    'reception',
    'restaurant',
    'pool',
    ...(current.some((d) => d.service_type === 'unknown') ? ['unknown'] : []),
  ]
  const lastCompleteAt = control?.last_complete_at ?? null
  return {
    period: { from: input.from, to: input.to, timezone, previous, provisional },
    summary,
    executive: {
      completed: metric(
        coverage === 'unavailable' ? null : summary.completed,
        old.completed,
        summary.generated,
      ),
      meanWaitMs: metric(
        summary.meanWaitMs,
        old.meanWaitMs,
        summary.waitSamples,
      ),
      attentionRate: metric(
        summary.attentionRate,
        old.attentionRate,
        summary.completed + summary.cancelled + summary.noShow,
        'points',
      ),
      activeServices: metric(
        coverage === 'unavailable' ? null : summary.activeServices,
        old.activeServices,
        summary.generated,
        'absolute',
      ),
    },
    trend: [...trend.values()],
    patterns: {
      overall: pattern(current, currentHours, 'all', now),
      services: services.map((s) => pattern(current, currentHours, s, now)),
    },
    services: services.map((serviceType) => {
      const value = current
        .filter((d) => d.service_type === serviceType)
        .reduce((n, d) => n + d.generated, 0)
      return {
        serviceType,
        generated: value,
        comparison: compare(
          value,
          prior
            .filter((d) => d.service_type === serviceType)
            .reduce((n, d) => n + d.generated, 0),
        ),
      }
    }),
    venues: {
      items: venues.slice((input.page - 1) * 20, input.page * 20),
      page: input.page,
      pageSize: 20,
      total: venues.length,
    },
    coverage: {
      notes: current.some((d) => !!d.historical)
        ? [
            'El histórico recuperado usa la zona horaria disponible en la importación; los tipos de servicio no acreditados se muestran como sin determinar.',
          ]
        : [],
      status: coverage,
      since: current.length
        ? Math.max(...current.map((d) => d.coverage_since))
        : null,
      historical: current.some((d) => !!d.historical),
      volume: coverage,
      wait: summary.waitSamples ? coverage : 'unavailable',
      occupancy: current.some((d) => fullDay(d, now))
        ? coverage
        : 'unavailable',
    },
    freshness: {
      lastCompleteAt,
      nextRefreshAt: (Math.floor(now / QUARTER) + 1) * QUARTER + 5000,
      updating: control?.target_at != null,
      delayed: lastCompleteAt === null || now - lastCompleteAt > 2 * QUARTER,
    },
  }
}
