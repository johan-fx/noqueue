import { describe, expect, it } from 'vitest'
import type { MetricCounts } from '@noqueue/contracts/metrics'
import {
  DAY,
  comparison,
  contribution,
  emptyCounts,
  hourBucket,
  localParts,
  midnight,
  outcome,
  shiftDate,
  summarize,
} from './calculation'

const categories = [
  'completed',
  'cancelled',
  'noShow',
  'pending',
  'unknown',
] as const

describe('metric outcome contributions', () => {
  it.each([
    ['completed', 'completed'],
    ['served', 'completed'],
    ['cancelled', 'cancelled'],
    ['no_show', 'noShow'],
    ['expired', 'noShow'],
    ['waiting', 'pending'],
    ['called', 'pending'],
    ['unexpected_legacy_state', 'unknown'],
  ] as const)(
    'maps %s into exactly one conciliable cohort result',
    (status, expected) => {
      expect(outcome(status)).toBe(expected)

      const counts = contribution({
        status,
        created_at: 1_000,
        first_called_at: null,
      })
      expect(counts.generated).toBe(1)
      expect(categories.reduce((sum, key) => sum + counts[key], 0)).toBe(
        counts.generated,
      )
      expect(counts[expected]).toBe(1)
      for (const key of categories.filter((item) => item !== expected)) {
        expect(counts[key]).toBe(0)
      }
    },
  )

  it('uses a real first-call timestamp as the wait sample, and does not treat uncalled entries as zero wait', () => {
    const called = contribution({
      status: 'cancelled',
      created_at: 1_000,
      first_called_at: 61_125,
    })
    const uncalled = contribution({
      status: 'waiting',
      created_at: 1_000,
      first_called_at: null,
    })

    expect(called).toMatchObject({
      generated: 1,
      cancelled: 1,
      waitSumMs: 60_125,
      waitSamples: 1,
    })
    expect(uncalled).toMatchObject({
      generated: 1,
      pending: 1,
      waitSumMs: 0,
      waitSamples: 0,
    })
  })

  it('ignores a first-call timestamp that precedes admission', () => {
    expect(
      contribution({
        status: 'completed',
        created_at: 10_000,
        first_called_at: 9_999,
      }),
    ).toMatchObject({
      generated: 1,
      completed: 1,
      waitSumMs: 0,
      waitSamples: 0,
    })
  })

  it('summarizes weighted wait samples and attention only over resolved entries', () => {
    const counts: MetricCounts = {
      ...emptyCounts(),
      generated: 7,
      completed: 2,
      cancelled: 1,
      noShow: 1,
      pending: 2,
      unknown: 1,
      waitSumMs: 90_000,
      waitSamples: 3,
    }

    expect(summarize(counts, 4, 2)).toMatchObject({
      meanWaitMs: 30_000,
      attentionRate: 50,
      activeServices: 4,
      activeVenues: 2,
    })
  })

  it('returns null for wait and attention when their denominators are empty', () => {
    expect(summarize(emptyCounts(), 0, 0)).toMatchObject({
      meanWaitMs: null,
      attentionRate: null,
    })
  })
})

describe('metric comparisons', () => {
  it('calculates relative change for percent metrics', () => {
    expect(comparison(15, 12, 'percent')).toEqual({
      value: 25,
      unit: 'percent',
      reason: 'ok',
    })
  })

  it('handles a zero previous value without producing infinity', () => {
    expect(comparison(0, 0, 'percent')).toEqual({
      value: 0,
      unit: 'percent',
      reason: 'ok',
    })
    expect(comparison(3, 0, 'percent')).toEqual({
      value: null,
      unit: 'percent',
      reason: 'no_baseline',
    })
  })

  it('uses percentage-point and absolute differences for those metric units', () => {
    expect(comparison(58, 50, 'points')).toEqual({
      value: 8,
      unit: 'points',
      reason: 'ok',
    })
    expect(comparison(6, 4, 'absolute')).toEqual({
      value: 2,
      unit: 'absolute',
      reason: 'ok',
    })
  })

  it('returns null when either period is unavailable', () => {
    expect(comparison(null, 5, 'absolute')).toEqual({
      value: null,
      unit: 'absolute',
      reason: 'unavailable',
    })
    expect(comparison(5, null, 'percent')).toEqual({
      value: null,
      unit: 'percent',
      reason: 'unavailable',
    })
  })

  it('suppresses comparisons for provisional ranges even if a baseline is present', () => {
    expect(comparison(5, 2, 'percent', true)).toEqual({
      value: null,
      unit: 'percent',
      reason: 'provisional',
    })
    expect(comparison(null, 2, 'points', true)).toEqual({
      value: null,
      unit: 'points',
      reason: 'provisional',
    })
  })
})

describe('local calendar and hour buckets', () => {
  const timezone = 'Europe/Madrid'

  it('converts each local midnight independently across the 23-hour spring-forward day', () => {
    const start = midnight('2026-03-29', timezone)
    const end = midnight('2026-03-30', timezone)

    expect(new Date(start).toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(new Date(end).toISOString()).toBe('2026-03-29T22:00:00.000Z')
    expect(end - start).toBe(23 * 60 * 60 * 1000)
    expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30')
    expect(
      localParts(Date.parse('2026-03-29T01:30:00.000Z'), timezone),
    ).toMatchObject({
      date: '2026-03-29',
      hour: 3,
      minute: 30,
    })
  })

  it('converts each local midnight independently across the 25-hour fall-back day', () => {
    const start = midnight('2026-10-25', timezone)
    const end = midnight('2026-10-26', timezone)

    expect(new Date(start).toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(new Date(end).toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(end - start).toBe(25 * 60 * 60 * 1000)
    expect(
      localParts(Date.parse('2026-10-25T00:30:00.000Z'), timezone),
    ).toMatchObject({
      date: '2026-10-25',
      hour: 2,
      minute: 30,
    })
    expect(
      localParts(Date.parse('2026-10-25T01:30:00.000Z'), timezone),
    ).toMatchObject({
      date: '2026-10-25',
      hour: 2,
      minute: 30,
    })
  })

  it('keeps the two repeated 02:00 hours as distinct UTC buckets on fall-back day', () => {
    const first = hourBucket(Date.parse('2026-10-25T00:15:00.000Z'), timezone)
    const repeated = hourBucket(
      Date.parse('2026-10-25T01:15:00.000Z'),
      timezone,
    )

    expect(first).toMatchObject({
      date: '2026-10-25',
      hour: 2,
      start: Date.parse('2026-10-25T00:00:00.000Z'),
      end: Date.parse('2026-10-25T01:00:00.000Z'),
    })
    expect(repeated).toMatchObject({
      date: '2026-10-25',
      hour: 2,
      start: Date.parse('2026-10-25T01:00:00.000Z'),
      end: Date.parse('2026-10-25T02:00:00.000Z'),
    })
    expect(first.start).not.toBe(repeated.start)
  })

  it('ends the last local-hour bucket at the next local midnight when a queue interval crosses midnight', () => {
    const finalHour = hourBucket(
      Date.parse('2026-03-29T21:45:00.000Z'),
      timezone,
    )
    const nextDate = midnight('2026-03-30', timezone)

    expect(finalHour).toMatchObject({
      date: '2026-03-29',
      hour: 23,
      start: Date.parse('2026-03-29T21:00:00.000Z'),
      end: nextDate,
    })
    expect(finalHour.end - finalHour.start).toBe(60 * 60 * 1000)
    expect(finalHour.end).toBe(midnight(shiftDate(finalHour.date, 1), timezone))
  })
})

// Keep the fixed-width UTC calendar-day constant aligned with the expected shift helpers.
it('uses a fixed UTC day only for calendar date shifting', () => {
  expect(DAY).toBe(86_400_000)
})

it('uses real boundaries for a half-hour DST shift and a missing midnight', () => {
  const repeated = hourBucket(
    Date.parse('2026-04-04T15:10:00Z'),
    'Australia/Lord_Howe',
  )
  expect(repeated.start).toBe(Date.parse('2026-04-04T15:00:00Z'))
  expect(repeated.end).toBe(Date.parse('2026-04-04T15:30:00Z'))
  expect(midnight('2018-11-04', 'America/Sao_Paulo')).toBe(
    Date.parse('2018-11-04T03:00:00Z'),
  )
})
