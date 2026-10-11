import { describe, expect, it } from 'vitest'
import {
  evaluateAdaptiveNotice,
  evaluateEstimateNotice,
} from './estimate-notices'

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

describe('evaluateAdaptiveNotice', () => {
  const base = {
    previousAcceptedAt: 60 * 60_000,
    currentPredictedAt: 61 * 60_000,
    lastCorrectionAcceptedAt: null,
    thresholdMinutes: 5,
    cooldownMinutes: 10,
    now: 20 * 60_000,
    reason: 'cadence' as const,
    safetyRevision: 0,
    lastAcceptedSafetyRevision: null,
  }

  it('compares absolute deadlines, not elapsed countdown time', () => {
    expect(evaluateAdaptiveNotice(base)).toBeNull()
    expect(
      evaluateAdaptiveNotice({
        ...base,
        currentPredictedAt: 66 * 60_000,
      }),
    ).toBe('delayed')
    expect(
      evaluateAdaptiveNotice({
        ...base,
        currentPredictedAt: 54 * 60_000,
      }),
    ).toBe('improved')
  })

  it('forces a first positive safety extension below the ordinary threshold', () => {
    expect(
      evaluateAdaptiveNotice({
        ...base,
        currentPredictedAt: 62 * 60_000,
        reason: 'safety',
        safetyRevision: 1,
      }),
    ).toBe('delayed')
  })

  it('does not resend an accepted safety revision and still enforces cooldown', () => {
    expect(
      evaluateAdaptiveNotice({
        ...base,
        previousAcceptedAt: 60 * 60_000,
        currentPredictedAt: 62 * 60_000,
        reason: 'safety',
        safetyRevision: 2,
        lastAcceptedSafetyRevision: 2,
      }),
    ).toBeNull()
    expect(
      evaluateAdaptiveNotice({
        ...base,
        currentPredictedAt: 62 * 60_000,
        reason: 'safety',
        safetyRevision: 3,
        lastCorrectionAcceptedAt: base.now - 1,
      }),
    ).toBeNull()
  })

  it('requires a future forecast for safety and ordinary corrections', () => {
    expect(
      evaluateAdaptiveNotice({
        ...base,
        currentPredictedAt: base.now,
        reason: 'safety',
        safetyRevision: 1,
      }),
    ).toBeNull()
  })
})
