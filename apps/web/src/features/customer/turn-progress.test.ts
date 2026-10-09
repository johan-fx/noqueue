import { expect, it } from 'vitest'
import type { Entry } from '@noqueue/contracts/queue'
import { turnProgress } from './turn-progress'

function entry(overrides: Partial<Entry> = {}, phase = 'waiting'): Entry {
  return {
    code: 'ABC',
    position: 6,
    etaMinutes: 25,
    estimateQuality: 'estimated',
    status: 'waiting',
    notification: 'disabled',
    initialEtaMinutes: 50,
    customer: {
      service: {
        id: 'q',
        name: 'Queue',
        venueName: 'Venue',
        open: 1,
        type: 'pool',
        receptionServices: [],
        spaces: [],
      },
      displayName: null,
      partySize: 1,
      preferredSpaceId: null,
      locale: 'en',
      version: 0,
      serverNow: 1000,
      createdAt: 0,
      calledAt: 1000,
      arrivalDeadlineAt: 301000,
      arrivedAt: null,
      phase: phase as NonNullable<Entry['customer']>['phase'],
      actions: [],
    },
    ...overrides,
  }
}
it.each([
  [50, 0],
  [25, 0.5],
  [40, 0.2],
  [10, 0.8],
  [80, 0],
  [0, 1],
])('uses ETA %i on the same 50 minute baseline', (etaMinutes, expected) => {
  expect(turnProgress(entry({ etaMinutes }), 1000)).toBeCloseTo(expected)
  expect(turnProgress(entry({ etaMinutes }), 181000)).toBeCloseTo(expected)
})
it.each([null, undefined, 0, -1, 0.5, NaN, Infinity])(
  'does not invent a baseline for %s',
  (initialEtaMinutes) => {
    expect(turnProgress(entry({ initialEtaMinutes }), 1000)).toBeNull()
    expect(
      turnProgress(entry({ initialEtaMinutes, etaMinutes: 0 }), 1000),
    ).toBe(1)
  },
)
it.each(['unknown', undefined] as const)(
  'does not confuse %s quality with known zero',
  (estimateQuality) => {
    expect(
      turnProgress(entry({ etaMinutes: 0, estimateQuality }), 1000),
    ).toBeNull()
    expect(
      turnProgress(entry({ estimateQuality }, 'called'), 1000),
    ).toBeCloseTo(0.9)
  },
)
it.each([-1, NaN, Infinity])(
  'rejects invalid remaining ETA %s',
  (etaMinutes) => {
    expect(turnProgress(entry({ etaMinutes }), 1000)).toBeNull()
  },
)
it('uses server-synced deadline rather than ETA for calls, without inventing legacy timestamps', () => {
  const called = entry({ estimateQuality: 'unknown' }, 'called')
  expect(turnProgress(called, 181000)).toBeCloseTo(0.96)
  expect(turnProgress(called, 301000)).toBe(1)
  expect(
    turnProgress({ ...called, initialEtaMinutes: null }, 181000),
  ).toBeNull()
  expect(turnProgress({ ...called, initialEtaMinutes: null }, 301000)).toBe(1)
  called.customer!.calledAt = null
  expect(turnProgress(called, 301000)).toBeNull()
  called.customer!.calledAt = 1000
  called.customer!.arrivalDeadlineAt = null
  expect(turnProgress(called, 301000)).toBeNull()
})
it('renders terminal arrival/expiry full and cancellation without progress', () => {
  expect(
    turnProgress(entry({ initialEtaMinutes: null }, 'arrived'), 1000),
  ).toBe(1)
  expect(
    turnProgress(entry({ initialEtaMinutes: null }, 'expired'), 1000),
  ).toBe(1)
  expect(turnProgress(entry({}, 'cancelled'), 1000)).toBeNull()
})
