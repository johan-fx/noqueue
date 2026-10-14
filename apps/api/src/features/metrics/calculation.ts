import type {
  MetricComparison,
  MetricCounts,
  MetricsSummary,
} from '@noqueue/contracts/metrics'

export const DAY = 86_400_000
export const QUARTER = 900_000
const formatters = new Map<string, Intl.DateTimeFormat>()
export function localParts(at: number, timezone: string) {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timezone, formatter)
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((p) => [p.type, p.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}
export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10)
}
export function retentionDate(now: number) {
  const d = new Date(now),
    day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 13)
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d.toISOString().slice(0, 10)
}
/** Calendar boundary converted independently, rather than adding 24 hours across DST. */
const midnights = new Map<string, number>()
export function midnight(date: string, timezone: string): number {
  const key = `${date}:${timezone}`,
    cached = midnights.get(key)
  if (cached !== undefined) return cached
  // First real instant of a calendar date. Handles midnight gaps/repeats as well as 23/25h days.
  const target = Date.parse(date)
  let lo = target - 36 * 3600000,
    hi = target + 36 * 3600000
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000
    if (localParts(mid, timezone).date < date) lo = mid
    else hi = mid
  }
  if (midnights.size > 4096) midnights.clear()
  midnights.set(key, hi)
  return hi
}
function offset(at: number, timezone: string) {
  const p = localParts(at, timezone)
  return (
    Date.parse(p.date) +
    p.hour * 3600000 +
    p.minute * 60000 +
    p.second * 1000 -
    Math.floor(at / 1000) * 1000
  )
}
function transition(lo: number, hi: number, timezone: string) {
  const initial = offset(lo, timezone)
  while (hi - lo > 1000) {
    const middle = Math.floor((lo + hi) / 2000) * 1000
    if (offset(middle, timezone) === initial) lo = middle
    else hi = middle
  }
  return hi
}
export function hourBucket(at: number, timezone: string) {
  const p = localParts(at, timezone)
  let start =
    at - p.minute * 60000 - p.second * 1000 - (((at % 1000) + 1000) % 1000)
  // Distinguish repeated hours, including IANA zones with half-hour DST shifts.
  if (offset(start, timezone) !== offset(at, timezone))
    start = transition(start, Math.floor(at / 1000) * 1000, timezone)
  let end =
    at +
    (60 - p.minute) * 60000 -
    p.second * 1000 -
    (((at % 1000) + 1000) % 1000)
  if (offset(at, timezone) !== offset(end - 1, timezone))
    end = transition(Math.floor(at / 1000) * 1000, end - 1000, timezone)
  return { ...p, start, end }
}
export function outcome(
  status: string,
): keyof Pick<
  MetricCounts,
  'completed' | 'cancelled' | 'noShow' | 'pending' | 'unknown'
> {
  if (status === 'completed' || status === 'served') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'no_show' || status === 'expired') return 'noShow'
  if (status === 'waiting' || status === 'called') return 'pending'
  return 'unknown'
}
export const emptyCounts = (): MetricCounts => ({
  generated: 0,
  completed: 0,
  cancelled: 0,
  noShow: 0,
  pending: 0,
  unknown: 0,
  waitSumMs: 0,
  waitSamples: 0,
})
export function contribution(entry: {
  status: string
  created_at: number
  first_called_at: number | null
}): MetricCounts {
  const c = emptyCounts()
  c.generated = 1
  c[outcome(entry.status)] = 1
  if (
    entry.first_called_at !== null &&
    entry.first_called_at >= entry.created_at
  ) {
    c.waitSumMs = entry.first_called_at - entry.created_at
    c.waitSamples = 1
  }
  return c
}
export function summarize(
  c: MetricCounts,
  activeServices: number,
  activeVenues: number,
): MetricsSummary {
  const resolved = c.completed + c.cancelled + c.noShow
  return {
    ...c,
    meanWaitMs: c.waitSamples ? c.waitSumMs / c.waitSamples : null,
    attentionRate: resolved ? (100 * c.completed) / resolved : null,
    activeServices,
    activeVenues,
  }
}
export function comparison(
  current: number | null,
  previous: number | null,
  unit: MetricComparison['unit'],
  provisional = false,
): MetricComparison {
  if (provisional) return { value: null, unit, reason: 'provisional' }
  if (current === null || previous === null)
    return { value: null, unit, reason: 'unavailable' }
  if (unit === 'percent' && previous === 0)
    return {
      value: current === 0 ? 0 : null,
      unit,
      reason: current === 0 ? 'ok' : 'no_baseline',
    }
  return {
    value:
      unit === 'percent'
        ? ((current - previous) / previous) * 100
        : current - previous,
    unit,
    reason: 'ok',
  }
}
