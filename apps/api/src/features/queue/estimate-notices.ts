export type EstimateQuality = 'estimated' | 'provisional' | 'unknown'
export type EstimateNoticeKind = 'delayed' | 'improved'
export type AdaptiveCorrectionReason =
  | 'safety'
  | 'resources'
  | 'cadence'
  | 'configuration'

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

/**
 * Evaluate an adaptive-estimator correction from absolute forecast deadlines.
 * Unlike the legacy evaluator, provenance is already encoded in the current
 * and accepted deadlines, so natural countdown passage cannot create a notice.
 * A new safety revision is the one exception to the configured movement
 * threshold: the first protective extension must be communicated even when it
 * is smaller than the ordinary ETA-change threshold.
 */
export function evaluateAdaptiveNotice(input: {
  previousAcceptedAt: number | null
  currentPredictedAt: number | null
  lastCorrectionAcceptedAt: number | null
  thresholdMinutes: number
  cooldownMinutes: number
  now: number
  reason: AdaptiveCorrectionReason
  safetyRevision: number
  lastAcceptedSafetyRevision: number | null
}): EstimateNoticeKind | null {
  const {
    previousAcceptedAt,
    currentPredictedAt,
    lastCorrectionAcceptedAt,
    thresholdMinutes,
    cooldownMinutes,
    now,
    reason,
    safetyRevision,
    lastAcceptedSafetyRevision,
  } = input
  if (
    currentPredictedAt === null ||
    !Number.isFinite(currentPredictedAt) ||
    !Number.isFinite(now) ||
    currentPredictedAt <= now
  )
    return null

  if (
    lastCorrectionAcceptedAt !== null &&
    now - lastCorrectionAcceptedAt < Math.max(0, cooldownMinutes) * 60_000
  )
    return null

  if (
    reason === 'safety' &&
    Number.isInteger(safetyRevision) &&
    safetyRevision > (lastAcceptedSafetyRevision ?? 0)
  )
    return 'delayed'

  if (
    previousAcceptedAt === null ||
    !Number.isFinite(previousAcceptedAt)
  )
    return null

  const delta = currentPredictedAt - previousAcceptedAt
  const thresholdMs = Math.max(0, thresholdMinutes) * 60_000
  if (delta === 0 || Math.abs(delta) < thresholdMs) return null
  return delta > 0 ? 'delayed' : 'improved'
}
