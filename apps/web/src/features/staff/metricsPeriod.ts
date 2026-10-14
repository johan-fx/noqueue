export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'thisMonth'
  | 'lastMonth'
  | 'last12Months'

function dateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day! + days, 12))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function shiftMonths(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number)
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1, 12))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate()
  const clampedDay = Math.min(day!, lastDay)
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`
}

export function periodRange(period: PeriodKey, timezone: string, now = new Date()) {
  const today = dateParts(now, timezone)
  const yesterday = shiftDate(today, -1)
  const firstOfThisMonth = monthStart(today)
  const lastOfPreviousMonth = shiftDate(firstOfThisMonth, -1)
  switch (period) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: yesterday, to: yesterday }
    case 'last7':
      return { from: shiftDate(yesterday, -6), to: yesterday }
    case 'last30':
      return { from: shiftDate(yesterday, -29), to: yesterday }
    case 'last90':
      return { from: shiftDate(yesterday, -89), to: yesterday }
    case 'thisMonth':
      return { from: firstOfThisMonth, to: today }
    case 'lastMonth':
      return { from: monthStart(lastOfPreviousMonth), to: lastOfPreviousMonth }
    case 'last12Months':
      return { from: shiftMonths(today, -12), to: yesterday }
  }
}
