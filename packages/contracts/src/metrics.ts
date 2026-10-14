import { z } from 'zod'

export const metricsQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  venueId: z.string().min(1).max(128).optional(),
  serviceType: z.enum(['restaurant', 'reception', 'pool']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
})
export type MetricsQuery = z.infer<typeof metricsQuerySchema>
export type MetricComparison = {
  value: number | null
  unit: 'percent' | 'points' | 'absolute'
  reason: 'ok' | 'no_baseline' | 'unavailable' | 'provisional'
}
export type MetricValue = {
  value: number | null
  sampleSize: number
  comparison: MetricComparison
}
export type MetricCounts = {
  generated: number
  completed: number
  cancelled: number
  noShow: number
  pending: number
  unknown: number
  waitSumMs: number
  waitSamples: number
}
export type MetricsSummary = MetricCounts & {
  meanWaitMs: number | null
  attentionRate: number | null
  activeServices: number
  activeVenues: number
}
export type MetricsPattern = {
  serviceType: string
  peakHour: number | null
  peakWaitMs: number | null
  peakQueuePeople: number | null
  startMinute: number | null
  endMinute: number | null
  observedDays: number
}
export type MetricsResponse = {
  period: {
    from: string
    to: string
    timezone: string
    provisional: boolean
    previous: { from: string; to: string }
  }
  summary: MetricsSummary
  executive: {
    completed: MetricValue
    meanWaitMs: MetricValue
    attentionRate: MetricValue
    activeServices: MetricValue
  }
  trend: Array<{
    date: string
    generated: number | null
    completed: number | null
  }>
  patterns: { overall: MetricsPattern; services: MetricsPattern[] }
  services: Array<{
    serviceType: string
    generated: number
    comparison: MetricComparison
  }>
  venues: {
    items: Array<
      MetricsSummary & {
        venueId: string
        name: string
        peakHour: number | null
      }
    >
    page: number
    pageSize: number
    total: number
  }
  coverage: {
    notes?: string[]
    status: 'complete' | 'partial' | 'unavailable'
    since: number | null
    historical: boolean
    volume: 'complete' | 'partial' | 'unavailable'
    wait: 'complete' | 'partial' | 'unavailable'
    occupancy: 'complete' | 'partial' | 'unavailable'
  }
  freshness: {
    lastCompleteAt: number | null
    nextRefreshAt: number
    updating: boolean
    delayed: boolean
  }
}
export type MetricsVenuePage = {
  items: Array<{ id: string; name: string; timezone: string }>
  page: number
  hasMore: boolean
}
