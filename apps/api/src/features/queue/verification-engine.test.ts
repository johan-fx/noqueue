declare const process: { env: Record<string, string | undefined> }
import { record } from '../../../test/queue-evidence'
import { expect, it } from 'vitest'
import fc from 'fast-check'
import { groupMinutes, projectQueue, type Resource } from './engine'
const now = 1_800_000_000_000
const resources = (salon = 20): Resource[] => [
  {
    id: 'terrace:4:0',
    spaceId: 'terrace',
    seats: 4,
    averageMinutes: 50,
    availableAt: now,
    known: true,
  },
  {
    id: 'salon:4:0',
    spaceId: 'salon',
    seats: 4,
    averageMinutes: salon,
    availableAt: now,
    known: true,
  },
]
const parties = Array.from({ length: 3 }, (_, i) => ({
  id: `p${i}`,
  sequence: i,
  partySize: 4,
}))
const check = (id: string, step: string, actual: unknown, expected: unknown) =>
  record(id, step, now, actual, expected)
it('Q-PARALLEL exact independent parallel examples', () => {
  check(
    'Q-PARALLEL',
    '50/20 minutes',
    projectQueue(parties, resources(), now).map((p) => p.etaMinutes),
    [0, 0, 20],
  )
  check(
    'Q-PARALLEL',
    '50/35 minutes',
    projectQueue(parties, resources(35), now).map((p) => p.etaMinutes),
    [0, 0, 35],
  )
})
it('Q-LEARNING thresholds, prior, recency, rounding and invalid observations', () => {
  // (30*5 + 60*1 + 60*1.1 + 60*1.2)/8.3 = 41.9277 -> 42.
  check(
    'Q-LEARNING',
    'two samples',
    groupMinutes(30, [60, 60], undefined, now),
    30,
  )
  check(
    'Q-LEARNING',
    'third sample',
    groupMinutes(30, [60, 60, 60], undefined, now),
    42,
  )
  check(
    'Q-LEARNING',
    'invalid discarded',
    groupMinutes(30, [0, -1, Infinity, NaN, 1441, 60, 60, 60], undefined, now),
    42,
  )
  // 30 weights total 73.5; (150+4410)/78.5 = 58.089 -> 58.
  check(
    'Q-LEARNING',
    '30 samples',
    groupMinutes(30, Array(30).fill(60), undefined, now),
    58,
  )
  check(
    'Q-LEARNING',
    '31st evicts oldest',
    groupMinutes(30, [1440, ...Array(30).fill(60)], undefined, now),
    58,
  )
  check(
    'Q-LEARNING',
    'recency weighted',
    groupMinutes(30, [10, 30, 90], undefined, now),
    36,
  )
})
it('Q-EXPIRY adjustment priority at exact boundary and anchored progress', () => {
  const a = { minutes: 75, expiresAt: now + minute }
  for (const [time, expected] of [
    [now, 75],
    [now + minute - 1, 75],
    [now + minute, 42],
    [now + minute + 1, 42],
  ])
    check(
      'Q-EXPIRY',
      String(time),
      groupMinutes(30, [60, 60, 60], a, time!),
      expected,
    )
  const progress = { lastCallAt: now, cadenceMinutes: 5 }
  check(
    'Q-EXPIRY',
    'stable future instant',
    projectQueue(
      parties.slice(0, 1),
      [],
      now + 2 * minute,
      'fastest',
      progress,
    )[0]?.predictedAt,
    now + 5 * minute,
  )
  check(
    'Q-EXPIRY',
    'decreasing remaining minutes',
    projectQueue(
      parties.slice(0, 1),
      [],
      now + 2 * minute,
      'fastest',
      progress,
    )[0]?.etaMinutes,
    3,
  )
})
const minute = 60_000
it('Q-PREFERENCES strict binding, fastest, unknown and FIFO', () => {
  const rs = resources()
  rs[0]!.availableAt = null
  rs[0]!.known = false
  check(
    'Q-PREFERENCES',
    'strict occupied space',
    projectQueue([{ ...parties[0]!, preferredSpaceId: 'terrace' }], rs, now)[0]
      ?.quality,
    'unknown',
  )
  check(
    'Q-PREFERENCES',
    'fastest bypasses global preference',
    projectQueue(
      [{ ...parties[0]!, preferredSpaceId: 'fastest' }],
      rs,
      now,
      'terrace',
    )[0]?.resourceId,
    'salon:4:0',
  )
  check(
    'Q-PREFERENCES',
    'FIFO independent of input order',
    projectQueue([...parties].reverse(), resources(), now).map((p) => p.id),
    ['p0', 'p1', 'p2'],
  )
  check(
    'Q-PREFERENCES',
    'unknown capacity downgrades future estimate',
    projectQueue(parties, rs, now)[1]?.quality,
    'provisional',
  )
})
it('Q-PROPERTY generated homogeneous queue agrees with independent closed-form oracle', () => {
  const numRuns = Number(process.env.QUEUE_PROPERTY_RUNS ?? 200),
    seed = Number(process.env.QUEUE_SEED ?? 20260929)
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 1, max: 120 }),
      (count, groups, duration) => {
        const rs = Array.from({ length: count }, (_, i) => ({
          ...resources()[0]!,
          id: `r${i}`,
          averageMinutes: duration,
        }))
        const ps = Array.from({ length: groups }, (_, i) => ({
          id: `p${i}`,
          sequence: i,
          partySize: 4,
        }))
        const before = JSON.stringify(rs),
          result = projectQueue(ps, rs, now)
        expect(result.map((p) => p.etaMinutes)).toEqual(
          ps.map((_, i) => Math.floor(i / count) * duration),
        )
        expect(
          new Set(result.filter((p) => p.callable).map((p) => p.resourceId))
            .size,
        ).toBe(Math.min(count, groups))
        expect(JSON.stringify(rs)).toBe(before)
      },
    ),
    {
      numRuns,
      seed,
      ...(process.env.QUEUE_PATH ? { path: process.env.QUEUE_PATH } : {}),
    },
  )
  check('Q-PROPERTY', `seed=${seed}; runs=${numRuns}`, numRuns, numRuns)
})
