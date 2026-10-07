import { describe, expect, it } from 'vitest'
import {
  allowedEntryActions,
  defaultGraceMinutes,
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
  it('reserves restaurant assignment and resource release for their states', () => {
    expect(allowedEntryActions('restaurant', 'waiting')).toEqual([
      'call',
      'cancel',
    ])
    expect(allowedEntryActions('restaurant', 'called')).toEqual([
      'complete',
      'cancel',
    ])
    expect(allowedEntryActions('restaurant', 'completed')).toEqual(['release'])
    expect(allowedEntryActions('restaurant', 'waiting', false)).toEqual([])
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
