import type { Entry } from '@noqueue/contracts/queue'

/** Timestamp-based waiting time only; legacy snapshots must not invent seconds. */
export function remainingWaitMs(entry: Entry, now: number): number | null {
  if (
    !['estimated', 'provisional'].includes(entry.estimateQuality ?? '') ||
    !Number.isFinite(entry.etaMinutes) ||
    entry.etaMinutes < 0 ||
    entry.predictedAt == null ||
    !Number.isFinite(entry.predictedAt) ||
    !Number.isFinite(now)
  )
    return null
  return Math.max(0, entry.predictedAt - now)
}

/** One immutable denominator; current estimates may legitimately move backwards. */
export function turnProgress(entry: Entry, now: number): number | null {
  const customer = entry.customer
  if (!customer || customer.phase === 'cancelled') return null
  if (customer.phase === 'arrived' || customer.phase === 'expired') return 1
  let remaining: number
  if (customer.phase === 'called') {
    if (
      customer.calledAt == null ||
      customer.arrivalDeadlineAt == null ||
      !Number.isFinite(customer.calledAt) ||
      !Number.isFinite(customer.arrivalDeadlineAt) ||
      !Number.isFinite(now) ||
      customer.arrivalDeadlineAt < customer.calledAt
    )
      return null
    remaining = Math.max(0, customer.arrivalDeadlineAt - now) / 60000
    if (remaining === 0) return 1
  } else {
    if (
      entry.estimateQuality == null ||
      entry.estimateQuality === 'unknown' ||
      !Number.isFinite(entry.etaMinutes) ||
      entry.etaMinutes < 0
    )
      return null
    const waitMs = remainingWaitMs(entry, now)
    remaining = waitMs == null ? entry.etaMinutes : waitMs / 60000
    if (waitMs == null && remaining === 0) return 1
  }
  const initial = entry.initialEtaMinutes
  if (
    initial == null ||
    !Number.isFinite(initial) ||
    initial <= 0 ||
    !Number.isInteger(initial)
  )
    return null
  return Math.max(0, Math.min(1, 1 - remaining / initial))
}
