import type { ServiceInput } from '@noqueue/contracts/staff'
import type { Party, Resource } from './engine'

const MIN_CADENCE_MS = 15_000
const MIN_SAFETY_MS = 1_000
const MAX_LEARNED_OCCUPANCY_MINUTES = 1_440
const OBSERVATION_WINDOW = 30

/** Resources may expose a separately learned occupancy duration. */
export type AdaptiveResource = Resource & {
  occupancyMinutes?: number | null
}

export type AdaptiveProjection = {
  id: string
  position: number
  predictedAt: number
  quality: 'estimated' | 'provisional'
  cadenceMs: number
  resourceId: string | null
}

function positiveMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Resolve the configured starting cadence for a particular resource group.
 * Explicit table-type values take precedence over the legacy per-seat value,
 * then the service-wide setting, and finally the caller's baseline.
 */
export function configuredIntervalMinutes(
  config: ServiceInput | null,
  baseline: number,
  spaceId?: string,
  seats?: number,
): number {
  if (config && spaceId !== undefined && seats !== undefined) {
    const tableType =
      config.spaces
        .find((space) => space.id === spaceId)
        ?.tableTypes?.find((type) => type.seats === seats)
        ?.averageMinutes
    if (positiveMinutes(tableType)) return tableType

    const legacy = config.queueBySeat?.find((row) => row.seats === seats)
      ?.averageMinutes
    if (positiveMinutes(legacy)) return legacy
  }

  return config && positiveMinutes(config.averageMinutes)
    ? config.averageMinutes
    : positiveMinutes(baseline)
      ? baseline
      : 1
}

/**
 * Learn one service-level cadence multiplier from assignment intervals.
 * Ratios are chronological (oldest first); zero is a valid simultaneous call.
 */
export function cadenceFactor(ratios: number[]): number {
  const valid = ratios
    .filter((value) => Number.isFinite(value) && value >= 0)
    .slice(-OBSERVATION_WINDOW)
  if (valid.length < 3) return 1

  let weightedTotal = 5 // prior weight, centered on the configured cadence (1x)
  let totalWeight = 5
  for (const [index, value] of valid.entries()) {
    const weight = 1 + index / 10
    weightedTotal += value * weight
    totalWeight += weight
  }
  return weightedTotal / totalWeight
}

/** Learn occupancy duration only from real arrival→release observations. */
export function learnedOccupancyMinutes(
  observations: number[],
): number | null {
  const valid = observations
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value >= 1 &&
        value <= MAX_LEARNED_OCCUPANCY_MINUTES,
    )
    .slice(-OBSERVATION_WINDOW)
  if (valid.length < 3) return null

  let weightedTotal = 0
  let totalWeight = 0
  for (const [index, value] of valid.entries()) {
    const weight = 1 + index / 10
    weightedTotal += value * weight
    totalWeight += weight
  }
  return weightedTotal / totalWeight
}

/** Safety lead time before the currently predicted customer deadline. */
export function safetyMarginMs(
  cadenceMs: number,
  approachMinutes: number,
): number {
  const cadence = Number.isFinite(cadenceMs) ? Math.max(0, cadenceMs) : 0
  const approachLimit =
    Number.isFinite(approachMinutes) && approachMinutes > 0
      ? (approachMinutes * 60_000) / 2
      : Number.POSITIVE_INFINITY
  return Math.max(
    MIN_SAFETY_MS,
    Math.min(60_000, cadence / 4, approachLimit),
  )
}

/** Minimum extension after a safety check finds no assignment yet. */
export function protectionRemainingMs(
  cadenceMs: number,
  safetyMs: number,
  elapsedWithoutAssignmentMs: number,
): number {
  const cadence = Number.isFinite(cadenceMs) ? Math.max(0, cadenceMs) : 0
  const safety = Number.isFinite(safetyMs) ? Math.max(0, safetyMs) : 0
  const elapsed = Number.isFinite(elapsedWithoutAssignmentMs)
    ? Math.max(0, elapsedWithoutAssignmentMs)
    : 0
  return Math.max(cadence, 2 * safety, elapsed / 2)
}

function effectiveCadenceMs(
  config: ServiceInput | null,
  baseline: number,
  factor: number,
  spaceId?: string,
  seats?: number,
) {
  const factorValue = Number.isFinite(factor) ? Math.max(0, factor) : 1
  return Math.max(
    MIN_CADENCE_MS,
    configuredIntervalMinutes(config, baseline, spaceId, seats) *
      factorValue *
      60_000,
  )
}

function validOccupancyMinutes(value: number | null | undefined): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= MAX_LEARNED_OCCUPANCY_MINUTES
  )
}

/** Keep the scheduling rule shared with engine.ts without a runtime dependency. */
function eligibleAdaptiveResources(
  party: Party,
  resources: AdaptiveResource[],
  preference?: string,
): AdaptiveResource[] {
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

/**
 * Deterministic customer-facing forecast. Queue dispatch stays sequential
 * (configured interval per turn), while compatible known resources can delay
 * a dispatch until their modeled release. Unknown availability is never
 * treated as a callable resource; in that case cadence-only output is marked
 * provisional. Inputs are copied and never mutated.
 */
export function projectAdaptiveQueue(
  parties: Party[],
  resources: AdaptiveResource[],
  now: number,
  config: ServiceInput | null,
  baseline: number,
  factor: number,
): AdaptiveProjection[] {
  const slots = resources.map((resource) => ({
    ...resource,
    availableAt: resource.known ? resource.availableAt : null,
  }))
  const sortedParties = [...parties].sort(
    (left, right) => left.sequence - right.sequence,
  )
  let cursor = now

  return sortedParties.map((party, index) => {
    const eligible = eligibleAdaptiveResources(
      party,
      slots,
      config?.assignmentPreference,
    )
    const fallbackCadenceMs = Math.min(
      ...(
        eligible.length
          ? eligible.map((resource) =>
              effectiveCadenceMs(
                config,
                baseline,
                factor,
                resource.spaceId,
                resource.seats,
              ),
            )
          : [effectiveCadenceMs(config, baseline, factor)]
      ),
    )
    const nextCadenceAt = cursor + fallbackCadenceMs

    const candidates = eligible
      .filter(
        (resource) =>
          resource.known &&
          resource.availableAt !== null &&
          Number.isFinite(resource.availableAt),
      )
      .map((resource) => {
        const cadenceMs = effectiveCadenceMs(
          config,
          baseline,
          factor,
          resource.spaceId,
          resource.seats,
        )
        return {
          resource,
          cadenceMs,
          predictedAt: Math.max(cursor + cadenceMs, resource.availableAt!),
        }
      })
      .sort(
        (left, right) =>
          left.predictedAt - right.predictedAt ||
          left.resource.seats - right.resource.seats ||
          left.resource.id.localeCompare(right.resource.id),
      )
    const cadenceFallbackAt = nextCadenceAt
    const chosen = candidates[0]
    const hasUnknownAvailability = eligible.some(
      (resource) =>
        !resource.known ||
        resource.availableAt === null ||
        !Number.isFinite(resource.availableAt),
    )

    if (
      !chosen ||
      (hasUnknownAvailability && cadenceFallbackAt < chosen.predictedAt)
    ) {
      const predictedAt = cadenceFallbackAt
      cursor = predictedAt
      return {
        id: party.id,
        position: index + 1,
        predictedAt,
        quality: 'provisional' as const,
        cadenceMs: fallbackCadenceMs,
        resourceId: null,
      }
    }

    cursor = chosen.predictedAt
    const occupancy = chosen.resource.occupancyMinutes
    if (validOccupancyMinutes(occupancy)) {
      chosen.resource.availableAt =
        chosen.predictedAt + occupancy * 60_000
    } else {
      // We can forecast this assignment, but cannot promise when the resource
      // will next be free without real arrival→release history.
      chosen.resource.availableAt = null
      chosen.resource.known = false
    }

    return {
      id: party.id,
      position: index + 1,
      predictedAt: chosen.predictedAt,
      quality: 'estimated' as const,
      cadenceMs: chosen.cadenceMs,
      resourceId: chosen.resource.id,
    }
  })
}
