import { forecastInterval } from './adaptive-model'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { type Party, type Projection, type Resource } from './engine'

/** Configured service work, never learned durations or fictitious occupancy. */
export function configuredCustomerWork(
  parties: Party[],
  _resources: Resource[],
  config: ServiceInput | null,
  baseline: number,
) {
  let total = 0
  return new Map(
    [...parties]
      .sort((a, b) => a.sequence - b.sequence)
      .map((party) => {
        total += forecastInterval(party, config, baseline, {
          service: 1,
          learned: false,
          zones: new Map(),
          types: new Map(),
        }).cadenceMs
        return [party.id, total] as const
      }),
  )
}

export type CustomerMinimum = {
  minimumAt: number
  configuredWorkMs: number
  initialEtaMinutes: number
}
export function customerMinimum(
  prior: CustomerMinimum | null,
  configuredWorkMs: number,
  now: number,
  adjust: boolean,
): CustomerMinimum {
  return prior
    ? {
        ...prior,
        minimumAt:
          prior.minimumAt +
          (adjust ? configuredWorkMs - prior.configuredWorkMs : 0),
        configuredWorkMs: adjust ? configuredWorkMs : prior.configuredWorkMs,
      }
    : {
        minimumAt: now + configuredWorkMs,
        configuredWorkMs,
        initialEtaMinutes: Math.ceil(configuredWorkMs / 60000),
      }
}

/** Rebase credible real changes; keep clock-only refreshes on their stable deadline. */
export function stableOperationalAt(
  rawAt: number | null,
  priorAt: number | null,
  beforeRawAt?: number | null,
) {
  return rawAt === null
    ? null
    : priorAt === null || (beforeRawAt !== undefined && beforeRawAt !== rawAt)
    ? rawAt
    : priorAt
}

/** Available-now operational forecasts cannot restart an elapsed customer clock. */
export function customerEstimate(
  raw: Pick<Projection, 'predictedAt' | 'quality'>,
  minimumAt: number | null,
  now: number,
) {
  if (minimumAt === null || !Number.isFinite(minimumAt))
    return {
      predictedAt: raw.predictedAt,
      estimateQuality: raw.quality,
      etaMinutes:
        raw.predictedAt === null
          ? 0
          : Math.max(0, Math.ceil((raw.predictedAt - now) / 60000)),
    }
  const operational =
    raw.quality !== 'unknown' &&
    raw.predictedAt !== null &&
    Number.isFinite(raw.predictedAt) &&
    raw.predictedAt > now
      ? raw.predictedAt
      : null
  const predictedAt = Math.max(minimumAt, operational ?? -Infinity)
  return {
    predictedAt,
    estimateQuality:
      operational !== null && operational > minimumAt
        ? raw.quality
        : ('provisional' as const),
    etaMinutes: Math.max(0, Math.ceil((predictedAt - now) / 60000)),
  }
}

function customerOperationalSql(alias: string) {
  return `(CASE WHEN ${alias}.quality!='unknown' THEN COALESCE(${alias}.customer_operational_at,${alias}.predicted_at) END)`
}
/** Matching SQL for bounded public aggregation; no historical scan or recalc. */
export function customerDeadlineSql(now: number, alias = 'p') {
  const raw = customerOperationalSql(alias)
  return `CASE WHEN ${alias}.estimator_version=2 THEN (SELECT ap.predicted_at FROM queue_adaptive_projection ap WHERE ap.entry_id=${alias}.entry_id) WHEN ${alias}.customer_minimum_at IS NOT NULL THEN MAX(${alias}.customer_minimum_at,CASE WHEN ${raw}>${Math.trunc(
    now,
  )} THEN ${raw} ELSE ${alias}.customer_minimum_at END) WHEN ${alias}.quality!='unknown' THEN ${alias}.predicted_at END`
}
export function customerProvisionalSql(now: number, alias = 'p') {
  const raw = customerOperationalSql(alias)
  return `CASE WHEN ${alias}.estimator_version=2 THEN (SELECT ap.quality!='estimated' FROM queue_adaptive_projection ap WHERE ap.entry_id=${alias}.entry_id) ELSE (${alias}.quality!='estimated' OR ( (${alias}.customer_minimum_at IS NOT NULL AND (${raw} IS NULL OR ${raw}<=${alias}.customer_minimum_at OR ${raw}<=${Math.trunc(
    now,
  )})))) END`
}
export function publicCustomerAverage(input: {
  sum: number
  count: number
  provisional: boolean
  waiting: number
  active: boolean
  configuredMinutes: number
  adaptive?: boolean
}) {
  if (!input.active || (!input.count && input.waiting))
    return {
      averageWaitMinutes: null,
      averageWaitQuality: 'unknown' as const,
    }
  const mean = input.count ? Math.round(input.sum / input.count) : 0
  return {
    averageWaitMinutes:
      input.adaptive && input.count
        ? Math.max(1, mean)
        : Math.max(input.configuredMinutes, mean),
    averageWaitQuality:
      !input.count ||
      input.provisional ||
      (!input.adaptive && mean < input.configuredMinutes)
        ? ('provisional' as const)
        : ('estimated' as const),
  }
}
