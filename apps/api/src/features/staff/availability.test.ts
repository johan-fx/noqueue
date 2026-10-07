import { describe, it, expect } from 'vitest'
import {
  serviceAcceptsEntries,
  serviceWindow,
  resolveAdmission,
} from './availability'
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

it('separates physical hours from cutoff and scopes scheduled admission', () => {
  const full = serviceWindow(
    config,
    'Europe/Madrid',
    new Date('2026-09-21T12:45:00Z'),
  )
  expect(full.serviceOpen).toBe(true)
  expect(full.beforeCutoff).toBe(false)
  const first = resolveAdmission(
    config,
    'Europe/Madrid',
    null,
    0,
    new Date('2026-09-21T10:00:00Z'),
  )
  expect(first.queueState).toBe('inactive')
  expect(first.canJoin).toBe(false)
  const admission = {
    window_id: first.windowId,
    override_state: 'active' as const,
    activated_at: 1,
    reminder_ack: null,
    legacy_paused_at: null,
  }
  expect(
    resolveAdmission(
      config,
      'Europe/Madrid',
      admission,
      0,
      new Date('2026-09-21T10:01:00Z'),
    ).canJoin,
  ).toBe(true)
  expect(
    resolveAdmission(
      config,
      'Europe/Madrid',
      admission,
      0,
      new Date('2026-09-28T10:00:00Z'),
    ).queueState,
  ).toBe('inactive')
  expect(
    resolveAdmission(
      { ...config, type: 'pool' },
      'Europe/Madrid',
      null,
      20,
      new Date('2026-09-21T10:00:00Z'),
    ).blockReason,
  ).toBe('capacity')
})
it('keeps 24 hour windows continuous and never activates an ignored reminder', () => {
  const allDay = {
    ...config,
    twentyFourHours: true,
    reminder: { enabled: true, dailyAt: '14:00', intervals: [] },
  }
  const first = resolveAdmission(
    allDay,
    'Europe/Madrid',
    null,
    0,
    new Date('2026-09-21T13:00:00Z'),
  )
  const second = resolveAdmission(
    allDay,
    'Europe/Madrid',
    null,
    0,
    new Date('2026-09-22T13:00:00Z'),
  )
  expect(first.windowId).toBe(second.windowId)
  expect(first.reminderDue).toBe(true)
  expect(first.queueState).toBe('inactive')
  expect(second.reminderId).not.toBe(first.reminderId)
})
it('expires migrated automatic pauses and configuration-scoped overrides', () => {
  const reception = { ...config, type: 'reception' as const }
  const record = {
    window_id: null,
    override_state: null,
    activated_at: null,
    reminder_ack: null,
    legacy_paused_at: Date.parse('2026-09-21T10:00:00Z'),
  }
  expect(
    resolveAdmission(
      reception,
      'Europe/Madrid',
      record,
      0,
      new Date('2026-09-21T10:01:00Z'),
    ).queueState,
  ).toBe('paused')
  expect(
    resolveAdmission(
      reception,
      'Europe/Madrid',
      record,
      0,
      new Date('2026-09-28T10:01:00Z'),
    ).queueState,
  ).toBe('active')
  const window = serviceWindow(
    config,
    'Europe/Madrid',
    new Date('2026-09-21T10:01:00Z'),
  )
  const active = {
    ...record,
    window_id: window.windowId,
    override_state: 'active' as const,
    legacy_paused_at: null,
  }
  expect(
    resolveAdmission(
      { ...config, cutoffMinutes: 10 },
      'Europe/Madrid',
      active,
      0,
      new Date('2026-09-21T10:01:00Z'),
    ).queueState,
  ).toBe('inactive')
})

it('expires migrated continuous pauses after scheduling or timezone changes', () => {
  const pool = { ...config, type: 'pool' as const, twentyFourHours: true }
  const record = {
    window_id: null,
    override_state: null,
    activated_at: null,
    reminder_ack: null,
    legacy_paused_at: Date.parse('2026-09-21T10:00:00Z'),
    legacy_config: JSON.stringify(pool),
    legacy_timezone: 'Europe/Madrid',
  }
  expect(resolveAdmission(pool, 'Europe/Madrid', record, 0).queueState).toBe(
    'paused',
  )
  expect(
    resolveAdmission({ ...pool, cutoffMinutes: 10 }, 'Europe/Madrid', record, 0)
      .queueState,
  ).toBe('active')
  expect(resolveAdmission(pool, 'UTC', record, 0).queueState).toBe('active')
})
