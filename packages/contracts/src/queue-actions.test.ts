import { describe, expect, it } from 'vitest'
import {
  allowedEntryActions,
  defaultGraceMinutes,
  entryCommandSchema,
  queueCommandSchema,
} from './staff'

describe('service action policy', () => {
  it('keeps quick waiting selection global and arrival direct', () => {
    for (const type of ['reception', 'pool'] as const) {
      expect(allowedEntryActions(type, 'waiting')).toEqual(['cancel'])
      expect(allowedEntryActions(type, 'called')).toEqual([
        'complete',
        'cancel',
      ])
      expect(allowedEntryActions(type, 'completed')).toEqual([])
    }
  })
  it('allows restaurant staff to assign waiting turns and makes arrival terminal', () => {
    expect(allowedEntryActions('restaurant', 'waiting')).toEqual([
      'call',
      'cancel',
    ])
    expect(allowedEntryActions('restaurant', 'called')).toEqual([
      'complete',
      'cancel',
    ])
    expect(allowedEntryActions('restaurant', 'completed')).toEqual([])
    expect(allowedEntryActions('restaurant', 'waiting', false)).toEqual([])
    expect(
      queueCommandSchema.safeParse({
        entryId: '00000000-0000-4000-8000-000000000000',
        version: 0,
        action: 'call',
      }).success,
    ).toBe(true)
    expect(
      queueCommandSchema.safeParse({
        entryId: '00000000-0000-4000-8000-000000000000',
        version: 0,
        action: 'call',
        arrivalMode: 'notify',
      }).success,
    ).toBe(true)
    expect(
      entryCommandSchema.safeParse({
        entryId: '00000000-0000-4000-8000-000000000000',
        version: 1,
        action: 'release',
      }).success,
    ).toBe(false)
  })
  it('accepts a queue-level FIFO command without a client-selected person', () => {
    expect(
      queueCommandSchema.safeParse({ action: 'assign_next' }).success,
    ).toBe(true)
    expect(queueCommandSchema.safeParse({ action: 'call' }).success).toBe(false)
  })
  it('defaults only new quick queues to two minutes', () => {
    expect(defaultGraceMinutes('pool')).toBe(2)
    expect(defaultGraceMinutes('reception')).toBe(2)
    expect(defaultGraceMinutes('restaurant')).toBe(5)
  })
})

it('hydrates only absent legacy grace and preserves every explicit value', async () => {
  const { storedServiceSchema } = await import('./staff')
  const base = {
    name: 'Pool',
    type: 'pool',
    capacity: 10,
    averageMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [],
    receptionServices: [],
  }
  expect(storedServiceSchema.parse(base).graceMinutes).toBe(2)
  expect(
    storedServiceSchema.parse({ ...base, graceMinutes: 5 }).graceMinutes,
  ).toBe(5)
  expect(
    storedServiceSchema.parse({ ...base, graceMinutes: 17 }).graceMinutes,
  ).toBe(17)
})
