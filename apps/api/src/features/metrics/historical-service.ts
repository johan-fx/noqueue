import { localParts } from './calculation'

/** The cutoff is an operator-verified deployment boundary, not the analytics
 * activation date. Earlier NULL snapshots may have been filled by maintenance. */
export function historicalServiceType(
  snapshot: string | null,
  createdAt: number,
  capturedSince?: string
): 'reception' | 'restaurant' | 'pool' | 'unknown' {
  const since = capturedSince ? Date.parse(capturedSince) : NaN
  if (
    !Number.isFinite(since) ||
    !Number.isFinite(createdAt) ||
    createdAt < since ||
    !snapshot
  )
    return 'unknown'
  const match =
    /^(continuous:(?:groups:)?|\d{4}-\d{2}-\d{2}:(?:full-day:|\d{2}:\d{2}:\d{2}:\d{2}:(?:groups:)?))(\[.*\])$/.exec(
      snapshot
    )
  if (!match) return 'unknown'
  try {
    const signature: unknown = JSON.parse(match[2]!)
    if (!Array.isArray(signature) || typeof signature[0] !== 'string')
      return 'unknown'
    const [timezone, type] = signature
    if (!['reception', 'restaurant', 'pool'].includes(type)) return 'unknown'
    const grouped =
      match[1]!.includes('groups:') || match[1]!.includes('full-day:')
    if (grouped) {
      const calendar = signature[3]
      if (
        signature.length !== 4 ||
        !Number.isFinite(signature[2]) ||
        !calendar ||
        !Array.isArray(calendar.allDayDays) ||
        !Array.isArray(calendar.schedules)
      )
        return 'unknown'
    } else if (
      signature.length !== 5 ||
      typeof signature[2] !== 'boolean' ||
      !Number.isFinite(signature[3]) ||
      !Array.isArray(signature[4])
    )
      return 'unknown'
    const date = localParts(createdAt, timezone).date // Also validates the IANA zone.
    // Full-day groups may be anchored to an earlier day in a consecutive group.
    if (!match[1]!.startsWith('continuous:')) {
      const anchor = match[1]!.slice(0, 10)
      if (match[1]!.includes('full-day:')) {
        const days = (Date.parse(date) - Date.parse(anchor)) / 86400000
        if (!Number.isInteger(days) || days < 0 || days > 6) return 'unknown'
      } else if (anchor !== date) return 'unknown'
    }
    return type
  } catch {
    return 'unknown'
  }
}
