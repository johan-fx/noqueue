export type EstimateQuality = 'estimated' | 'provisional' | 'unknown'
export type EstimateNoticeKind = 'delayed' | 'improved'

export function evaluateEstimateNotice(input: {
  previousAcceptedAt: number | null
  currentPredictedAt: number | null
  quality: EstimateQuality
  lastCorrectionAcceptedAt: number | null
  thresholdMinutes: number
  cooldownMinutes: number
  now: number
}): EstimateNoticeKind | null {
  const {
    previousAcceptedAt,
    currentPredictedAt,
    quality,
    lastCorrectionAcceptedAt,
    thresholdMinutes,
    cooldownMinutes,
    now,
  } = input
  if (
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
