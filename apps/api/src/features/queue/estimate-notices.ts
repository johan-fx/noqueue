export type EstimateQuality = 'estimated' | 'provisional' | 'unknown'
export type EstimateNoticeKind = 'delayed' | 'improved'

export function evaluateEstimateNotice(input: {
  previousAcceptedOperationalDeltaMs: number | null
  currentOperationalDeltaMs: number
  previousAcceptedMinimumAt?: number | null
  currentMinimumAt?: number
  currentOperationalPredictedAt?: number | null
  previousAcceptedAt: number | null
  currentPredictedAt: number | null
  quality: EstimateQuality
  lastCorrectionAcceptedAt: number | null
  thresholdMinutes: number
  cooldownMinutes: number
  now: number
}): EstimateNoticeKind | null {
  const {
    previousAcceptedOperationalDeltaMs,
    currentOperationalDeltaMs,
    previousAcceptedAt,
    currentPredictedAt,
    quality,
    lastCorrectionAcceptedAt,
    thresholdMinutes,
    cooldownMinutes,
    now,
  } = input
  const rawOperationalDelta =
    previousAcceptedOperationalDeltaMs === null
      ? NaN
      : currentOperationalDeltaMs - previousAcceptedOperationalDeltaMs
  // Counterfactual uses the SAME current instant: clock drift is not causal work.
  // Keep raw operational provenance and configured minimum evidence separate.
  const operationalDelta =
    input.currentMinimumAt === undefined
      ? rawOperationalDelta
      : input.previousAcceptedMinimumAt == null
        ? NaN
        : Math.max(
          input.currentOperationalPredictedAt ?? -Infinity,
          input.currentMinimumAt,
        ) - Math.max(
          input.currentOperationalPredictedAt == null
            ? -Infinity
            : input.currentOperationalPredictedAt - rawOperationalDelta,
          input.previousAcceptedMinimumAt,
        )
  const forecastDelta =
    currentPredictedAt === null || previousAcceptedAt === null
      ? NaN
      : currentPredictedAt - previousAcceptedAt
  if (
    !Number.isFinite(operationalDelta) ||
    Math.abs(operationalDelta) < thresholdMinutes * 60_000 ||
    Math.sign(operationalDelta) !== Math.sign(forecastDelta) ||
    (forecastDelta > 0 && (currentPredictedAt ?? 0) <= now) ||
    previousAcceptedAt === null ||
    currentPredictedAt === null ||
    quality === 'unknown' ||
    !Number.isFinite(currentPredictedAt) ||
    !Number.isFinite(previousAcceptedAt) ||
    Math.abs(currentPredictedAt - previousAcceptedAt) < thresholdMinutes * 60_000
  )
    return null
  if (
    lastCorrectionAcceptedAt !== null &&
    now - lastCorrectionAcceptedAt < cooldownMinutes * 60_000
  )
    return null
  return currentPredictedAt > previousAcceptedAt ? 'delayed' : 'improved'
}
