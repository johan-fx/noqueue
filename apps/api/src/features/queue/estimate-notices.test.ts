import { describe, expect, it } from 'vitest'
import { evaluateEstimateNotice } from './estimate-notices'

describe('evaluateEstimateNotice', () => {
  const base = {
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
