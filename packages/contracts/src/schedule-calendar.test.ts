import { expect, it } from 'vitest'
import {
  readScheduleGroups,
  weeklySchedule,
  pruneScheduleReminders,
} from './staff'
it('reconstructs different legacy day patterns without first-day loss', () => {
  const schedules = [
    { day: 1, from: '12:00', to: '14:00' },
    { day: 2, from: '16:00', to: '20:00' },
    { day: 3, from: '12:00', to: '14:00' },
  ]
  const groups = readScheduleGroups({ twentyFourHours: false, schedules })
  expect(groups).toEqual([
    {
      days: [1, 3],
      twentyFourHours: false,
      ranges: [{ from: '12:00', to: '14:00' }],
    },
    {
      days: [2],
      twentyFourHours: false,
      ranges: [{ from: '16:00', to: '20:00' }],
    },
  ])
  expect(weeklySchedule({ scheduleGroups: groups }).schedules).toEqual(
    schedules,
  )
  expect(
    readScheduleGroups({ twentyFourHours: true, schedules }).at(0)?.days,
  ).toHaveLength(7)
})
it('prunes obsolete reminder associations without transferring between modes', () => {
  const reminder = {
    enabled: true,
    dailyAt: '12:00',
    intervals: [
      { day: 1, from: '12:00', to: '14:00', at: '12:30' },
      { day: 2, from: '12:00', to: '14:00', at: '12:30' },
    ],
  }
  const config = {
    scheduleGroups: [
      { days: [1], twentyFourHours: true, ranges: [] },
      {
        days: [2],
        twentyFourHours: false,
        ranges: [{ from: '12:00', to: '14:00' }],
      },
    ],
    reminder,
  }
  expect(pruneScheduleReminders(config).reminder).toEqual({
    ...reminder,
    intervals: [reminder.intervals[1]],
  })
  expect(
    pruneScheduleReminders({
      ...config,
      scheduleGroups: [config.scheduleGroups[1]!],
    }).reminder,
  ).not.toHaveProperty('dailyAt')
})
