import { describe, expect, it } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import {
  serviceWindow,
  serviceDeadline,
  resolveAdmission,
} from './availability'
const base = {
  name: 'Service',
  type: 'pool' as const,
  capacity: 20,
  averageMinutes: 30,
  graceMinutes: 2,
  cutoffMinutes: 240,
  spaces: [],
  receptionServices: [],
}
const config: ServiceInput = {
  ...base,
  scheduleGroups: [
    { days: [1, 2, 3, 4], twentyFourHours: true, ranges: [] },
    {
      days: [5],
      twentyFourHours: false,
      ranges: [{ from: '00:00', to: '14:00' }],
    },
  ],
}
describe('grouped service runtime', () => {
  it('admits all-day minutes through midnight without cutoff and expires at the next physical close after several days', () => {
    const now = new Date('2026-09-21T21:59:00Z')
    expect(serviceWindow(config, 'Europe/Madrid', now).beforeCutoff).toBe(true)
    expect(serviceDeadline(config, 'Europe/Madrid', now)?.endsAt).toBe(
      Date.parse('2026-09-25T12:00:00Z'),
    )
    expect(
      serviceWindow(config, 'Europe/Madrid', new Date('2026-09-25T10:00:00Z'))
        .beforeCutoff,
    ).toBe(false)
  })
  it('uses a stable all-day run identity across midnight and reordered cards', () => {
    const monday = serviceWindow(
      config,
      'UTC',
      new Date('2026-09-21T12:00:00Z'),
    )
    expect(
      serviceWindow(config, 'UTC', new Date('2026-09-22T12:00:00Z')).windowId,
    ).toBe(monday.windowId)
    expect(
      serviceWindow(
        { ...config, scheduleGroups: [...config.scheduleGroups!].reverse() },
        'UTC',
        new Date('2026-09-21T12:00:00Z'),
      ).windowId,
    ).toBe(monday.windowId)
  })
  it('keeps complete-week full-day calendars continuous with no deadline', () => {
    const always = {
      ...base,
      scheduleGroups: [
        { days: [0, 1, 2, 3, 4, 5, 6], twentyFourHours: true, ranges: [] },
      ],
    }
    expect(
      serviceDeadline(always, 'UTC', new Date('2026-09-21T12:00:00Z'))?.endsAt,
    ).toBeNull()
    expect(
      serviceWindow(always, 'UTC', new Date('2026-09-21T12:00:00Z')).windowId,
    ).toBe(
      serviceWindow(always, 'UTC', new Date('2026-09-22T12:00:00Z')).windowId,
    )
  })
  it('handles week wrap and DST changes when consecutive full days end', () => {
    const dst = {
      ...base,
      scheduleGroups: [{ days: [6, 0, 1], twentyFourHours: true, ranges: [] }],
    }
    expect(
      serviceDeadline(dst, 'Europe/Madrid', new Date('2026-10-24T10:00:00Z'))
        ?.endsAt,
    ).toBe(Date.parse('2026-10-26T23:00:00Z'))
    const spring = new Date('2026-03-28T12:00:00Z')
    expect(serviceDeadline(dst, 'Europe/Madrid', spring)?.endsAt).toBe(
      Date.parse('2026-03-30T22:00:00Z'),
    )
    expect(
      serviceWindow(dst, 'Europe/Madrid', new Date('2026-10-24T12:00:00Z'))
        .windowId,
    ).toBe(
      serviceWindow(dst, 'Europe/Madrid', new Date('2026-10-26T12:00:00Z'))
        .windowId,
    )
  })
  it('selects daily reminders only on full-day groups and timed reminders on timed groups', () => {
    const mixed = {
      ...config,
      type: 'restaurant' as const,
      cutoffMinutes: 15,
      spaces: [{ name: 'Room', tables: 1 }],
      reminder: {
        enabled: true,
        dailyAt: '12:00',
        intervals: [{ day: 5, from: '00:00', to: '14:00', at: '11:00' }],
      },
    }
    expect(
      resolveAdmission(mixed, 'UTC', null, 0, new Date('2026-09-21T13:00:00Z'))
        .reminderDue,
    ).toBe(true)
    expect(
      resolveAdmission(mixed, 'UTC', null, 0, new Date('2026-09-25T10:59:00Z'))
        .reminderDue,
    ).toBe(false)
    expect(
      resolveAdmission(mixed, 'UTC', null, 0, new Date('2026-09-25T11:00:00Z'))
        .reminderDue,
    ).toBe(true)
  })
})
