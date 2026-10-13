import { expect, it } from 'vitest'
import { queueLifecycleSchema } from './staff'
it('opens a queue without inventory data and accepts old opening answers as an inert alias', () => {
  expect(
    queueLifecycleSchema.safeParse({ action: 'open', contextToken: 'token' }).success,
  ).toBe(true)
  const legacy = {
    action: 'open',
    contextToken: 'token',
    groups: [
      { spaceId: 'terrace', seats: 4, occupied: 0 },
      { spaceId: 'terrace', seats: 4, occupied: 2 },
    ],
  }
  expect(queueLifecycleSchema.safeParse(legacy).success).toBe(true)
})
it.each([
  { action: 'confirm_inventory', contextToken: 'token', groups: [] },
  { action: 'release_unit', contextToken: 'token', spaceId: 'terrace', seats: 4 },
  { action: 'occupancy', contextToken: 'token', group: { spaceId: 'terrace', seats: 4, occupied: 0 }, reason: 'legacy' },
])('rejects retired inventory lifecycle operation $action', (command) => {
  expect(queueLifecycleSchema.safeParse(command).success).toBe(false)
})
it('accepts explicit operational intelligence policy commands', () => {
  for (const action of ['disable_intelligence', 'enable_intelligence'])
    expect(
      queueLifecycleSchema.safeParse({ action, contextToken: 'token' }).success,
    ).toBe(true)
})
it('validates optional reminders independently from opening, before each interval cutoff', async () => {
  const { serviceSchema } = await import('./staff')
  const config = {
    name: 'Lunch',
    type: 'restaurant',
    capacity: 20,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 15,
    twentyFourHours: false,
    schedules: [{ day: 1, from: '12:00', to: '15:00' }],
    spaces: [{ name: 'Main', tables: 2 }],
    receptionServices: [],
  }
  const reminder = {
    enabled: true,
    intervals: [{ day: 1, from: '12:00', to: '15:00', at: '14:45' }],
  }
  expect(serviceSchema.safeParse({ ...config, reminder }).success).toBe(false)
  expect(
    serviceSchema.safeParse({
      ...config,
      reminder: {
        ...reminder,
        intervals: [{ ...reminder.intervals[0], at: '13:00' }],
      },
    }).success,
  ).toBe(true)
  expect(
    serviceSchema.safeParse({
      ...config,
      twentyFourHours: true,
      reminder: { enabled: true, intervals: [] },
    }).success,
  ).toBe(false)
})
