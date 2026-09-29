/** Pure scheduling model. Predictions never mutate actual resource occupancy. */
export type Resource = {
  id: string
  spaceId: string
  seats: number
  averageMinutes: number
  availableAt: number | null
  known: boolean
  callable?: boolean
}
export type Party = {
  id: string
  sequence: number
  partySize: number
  preferredSpaceId?: string | null
}
export type Projection = {
  id: string
  position: number
  etaMinutes: number
  predictedAt: number | null
  quality: 'estimated' | 'provisional' | 'unknown'
  resourceId: string | null
  callable: boolean
}
export function groupMinutes(
  baseline: number,
  observations: number[],
  adjustment: { minutes: number; expiresAt: number } | undefined,
  now: number,
) {
  if (adjustment && adjustment.expiresAt > now) return adjustment.minutes
  const valid = observations
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 1440)
    .slice(-30)
  if (valid.length < 3) return baseline
  // A five-observation prior avoids overfitting a new group. Newer samples weigh more.
  let total = baseline * 5,
    weight = 5
  for (const [index, value] of valid.entries()) {
    const w = 1 + index / 10
    total += value * w
    weight += w
  }
  return Math.round(total / weight)
}
export type Progress = { lastCallAt: number; cadenceMinutes: number }
/** Preference changes eligibility, not only ranking; commands and projection share it. */
export function eligibleResources(
  party: Party,
  resources: Resource[],
  preference = 'fastest',
): Resource[] {
  const compatible = resources.filter(
    (resource) => resource.seats >= party.partySize,
  )
  if (party.preferredSpaceId === 'fastest') return compatible
  if (party.preferredSpaceId)
    return compatible.filter(
      (resource) => resource.spaceId === party.preferredSpaceId,
    )
  const preferred = compatible.filter(
    (resource) => resource.spaceId === preference,
  )
  return preferred.length ? preferred : compatible
}
export function projectQueue(
  parties: Party[],
  resources: Resource[],
  now: number,
  preference = 'fastest',
  progress?: Progress,
): Projection[] {
  const slots = resources.map((r) => ({
    ...r,
    callable: r.callable ?? (r.availableAt !== null && r.availableAt <= now),
  }))
  return [...parties]
    .sort((a, b) => a.sequence - b.sequence)
    .map((party, index) => {
      const eligible = eligibleResources(party, slots, preference)
      const slot = eligible
        .filter((r) => r.availableAt !== null)
        .sort(
          (a, b) =>
            a.availableAt! - b.availableAt! ||
            a.seats - b.seats ||
            a.id.localeCompare(b.id),
        )[0]
      if (!slot) {
        const cadenceValid =
          progress &&
          Number.isFinite(progress.cadenceMinutes) &&
          progress.cadenceMinutes > 0 &&
          progress.lastCallAt <= now &&
          progress.lastCallAt + progress.cadenceMinutes * 60000 > now
        const predictedAt = cadenceValid
          ? progress.lastCallAt +
            (index + 1) * progress.cadenceMinutes * 60000
          : null
        return {
          id: party.id,
          position: index + 1,
          etaMinutes:
            predictedAt === null ? 0 : Math.ceil((predictedAt - now) / 60000),
          predictedAt,
          quality:
            predictedAt === null
              ? ('unknown' as const)
              : ('provisional' as const),
          resourceId: null,
          callable: false,
        }
      }
      const predictedAt = Math.max(now, slot.availableAt!)
      const callable = !!slot.callable && predictedAt <= now
      slot.callable = false
      slot.availableAt = predictedAt + slot.averageMinutes * 60000
      return {
        id: party.id,
        position: index + 1,
        etaMinutes: Math.ceil((predictedAt - now) / 60000),
        predictedAt,
        quality:
          slot.known &&
          !(
            predictedAt > now &&
            eligible.some((r) => !r.known && r.availableAt === null)
          )
            ? ('estimated' as const)
            : ('provisional' as const),
        resourceId: slot.id,
        callable,
      }
    })
}
