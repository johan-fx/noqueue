import type { ServiceInput } from '@noqueue/contracts/staff'

const minutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
const clockFormatters = new Map<string, Intl.DateTimeFormat>()
function zonedClock(timezone: string, now: Date) {
  let formatter = clockFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    if (clockFormatters.size >= 32) clockFormatters.clear()
    clockFormatters.set(timezone, formatter)
  }
  const parts = formatter.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    get('weekday'),
  )
  const minute = Number(get('hour')) * 60 + Number(get('minute'))
  const date = `${get('year')}-${get('month')}-${get('day')}`
  return { date, day, minute, offset: Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(get('hour')), Number(get('minute'))) - Math.floor(now.getTime() / 60000) * 60000 }
}

export type AdmissionRecord = {
  window_id: string | null
  override_state: 'active' | 'paused' | null
  activated_at: number | null
  reminder_ack: string | null
  legacy_paused_at: number | null
  legacy_config?: string | null
  legacy_timezone?: string | null
}

/** Physical hours and admission cutoff are deliberately independent. */
export function serviceWindow(
  config: ServiceInput,
  timezone: string,
  now = new Date(),
) {
  const { date, day, minute } = zonedClock(timezone, now)
  const schedules = [...config.schedules].sort(
    (a, b) => a.day - b.day || a.from.localeCompare(b.from),
  )
  const signature = JSON.stringify([
    timezone,
    config.type,
    config.twentyFourHours,
    config.cutoffMinutes,
    schedules,
  ])
  const interval = schedules.find(
    (s) => s.day === day && minute >= minutes(s.from) && minute < minutes(s.to),
  )
  const serviceOpen = config.twentyFourHours || !!interval
  return {
    serviceOpen,
    beforeCutoff:
      config.twentyFourHours ||
      (!!interval && minute < minutes(interval.to) - config.cutoffMinutes),
    windowId: config.twentyFourHours
      ? `continuous:${signature}`
      : interval
        ? `${date}:${interval.from}:${interval.to}:${signature}`
        : null,
    date,
    day,
    minute,
    interval,
  }
}
export type ServiceDeadline = { windowId: string; endsAt: number | null }
const closingCache = new Map<string, number[]>()
/** Snapshot the first real closing instant, never admission cutoff or a daily 24h reset. */
export function serviceDeadline(config: ServiceInput, timezone: string, now = new Date()): ServiceDeadline | null {
  const window = serviceWindow(config, timezone, now)
  if (!window.serviceOpen || !window.windowId) return null
  if (config.twentyFourHours) return { windowId: window.windowId, endsAt: null }
  const isOpen = (timestamp: number) => {
    const clock = zonedClock(timezone, new Date(timestamp))
    return config.schedules.some((s) => s.day === clock.day && clock.minute >= minutes(s.from) && clock.minute < minutes(s.to))
  }
  const ranges = config.schedules.filter((s) => s.day === window.day)
    .sort((a, b) => a.from.localeCompare(b.from))
  const merged: { from: number; to: number }[] = []
  for (const range of ranges) {
    const from = minutes(range.from), to = minutes(range.to), prior = merged.at(-1)
    if (prior && from <= prior.to) prior.to = Math.max(prior.to, to)
    else merged.push({ from, to })
  }
  const component = merged.find((r) => window.minute >= r.from && window.minute < r.to)
  if (!component) return null
  const midnight = Date.parse(`${window.date}T00:00:00Z`)
  const clock = zonedClock(timezone, now)
  const target = midnight + component.to * 60000
  const candidate = target - clock.offset
  const sameOffset = [target - 86400000, target + 86400000, candidate].every(
    (t) => zonedClock(timezone, new Date(t)).offset === clock.offset,
  )
  if (sameOffset && candidate > now.getTime() &&
    isOpen(candidate - 1) &&
    !isOpen(candidate))
    return { windowId: window.windowId, endsAt: candidate }
  // DST days use a bounded, cached transition timeline. Cache transitions, not one
  // deadline: a repeated local closing time can have two distinct UTC occurrences.
  const key = JSON.stringify([timezone, config.schedules, window.date])
  let closings = closingCache.get(key)
  if (!closings) {
    closings = []
    // Anchor on venue-local midnight; UTC-midnight bounds miss late closures
    // west of UTC. The margin covers either offset on a transition day.
    const start = midnight - clock.offset - 12 * 3600000, end = start + 48 * 3600000
    let wasOpen = isOpen(start - 1)
    for (let t = start; t <= end; t += 60000) {
      const open = isOpen(t)
      if (wasOpen && !open) closings.push(t)
      wasOpen = open
    }
    if (closingCache.size >= 32) closingCache.clear()
    closingCache.set(key, closings)
  }
  const endsAt = closings.find((t) => t > now.getTime())
  return endsAt === undefined ? null : { windowId: window.windowId, endsAt }
}

/** Safe SQL literals are derived only from the server clock and validated schedule. */
export function validWaitingSql(now: number, includeLegacy: boolean, alias = '') {
  const prefix = alias ? `${alias}.` : ''
  return `${prefix}status='waiting' AND (${prefix}service_ends_at IS NULL OR ${prefix}service_ends_at>${Math.trunc(now)}) AND (${prefix}service_window_id IS NOT NULL OR ${includeLegacy ? 1 : 0}=1)`
}
export function includesLegacyWaiting(config: ServiceInput, timezone: string, now = new Date()) {
  return config.twentyFourHours || serviceWindow(config, timezone, now).serviceOpen
}

export function serviceAcceptsEntries(
  config: ServiceInput,
  timezone: string,
  now = new Date(),
) {
  return serviceWindow(config, timezone, now).beforeCutoff
}

/** Read-time expiry makes cron an optimization, never an admission authority. */
export function resolveAdmission(
  config: ServiceInput,
  timezone: string,
  record: AdmissionRecord | null,
  waitingPeople: number,
  now = new Date(),
  waitingCount = waitingPeople,
) {
  const window = serviceWindow(config, timezone, now)
  const sameWindow = !!window.windowId && record?.window_id === window.windowId
  const legacyPause =
    record?.legacy_paused_at != null &&
    serviceWindow(
      record.legacy_config
        ? (JSON.parse(record.legacy_config) as ServiceInput)
        : config,
      record.legacy_timezone ?? timezone,
      new Date(record.legacy_paused_at),
    ).windowId === window.windowId
  const queueState: 'active' | 'paused' | 'inactive' =
    (sameWindow ? record?.override_state : null) ??
    (legacyPause
      ? 'paused'
      : config.type === 'restaurant'
        ? 'inactive'
        : 'active')
  const blockReason:
    | 'closed'
    | 'paused'
    | 'inactive'
    | 'cutoff'
    | 'capacity'
    | null = !window.serviceOpen
      ? 'closed'
      : !window.beforeCutoff
        ? 'cutoff'
        : queueState === 'paused'
          ? 'paused'
          : queueState === 'inactive'
            ? 'inactive'
            : (config.type === 'pool' ? waitingPeople : waitingCount) >= config.capacity
              ? 'capacity'
              : null
  const reminder = config.reminder
  const at = config.twentyFourHours
    ? reminder?.dailyAt
    : reminder?.intervals.find(
      (s) =>
        s.day === window.day &&
        s.from === window.interval?.from &&
        s.to === window.interval?.to,
    )?.at
  const reminderId =
    at && window.windowId ? `${window.windowId}:${window.date}:${at}` : null
  return {
    serviceOpen: window.serviceOpen,
    queueState,
    canJoin: blockReason === null,
    blockReason,
    waitingPeople,
    initialWaitingMarker:
      window.serviceOpen && queueState === 'active' && waitingPeople === 0,
    windowId: window.windowId,
    activatedAt: sameWindow ? record?.activated_at ?? null : null,
    reminderId,
    reminderDue:
      config.type === 'restaurant' &&
      !!reminder?.enabled &&
      queueState === 'inactive' &&
      window.serviceOpen &&
      window.beforeCutoff &&
      !!at &&
      window.minute >= minutes(at) &&
      record?.reminder_ack !== reminderId,
  }
}
export async function admissionState(
  env: CloudflareBindings,
  queueId: string,
  now = new Date(),
) {
  const row = await env.DB.prepare(
    'SELECT q.config,v.timezone FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=?',
  )
    .bind(queueId)
    .first<{ config: string; timezone: string }>()
  if (!row?.config) return null
  const record = await env.DB.prepare(
    'SELECT * FROM queue_admission WHERE queue_id=?',
  )
    .bind(queueId)
    .first<AdmissionRecord>()
  const config = JSON.parse(row.config) as ServiceInput
  const counts = await env.DB.prepare(
    `SELECT COALESCE(SUM(party_size),0) waitingPeople,COUNT(*) waitingCount FROM queue_entry WHERE queue_id=? AND ${validWaitingSql(now.getTime(), includesLegacyWaiting(config, row.timezone, now))}`,
  )
    .bind(queueId)
    .first<{ waitingPeople: number; waitingCount: number }>()
  return resolveAdmission(
    config,
    row.timezone,
    record,
    counts?.waitingPeople ?? 0,
    now,
    counts?.waitingCount ?? 0,
  )
}

/** Public contracts expose presentation/admission, not staff window or reminder identities. */
export function publicAdmission(
  state: NonNullable<Awaited<ReturnType<typeof admissionState>>>,
) {
  const {
    serviceOpen,
    queueState,
    canJoin,
    blockReason,
    waitingPeople,
    initialWaitingMarker,
  } = state
  return {
    serviceOpen,
    queueState,
    canJoin,
    blockReason,
    waitingPeople,
    initialWaitingMarker,
  }
}
