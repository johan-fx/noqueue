import { describe, it, expect } from 'vitest'
import { serviceAcceptsEntries } from './availability'
import type { ServiceInput } from '@noqueue/contracts/staff'
const config: ServiceInput = {
  name: 'Lunch',
  type: 'restaurant',
  capacity: 20,
  averageMinutes: 30,
  graceMinutes: 5,
  cutoffMinutes: 15,
  twentyFourHours: false,
  schedules: [{ day: 1, from: '12:00', to: '15:00' }],
  spaces: [{ name: 'Main', tables: 10 }],
  receptionServices: [],
}
describe('service availability', () => {
  it('uses venue timezone and stops at cutoff', () => {
    expect(
      serviceAcceptsEntries(
        config,
        'Europe/Madrid',
        new Date('2026-09-21T10:00:00Z'),
      ),
    ).toBe(true)
    expect(
      serviceAcceptsEntries(
        config,
        'Europe/Madrid',
        new Date('2026-09-21T12:45:00Z'),
      ),
    ).toBe(false)
    expect(
      serviceAcceptsEntries(
        config,
        'Europe/Madrid',
        new Date('2026-09-22T10:00:00Z'),
      ),
    ).toBe(false)
    expect(
      serviceAcceptsEntries(
        { ...config, twentyFourHours: true },
        'Europe/Madrid',
        new Date('2026-09-22T10:00:00Z'),
      ),
    ).toBe(true)
  })
})
