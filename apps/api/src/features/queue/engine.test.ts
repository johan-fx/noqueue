import { describe, expect, it } from 'vitest'
import { projectQueue, groupMinutes } from './engine'
const now = 1_000_000
const resource = (id: string, seats: number, minutes = 30) => ({
  id,
  spaceId: id,
  seats,
  averageMinutes: minutes,
  availableAt: now,
  known: true,
})
const party = (id: string, sequence: number, partySize = 2) => ({
  id,
  sequence,
  partySize,
})
describe('compatible parallel queue projection', () => {
  it('uses parallel capacity, earliest availability and smallest fit', () => {
    const result = projectQueue(
      [party('a', 1), party('b', 2), party('c', 3)],
      [resource('small', 2, 10), resource('large', 4, 30)],
      now,
    )
    expect(result.map((x) => x.etaMinutes)).toEqual([0, 0, 10])
    expect(result[0]?.resourceId).toBe('small')
  })
  it('lets a small free resource serve the oldest compatible party', () => {
    expect(
      projectQueue(
        [party('large', 1, 6), party('small', 2)],
        [resource('two', 2)],
        now,
      )[1]?.etaMinutes,
    ).toBe(0)
  })
  it('prefers a compatible space even when slower; falls back only if incompatible', () => {
    const resources = [
      resource('terrace', 4, 60),
      { ...resource('salon', 2), availableAt: now + 60000 },
    ]
    expect(
      projectQueue([party('a', 1)], resources, now, 'salon')[0]?.resourceId,
    ).toBe('salon')
    expect(
      projectQueue([party('b', 1, 4)], resources, now, 'salon')[0]
        ?.resourceId,
    ).toBe('terrace')
  })
  it('never treats unknown or overdue occupied resources as free', () => {
    expect(
      projectQueue(
        [party('a', 1)],
        [{ ...resource('one', 2), availableAt: null, known: false }],
        now,
      )[0],
    ).toMatchObject({ quality: 'unknown', predictedAt: null })
  })
  it('uses bounded observations and expiring adjustment without changing order', () => {
    expect(
      groupMinutes(30, [], { minutes: 50, expiresAt: now + 1 }, now),
    ).toBe(50)
    expect(groupMinutes(30, [], { minutes: 50, expiresAt: now }, now)).toBe(
      30,
    )
    expect(
      groupMinutes(30, [60, 60, 60, 60], undefined, now),
    ).toBeGreaterThan(30)
  })
})
it('retains the configured default until three valid completed durations exist', () => {
  expect(groupMinutes(30, [60], undefined, now)).toBe(30)
  expect(groupMinutes(30, [60, 60, 2000], undefined, now)).toBe(30)
})
it('anchors provisional cadence to actual progress and expires stale forecasts', () => {
  const progress = { lastCallAt: now, cadenceMinutes: 5 }
  const first = projectQueue(
    [party('a', 1)],
    [],
    now,
    'fastest',
    progress,
  )[0]!
  const later = projectQueue(
    [party('a', 1)],
    [],
    now + 2 * 60000,
    'fastest',
    progress,
  )[0]!
  expect(first).toMatchObject({
    etaMinutes: 5,
    predictedAt: now + 5 * 60000,
    callable: false,
  })
  expect(later).toMatchObject({
    etaMinutes: 3,
    predictedAt: first.predictedAt,
    callable: false,
  })
  expect(
    projectQueue(
      [party('a', 1)],
      [],
      now + 6 * 60000,
      'fastest',
      progress,
    )[0],
  ).toMatchObject({ quality: 'unknown', predictedAt: null, callable: false })
  expect(
    projectQueue(
      [party('a', 1)],
      [{ ...resource('busy', 2), availableAt: null, callable: false }],
      now + 6 * 60000,
      'fastest',
      progress,
    )[0],
  ).toMatchObject({ quality: 'unknown', predictedAt: null, callable: false })
})

it('marks forecasts affected by unknown occupied compatible resources provisional, without changing unrelated spaces', () => {
  const now = 100000
  const resources = [
    {
      id: 'terrace:4:0',
      spaceId: 'terrace',
      seats: 4,
      averageMinutes: 40,
      availableAt: null,
      known: false,
      callable: false,
    },
    {
      id: 'salon:4:0',
      spaceId: 'salon',
      seats: 4,
      averageMinutes: 20,
      availableAt: now + 1200000,
      known: true,
      callable: false,
    },
  ]
  const parties = [{ id: 'one', sequence: 1, partySize: 4 }]
  expect(projectQueue(parties, resources, now)[0]?.quality).toBe(
    'provisional',
  )
  expect(projectQueue(parties, resources, now, 'salon')[0]?.quality).toBe(
    'estimated',
  )
})
