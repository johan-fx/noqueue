import type { ServiceInput } from '@noqueue/contracts/staff'

const minutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    get('weekday'),
  )
  const minute = Number(get('hour')) * 60 + Number(get('minute'))
  const date = `${get('year')}-${get('month')}-${get('day')}`
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
  const counts = await env.DB.prepare(
    "SELECT COALESCE(SUM(party_size),0) waitingPeople,COUNT(*) waitingCount FROM queue_entry WHERE queue_id=? AND status='waiting'",
  )
    .bind(queueId)
    .first<{ waitingPeople: number; waitingCount: number }>()
  return resolveAdmission(
    JSON.parse(row.config) as ServiceInput,
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
