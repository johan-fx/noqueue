import { describe, expect, it } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import {
  cadenceFactor,
  configuredIntervalMinutes,
  learnedOccupancyMinutes,
  projectAdaptiveQueue,
  protectionRemainingMs,
  safetyMarginMs,
} from './adaptive-model'
import type { Party, Resource } from './engine'

function config(overrides: Record<string, unknown> = {}): ServiceInput {
  return {
    name: 'Adaptive test',
    type: 'restaurant',
    capacity: 30,
    averageMinutes: 9,
    approachMinutes: 4,
    approachTurns: 1,
    etaChangeThresholdMinutes: 2,
    notificationCooldownMinutes: 5,
    graceMinutes: 2,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [
      {
        id: 'room',
        name: 'Room',
        tables: 3,
        tableTypes: [{ seats: 4, count: 3, averageMinutes: 4 }],
      },
    ],
    receptionServices: [],
    ...overrides,
  } as unknown as ServiceInput
}

const parties: Party[] = [1, 2, 3].map((sequence) => ({
  id: `p${sequence}`,
  sequence,
  partySize: 2,
}))

function resource(
  id: string,
  overrides: Partial<Resource> & { occupancyMinutes?: number | null } = {},
): Resource & { occupancyMinutes?: number | null } {
  return {
    id,
    spaceId: 'room',
    seats: 4,
    averageMinutes: 99,
    availableAt: 0,
    known: true,
    callable: true,
    ...overrides,
  }
}

describe('adaptive cadence helpers', () => {
  it('uses configured table type, then legacy seat setting, then service and fallback', () => {
    const configured = config({
      queueBySeat: [{ seats: 4, averageMinutes: 7, capacity: 20 }],
    })
    expect(configuredIntervalMinutes(configured, 2, 'room', 4)).toBe(4)
    expect(configuredIntervalMinutes(configured, 2, 'missing', 4)).toBe(7)
    expect(configuredIntervalMinutes(configured, 2, 'missing', 2)).toBe(9)
    expect(configuredIntervalMinutes(null, 6, 'room', 4)).toBe(6)
  })

  it('smooths assignment ratios with a neutral prior and accepts simultaneous calls', () => {
    expect(cadenceFactor([])).toBe(1)
    expect(cadenceFactor([0.1, 0.2])).toBe(1)
    const quick = cadenceFactor([0, 0, 0])
    expect(quick).toBeGreaterThan(0)
    expect(quick).toBeLessThan(1)
    expect(cadenceFactor([2, 2, 2])).toBeGreaterThan(1)
  })

  it('filters invalid data and learns from the last thirty ratios only', () => {
    const ratios = [
      ...Array(40).fill(10),
      ...Array(30).fill(0),
      Number.NaN,
    ]
    expect(cadenceFactor(ratios)).toBeCloseTo(cadenceFactor(Array(30).fill(0)))
    expect(cadenceFactor([Infinity, -1, 1, 1])).toBeCloseTo(1)
  })

  it('learns occupancy separately, only after three valid arrival→release samples', () => {
    expect(learnedOccupancyMinutes([30, 40])).toBeNull()
    expect(learnedOccupancyMinutes([0, 30, 40, 50, 1441])).toBeCloseTo(
      (30 + 40 * 1.1 + 50 * 1.2) / 3.3,
    )
    expect(learnedOccupancyMinutes([10, 20, 30, ...Array(30).fill(60)])).toBe(
      60,
    )
  })

  it('uses the configured interval as the initial stacked cadence (4, 8, 12)', () => {
    const source = [resource('a'), resource('b'), resource('c')]
    const snapshot = structuredClone(source)
    const projection = projectAdaptiveQueue(
      parties,
      source,
      0,
      config(),
      20,
      1,
    )
    expect(projection.map((row) => row.predictedAt / 60_000)).toEqual([4, 8, 12])
    expect(projection.map((row) => row.quality)).toEqual([
      'estimated',
      'estimated',
      'estimated',
    ])
    expect(source).toEqual(snapshot)
  })

  it('uses learned occupancy only to model later resource availability', () => {
    const projection = projectAdaptiveQueue(
      [...parties, { id: 'p4', sequence: 4, partySize: 2 }],
      [
        resource('a', { occupancyMinutes: 20 }),
        resource('b', { occupancyMinutes: 20 }),
        resource('c', { occupancyMinutes: 20 }),
      ],
      0,
      config(),
      20,
      1,
    )
    expect(projection.map((row) => row.predictedAt / 60_000)).toEqual([
      4,
      8,
      12,
      24,
    ])
  })

  it('applies the learned factor gradually without rounding fractional minutes', () => {
    const projection = projectAdaptiveQueue(
      parties,
      [resource('a'), resource('b'), resource('c')],
      0,
      config(),
      20,
      0.5,
    )
    expect(projection.map((row) => row.cadenceMs)).toEqual([
      120_000,
      120_000,
      120_000,
    ])
    expect(projection.map((row) => row.predictedAt)).toEqual([
      120_000,
      240_000,
      360_000,
    ])
  })

  it('falls back to provisional cadence without asserting an unknown resource is callable', () => {
    const projection = projectAdaptiveQueue(
      parties,
      [resource('unknown', { known: false, availableAt: 0 })],
      0,
      config(),
      20,
      1,
    )
    expect(projection).toEqual(
      parties.map((party, index) => ({
        id: party.id,
        position: index + 1,
        predictedAt: (index + 1) * 4 * 60_000,
        quality: 'provisional',
        cadenceMs: 4 * 60_000,
        resourceId: null,
      })),
    )
  })

  it('prefers an earlier cadence-only provisional forecast over a much later known slot', () => {
    const projection = projectAdaptiveQueue(
      [{ id: 'waiting', sequence: 1, partySize: 2 }],
      [
        resource('late-known', { availableAt: 20 * 60_000 }),
        resource('unknown', { known: false, availableAt: null }),
      ],
      0,
      config(),
      20,
      1,
    )
    expect(projection[0]).toMatchObject({
      predictedAt: 4 * 60_000,
      quality: 'provisional',
      resourceId: null,
    })
  })

  it('never reuses a predicted assignment as a known slot without occupancy history', () => {
    const projection = projectAdaptiveQueue(
      parties,
      [resource('single', { occupancyMinutes: null })],
      0,
      config(),
      20,
      1,
    )
    expect(projection.map((row) => row.quality)).toEqual([
      'estimated',
      'provisional',
      'provisional',
    ])
    expect(projection.map((row) => row.resourceId)).toEqual([
      'single',
      null,
      null,
    ])
  })

  it('respects party size and selected-space eligibility', () => {
    const projection = projectAdaptiveQueue(
      [{ id: 'large', sequence: 1, partySize: 5, preferredSpaceId: 'other' }],
      [resource('room-small'), resource('other-large', { spaceId: 'other', seats: 6 })],
      0,
      config(),
      20,
      1,
    )
    expect(projection[0]).toMatchObject({
      resourceId: 'other-large',
      predictedAt: 9 * 60_000,
      quality: 'estimated',
    })
  })

  it('keeps safety/extension math deterministic and bounded by the configured approach window', () => {
    expect(safetyMarginMs(240_000, 4)).toBe(60_000)
    expect(safetyMarginMs(120_000, 1)).toBe(30_000)
    expect(safetyMarginMs(100, 0)).toBe(1_000)
    expect(protectionRemainingMs(240_000, 60_000, 1_200_000)).toBe(600_000)
  })
})
