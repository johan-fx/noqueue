import type { Entry } from '@noqueue/contracts/queue'

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
  } else {
    if (
      entry.estimateQuality == null ||
      entry.estimateQuality === 'unknown' ||
      !Number.isFinite(entry.etaMinutes) ||
      entry.etaMinutes < 0
    )
      return null
    remaining = entry.etaMinutes
  }
  if (remaining === 0) return 1
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
