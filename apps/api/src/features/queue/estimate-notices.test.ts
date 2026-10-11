import { describe, expect, it } from 'vitest'
import { evaluateEstimateNotice } from './estimate-notices'

describe('evaluateEstimateNotice', () => {
  const base = {
    previousAcceptedOperationalDeltaMs: 0,
    currentOperationalDeltaMs: 5 * 60_000,
    now: 100_000,
    previousAcceptedAt: 1_000,
    lastCorrectionAcceptedAt: null,
    thresholdMinutes: 5,
    cooldownMinutes: 10,
  }

  it('does not treat countdown passage as an ETA change', () => {
    expect(
      evaluateEstimateNotice({
        ...base,
        currentPredictedAt: 1_000 + 4 * 60_000,
        quality: 'estimated',
      }),
    ).toBeNull()
  })

  it('uses an absolute predicted-time shift and distinguishes delay from improvement', () => {
    expect(
      evaluateEstimateNotice({
        ...base,
        currentPredictedAt: 1_000 + 5 * 60_000,
        quality: 'estimated',
      }),
    ).toBe('delayed')
    expect(
      evaluateEstimateNotice({
        ...base,
        currentPredictedAt: 1_000 - 5 * 60_000,
        currentOperationalDeltaMs: -5 * 60_000,
        quality: 'estimated',
      }),
    ).toBe('improved')
  })

  it('suppresses unknown or missing ETA and waits through cooldown', () => {
    expect(
      evaluateEstimateNotice({
        ...base,
        currentPredictedAt: null,
        quality: 'unknown',
      }),
    ).toBeNull()
    expect(
      evaluateEstimateNotice({
        ...base,
        currentPredictedAt: 1_000 + 6 * 60_000,
        quality: 'estimated',
        lastCorrectionAcceptedAt: 99_999,
      }),
    ).toBeNull()
  })
})

it('rejects clock-only floating forecasts across multiple cooldowns', () => {
  for (const now of [20, 40, 60].map((minutes) => minutes * 60_000)) {
    for (const remaining of [0, 30])
      expect(
        evaluateEstimateNotice({
          previousAcceptedAt: 0,
          currentPredictedAt: now + remaining * 60_000,
          quality: 'estimated',
          previousAcceptedOperationalDeltaMs: 0,
          currentOperationalDeltaMs: 0,
          lastCorrectionAcceptedAt: null,
          thresholdMinutes: 5,
          cooldownMinutes: 10,
          now,
        }),
      ).toBeNull()
  }
})
it('requires both signed operational and absolute movement, including live positive delay', () => {
  const base = {
    previousAcceptedAt: 60 * 60_000,
    currentPredictedAt: 70 * 60_000,
    quality: 'estimated' as const,
    previousAcceptedOperationalDeltaMs: 0,
    currentOperationalDeltaMs: 10 * 60_000,
    lastCorrectionAcceptedAt: null,
    thresholdMinutes: 5,
    cooldownMinutes: 10,
    now: 20 * 60_000,
  }
  expect(evaluateEstimateNotice(base)).toBe('delayed')
  expect(
    evaluateEstimateNotice({
      ...base,
      currentOperationalDeltaMs: -10 * 60_000,
    }),
  ).toBeNull()
  expect(
    evaluateEstimateNotice({ ...base, currentOperationalDeltaMs: 4 * 60_000 }),
  ).toBeNull()
  expect(
    evaluateEstimateNotice({ ...base, now: base.currentPredictedAt }),
  ).toBeNull()
  expect(
    evaluateEstimateNotice({
      ...base,
      previousAcceptedOperationalDeltaMs: null,
    }),
  ).toBeNull()
})
