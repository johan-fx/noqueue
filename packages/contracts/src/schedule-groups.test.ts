import { describe, expect, it } from 'vitest'
import {
  serviceSchema,
  queueSettingsSchema,
  storedServiceSchema,
} from './staff'
const base = {
  name: 'Service',
  type: 'pool',
  capacity: 20,
  averageMinutes: 30,
  graceMinutes: 2,
  cutoffMinutes: 15,
  spaces: [],
  receptionServices: [],
}
const timed = {
  days: [1, 2],
  twentyFourHours: false,
  ranges: [{ from: '12:00', to: '15:00' }],
}
const allDay = { days: [0, 6], twentyFourHours: true, ranges: [] }
describe('schedule groups contract', () => {
  it('accepts mixed groups in service, stored and settings contracts without legacy fields', () => {
    const input = { ...base, scheduleGroups: [timed, allDay] }
    expect(serviceSchema.parse(input)).toEqual(input)
    expect(storedServiceSchema.parse(input).scheduleGroups).toEqual(
      input.scheduleGroups,
    )
    expect(
      queueSettingsSchema.parse({ ...input, version: 0, open: true })
        .scheduleGroups,
    ).toEqual(input.scheduleGroups)
  })
  it('rejects mixed wire formats and missing formats', () => {
    expect(
      serviceSchema.safeParse({
        ...base,
        scheduleGroups: [timed],
        twentyFourHours: false,
        schedules: [],
      }).success,
    ).toBe(false)
    expect(serviceSchema.safeParse(base).success).toBe(false)
  })
  it.each([
    [],
    [{ ...timed, days: [] }],
    [{ ...timed, days: [1, 1] }],
    [timed, { ...allDay, days: [1] }],
    [{ ...timed, ranges: [] }],
    [{ ...allDay, ranges: timed.ranges }],
    [{ ...timed, ranges: [{ from: '23:00', to: '02:00' }] }],
    [{ ...timed, ranges: [...timed.ranges, { from: '14:00', to: '16:00' }] }],
    [
      {
        ...timed,
        days: [0, 1, 2, 3, 4, 5, 6],
        ranges: Array.from({ length: 5 }, (_, i) => ({
          from: `${String(i * 2).padStart(2, '0')}:00`,
          to: `${String(i * 2 + 1).padStart(2, '0')}:00`,
        })),
      },
    ],
  ])(
    'rejects invalid ownership, modes and expanded limits: %j',
    (...groups) => {
      expect(
        serviceSchema.safeParse({ ...base, scheduleGroups: groups }).success,
      ).toBe(false)
    },
  )
  it('validates both daily and timed reminders in mixed calendars', () => {
    const input = {
      ...base,
      type: 'restaurant',
      spaces: [{ name: 'Room', tables: 1 }],
      scheduleGroups: [timed, allDay],
      reminder: {
        enabled: true,
        dailyAt: '13:00',
        intervals: [{ day: 1, from: '12:00', to: '15:00', at: '12:30' }],
      },
    }
    expect(serviceSchema.safeParse(input).success).toBe(true)
    expect(
      serviceSchema.safeParse({
        ...input,
        reminder: { ...input.reminder, dailyAt: undefined },
      }).success,
    ).toBe(false)
  })
})
