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
  it('parses legacy FIFO payloads for replay and validates new head preconditions', () => {
    expect(
      queueCommandSchema.safeParse({ action: 'assign_next' }).success,
    ).toBe(true)
    expect(queueCommandSchema.safeParse({ action: 'assign_next', expectedEntryId: '00000000-0000-4000-8000-000000000000', expectedVersion: 0 }).success).toBe(true)
    expect(queueCommandSchema.safeParse({ action: 'assign_next', expectedEntryId: 'invalid', expectedVersion: -1 }).success).toBe(false)
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

it('requires versioned explicit candidates for replacement decisions', () => {
  const command={action:'resolve_replacement',decisionId:'00000000-0000-4000-8000-000000000001',decisionVersion:0,entryId:'00000000-0000-4000-8000-000000000002',version:0}
  expect(queueCommandSchema.safeParse(command).success).toBe(true)
  expect(queueCommandSchema.safeParse({...command,version:undefined}).success).toBe(false)
  expect(queueCommandSchema.safeParse({...command,decisionVersion:undefined}).success).toBe(false)
  expect(queueCommandSchema.safeParse({...command,seating:{mode:'unspecified'}}).success).toBe(false)
})
it('dismisses a specific versioned decision without assigning a candidate', () => {
  const command={action:'dismiss_replacement',decisionId:'00000000-0000-4000-8000-000000000001',decisionVersion:0}
  expect(queueCommandSchema.safeParse(command).success).toBe(true)
  expect(queueCommandSchema.safeParse({...command,entryId:'00000000-0000-4000-8000-000000000002'}).success).toBe(false)
  expect(queueCommandSchema.safeParse({...command,decisionVersion:-1}).success).toBe(false)
})
