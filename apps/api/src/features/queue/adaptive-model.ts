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
    const tableType = config.spaces
      .find((space) => space.id === spaceId)
      ?.tableTypes?.find((type) => type.seats === seats)?.averageMinutes
    if (positiveMinutes(tableType)) return tableType

    const legacy = config.queueBySeat?.find(
      (row) => row.seats === seats,
    )?.averageMinutes
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
export function cadenceFactor(ratios: number[], prior = 1): number {
  const valid = ratios
    .filter((value) => Number.isFinite(value) && value >= 0)
    .slice(-OBSERVATION_WINDOW)
  if (valid.length < 3) return prior

  let weightedTotal = 5 * prior // hierarchical prior, weight five
  let totalWeight = 5
  for (const [index, value] of valid.entries()) {
    const weight = 1 + index / 10
    weightedTotal += value * weight
    totalWeight += weight
  }
  return weightedTotal / totalWeight
}

/** Learn occupancy duration only from real arrival→release observations. */
export function learnedOccupancyMinutes(observations: number[]): number | null {
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
  return Math.max(MIN_SAFETY_MS, Math.min(60_000, cadence / 4, approachLimit))
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

export type EstimateContext = {
  spaceId: string | null
  seats: number | null
  baselineMinutes: number
  provenance: 'confirmed' | 'inferred' | 'general'
}

/** Requested context only: this never claims an actual physical allocation. */
export function resolveEstimateContext(
  party: Pick<Party, 'partySize' | 'preferredSpaceId'>,
  config: ServiceInput | null,
  baseline: number,
): EstimateContext {
  const spaceId =
    party.preferredSpaceId && party.preferredSpaceId !== 'fastest'
      ? party.preferredSpaceId
      : null
  const type = spaceId
    ? config?.spaces
        .find((s) => s.id === spaceId)
        ?.tableTypes?.filter((t) => t.seats >= party.partySize)
        .sort((a, b) => a.seats - b.seats)[0]
    : undefined
  return {
    spaceId,
    seats: type?.seats ?? null,
    baselineMinutes: configuredIntervalMinutes(
      config,
      baseline,
      spaceId ?? undefined,
      type?.seats,
    ),
    provenance: type ? 'inferred' : 'general',
  }
}
export type ContextualFactors = {
  service: number
  learned: boolean
  zones: Map<string, number>
  types: Map<string, number>
}
export function contextKey(spaceId: string, seats: number) {
  return JSON.stringify([spaceId, seats])
}
export type ContextSample = {
  space_id: string
  seats: number | null
  ratio: number
}
/** Inputs are chronological and contain only validated human capacity samples. */
export function learnContextualFactors(
  config: ServiceInput,
  serviceRatios: number[],
  observations: ContextSample[],
): ContextualFactors {
  const factors: ContextualFactors = {
    service: cadenceFactor(serviceRatios),
    learned: serviceRatios.length >= 3,
    zones: new Map(),
    types: new Map(),
  }
  for (const space of config.spaces) {
    if (!space.id) continue
    const rows = observations.filter((r) => r.space_id === space.id)
    const zone = cadenceFactor(
      rows.map((r) => r.ratio),
      factors.service,
    )
    factors.zones.set(space.id, zone)
    for (const type of space.tableTypes ?? [])
      factors.types.set(
        contextKey(space.id, type.seats),
        cadenceFactor(
          rows.filter((r) => r.seats === type.seats).map((r) => r.ratio),
          zone,
        ),
      )
  }
  return factors
}
export function contextualFactor(
  context: EstimateContext,
  factors: ContextualFactors,
) {
  const zone = context.spaceId
    ? factors.zones.get(context.spaceId) ?? factors.service
    : factors.service
  return context.spaceId && context.seats !== null
    ? factors.types.get(contextKey(context.spaceId, context.seats)) ?? zone
    : zone
}
export function forecastInterval(
  party: Pick<Party, 'partySize' | 'preferredSpaceId'>,
  config: ServiceInput | null,
  baseline: number,
  factors: ContextualFactors,
) {
  const context = resolveEstimateContext(party, config, baseline)
  // Predictive alternatives are deliberately not written into assignment evidence.
  const alternatives =
    !context.spaceId && config?.type === 'restaurant'
      ? config.spaces
          .map((s) =>
            resolveEstimateContext(
              { ...party, preferredSpaceId: s.id ?? null },
              config,
              baseline,
            ),
          )
          .filter((c) => c.seats !== null)
      : []
  const candidates = alternatives.length ? alternatives : [context]
  return {
    cadenceMs: Math.max(
      MIN_CADENCE_MS,
      Math.min(
        ...candidates.map(
          (c) => c.baselineMinutes * contextualFactor(c, factors) * 60_000,
        ),
      ),
    ),
    quality:
      factors.learned &&
      (config?.type !== 'restaurant' || context.provenance === 'inferred')
        ? ('estimated' as const)
        : ('provisional' as const),
  }
}
export function compatibleSuccessor(
  source: Pick<Party, 'partySize' | 'preferredSpaceId'>,
  candidate: Pick<Party, 'partySize' | 'preferredSpaceId'>,
  context: EstimateContext,
) {
  const zone =
    candidate.preferredSpaceId && candidate.preferredSpaceId !== 'fastest'
      ? candidate.preferredSpaceId
      : null
  return (
    (zone === context.spaceId ||
      (context.provenance === 'confirmed' && zone === null)) &&
    candidate.partySize <= (context.seats ?? source.partySize)
  )
}

/** Serial dispatch; inventory quantities and availability are not throughput. */
export function projectAdaptiveQueue(
  parties: Party[],
  _resources: AdaptiveResource[],
  now: number,
  config: ServiceInput | null,
  baseline: number,
  factor: number | ContextualFactors,
): AdaptiveProjection[] {
  const factors =
    typeof factor === 'number'
      ? {
          service: factor,
          learned: false,
          zones: new Map<string, number>(),
          types: new Map<string, number>(),
        }
      : factor
  let cursor = now
  return [...parties]
    .sort((a, b) => a.sequence - b.sequence)
    .map((party, index) => {
      const interval = forecastInterval(party, config, baseline, factors)
      cursor += interval.cadenceMs
      return {
        id: party.id,
        position: index + 1,
        predictedAt: cursor,
        ...interval,
        resourceId: null,
      }
    })
}
