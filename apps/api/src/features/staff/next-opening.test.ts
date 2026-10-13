import { expect, it } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { nextServiceOpening } from './availability'
const base: ServiceInput = {
  name: 'Lunch',
  type: 'reception',
  capacity: 30,
  averageMinutes: 10,
  graceMinutes: 2,
  cutoffMinutes: 15,
  twentyFourHours: false,
  schedules: [{ day: 1, from: '12:00', to: '15:00' }],
  receptionServices: ['other'],
  spaces: [],
}
it.each([
  ['2026-10-12T08:10:23Z', '2026-10-12T10:00:00Z'],
  ['2026-10-12T13:00:00Z', '2026-10-19T10:00:00Z'],
  ['2026-10-18T23:00:00Z', '2026-10-19T10:00:00Z'],
])(
  'finds next opening from %s, including cached successive reads',
  (now, expected) => {
    expect(nextServiceOpening(base, 'Europe/Madrid', new Date(now))).toBe(
      Date.parse(expected),
    )
    expect(
      nextServiceOpening(
        base,
        'Europe/Madrid',
        new Date(Date.parse(now) + 1000),
      ),
    ).toBe(Date.parse(expected))
  },
)
it('does not confuse physical closing with admission cutoff or continuous service', () => {
  expect(
    nextServiceOpening(base, 'Europe/Madrid', new Date('2026-10-12T12:50:00Z')),
  ).toBeNull()
  expect(
    nextServiceOpening({ ...base, twentyFourHours: true }, 'Europe/Madrid'),
  ).toBeNull()
  expect(
    nextServiceOpening({ ...base, schedules: [] }, 'Europe/Madrid'),
  ).toBeNull()
})
it('supports split shifts, grouped all-day schedules and local midnight', () => {
  expect(
    nextServiceOpening(
      {
        ...base,
        schedules: [...base.schedules, { day: 1, from: '18:00', to: '22:00' }],
      },
      'Europe/Madrid',
      new Date('2026-10-12T14:00:00Z'),
    ),
  ).toBe(Date.parse('2026-10-12T16:00:00Z'))
  const { twentyFourHours: _always, schedules: _slots, ...common } = base
  const grouped: ServiceInput = {
    ...common,
    scheduleGroups: [{ days: [2], twentyFourHours: true, ranges: [] }],
  }
  expect(
    nextServiceOpening(
      grouped,
      'Asia/Kathmandu',
      new Date('2026-10-12T18:10:00Z'),
    ),
  ).toBe(Date.parse('2026-10-12T18:15:00Z'))
  expect(
    nextServiceOpening(
      { ...base, schedules: [{ day: 2, from: '00:00', to: '02:00' }] },
      'Atlantic/Canary',
      new Date('2026-10-12T22:00:00Z'),
    ),
  ).toBe(Date.parse('2026-10-12T23:00:00Z'))
})
it.each([
  ['02:30', '04:00', '2026-03-29T00:00:00Z', '2026-03-29T01:00:00Z'],
  ['02:10', '02:30', '2026-03-29T00:00:00Z', '2026-04-05T00:10:00Z'],
  ['02:30', '02:45', '2026-10-25T00:00:00Z', '2026-10-25T00:30:00Z'],
  ['02:30', '02:45', '2026-10-25T00:50:00Z', '2026-10-25T01:30:00Z'],
])('handles DST opening %s–%s from %s', (from, to, now, expected) => {
  expect(
    nextServiceOpening(
      { ...base, schedules: [{ day: 0, from, to }] },
      'Europe/Madrid',
      new Date(now),
    ),
  ).toBe(Date.parse(expected))
})
