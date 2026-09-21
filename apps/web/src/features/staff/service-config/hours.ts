import type { ServiceInput } from '@noqueue/contracts/staff'

export type TimeRange = { from: string; to: string }

const dayOrder = [1, 2, 3, 4, 5, 6, 0]
const dayNames = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
]

/** Shared opening hours shown in step 1, stored as one schedule per day. */
export function readHours(schedules: ServiceInput['schedules']): {
  days: number[]
  ranges: TimeRange[]
} {
  const days = dayOrder.filter((day) => schedules.some((slot) => slot.day === day))
  // Every day stores the same ranges. Read one day so two equal ranges
  // stay as two rows. Deduping by from/to hid the second "Añadir franja" click.
  const sourceDay = days[0]
  const ranges =
    sourceDay === undefined
      ? []
      : schedules
          .filter((slot) => slot.day === sourceDay)
          .map((slot) => ({ from: slot.from, to: slot.to }))
  return {
    days: days.length ? days : [1],
    // An empty schedule stays empty so a deleted range does not come back.
    ranges,
  }
}

/** Every selected day receives every time range. */
export function writeHours(days: number[], ranges: TimeRange[]) {
  return days.flatMap((day) =>
    ranges.map((range) => ({ day, from: range.from, to: range.to })),
  )
}

export function formatDays(days: number[]) {
  const indexes = dayOrder
    .map((day, index) => (days.includes(day) ? index : -1))
    .filter((index) => index >= 0)
  if (!indexes.length) return 'Sin días'
  const contiguous = indexes.every(
    (value, index) => index === 0 || value === indexes[index - 1]! + 1,
  )
  const first = dayNames[dayOrder[indexes[0]!]!]!
  const last = dayNames[dayOrder[indexes[indexes.length - 1]!]!]!
  if (indexes.length === 1) return first
  if (contiguous) return `${first} - ${last}`
  return indexes.map((index) => dayNames[dayOrder[index]!]!).join(', ')
}

export function formatRanges(ranges: TimeRange[]) {
  return ranges.map((range) => `${range.from} - ${range.to}`).join(', ')
}

export const weekdays = [
  { day: 1, label: 'Lunes', short: 'L' },
  { day: 2, label: 'Martes', short: 'M' },
  { day: 3, label: 'Miércoles', short: 'X' },
  { day: 4, label: 'Jueves', short: 'J' },
  { day: 5, label: 'Viernes', short: 'V' },
  { day: 6, label: 'Sábado', short: 'S' },
  { day: 0, label: 'Domingo', short: 'D' },
]
