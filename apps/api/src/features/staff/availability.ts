import type { ServiceInput } from '@noqueue/contracts/staff'
export function serviceAcceptsEntries(
  config: ServiceInput,
  timezone: string,
  now = new Date(),
) {
  if (config.twentyFourHours) return true
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
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
  const minutes = (value: string) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  return config.schedules.some(
    (s) =>
      s.day === day &&
      minute >= minutes(s.from) &&
      minute < minutes(s.to) - config.cutoffMinutes,
  )
}
