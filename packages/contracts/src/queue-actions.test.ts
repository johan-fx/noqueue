import { describe, expect, it } from 'vitest'
import {
  allowedEntryActions,
  defaultGraceMinutes,
  entryCommandSchema,
  queueCommandSchema,
} from './staff'

describe('service action policy', () => {
  it('allows manual assignment and direct arrival confirmation for every service type', () => {
    for (const type of ['reception', 'pool'] as const) {
      expect(allowedEntryActions(type, 'waiting')).toEqual(['call', 'pass', 'prioritize', 'cancel'])
      expect(allowedEntryActions(type, 'called')).toEqual([
        'complete',
        'pass',
        'cancel',
      ])
      expect(allowedEntryActions(type, 'completed')).toEqual([])
    }
  })
  it('accepts the automatic-assignment service setting while preserving legacy omission', async () => {
    const { serviceSchema } = await import('./staff')
    const base = {
      name: 'Reception',
      type: 'reception',
      capacity: 10,
      averageMinutes: 5,
      graceMinutes: 2,
      cutoffMinutes: 0,
      twentyFourHours: true,
      schedules: [],
      spaces: [],
      receptionServices: ['check_in'],
    }

    expect(serviceSchema.parse({ ...base, automaticAssignmentEnabled: true }).automaticAssignmentEnabled).toBe(true)
    expect(serviceSchema.parse({ ...base, automaticAssignmentEnabled: false }).automaticAssignmentEnabled).toBe(false)
    expect(serviceSchema.parse(base).automaticAssignmentEnabled).toBeUndefined()
  })
  it('allows restaurant staff to assign waiting turns and makes arrival terminal', () => {
    expect(allowedEntryActions('restaurant', 'waiting')).toEqual([
      'call',
      'pass',
      'prioritize',
      'cancel',
    ])
    expect(allowedEntryActions('restaurant', 'called')).toEqual([
      'complete',
      'pass',
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

for (const action of ['pass', 'prioritize'] as const) {
  it(`requires a versioned entry for ${action}`, () => {
    const command = {action, entryId: '00000000-0000-4000-8000-000000000001', version: 0}
    expect(entryCommandSchema.safeParse(command).success).toBe(true)
    expect(entryCommandSchema.safeParse({...command, version: undefined}).success).toBe(false)
    expect(entryCommandSchema.safeParse({...command, entryId: undefined}).success).toBe(false)
  })
}

it('accepts durable attention only on a manual call, preserving legacy commands', () => {
  const entryId = '11111111-1111-4111-8111-111111111111'
  const attentionId = '22222222-2222-4222-8222-222222222222'
  const command = { action: 'call', entryId, version: 0, attentionId }
  expect(queueCommandSchema.parse(command)).toMatchObject({ attentionId })
  expect(queueCommandSchema.safeParse({ ...command, action: 'cancel' }).success).toBe(false)
  expect(queueCommandSchema.safeParse({ ...command, attentionId: 'invalid' }).success).toBe(false)
  expect(queueCommandSchema.safeParse({ action: 'call', entryId, version: 0 }).success).toBe(true)
})
