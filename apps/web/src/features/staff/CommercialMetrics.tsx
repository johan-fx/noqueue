import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type {
  MetricComparison,
  MetricsResponse,
  MetricsVenuePage,
} from '@noqueue/contracts/metrics'
import {
  RefreshCw,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api, errorMessage } from './api'
import userCheckIcon from '@/assets/metrics/user-check.svg'
import timerIcon from '@/assets/metrics/timer.svg'
import lineChartIcon from '@/assets/metrics/line-chart.svg'
import layersIcon from '@/assets/metrics/layers.svg'
import conciergeBellIcon from '@/assets/metrics/concierge-bell.svg'
import utensilsIcon from '@/assets/metrics/utensils.svg'
import martiniIcon from '@/assets/metrics/martini.svg'
import { periodRange, type PeriodKey } from './metricsPeriod'

type Venue = MetricsVenuePage['items'][number]

const PERIODS: Record<PeriodKey, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  last7: 'Últimos 7 días completos',
  last30: 'Últimos 30 días completos',
  last90: 'Últimos 90 días completos',
  thisMonth: 'Mes actual',
  lastMonth: 'Mes anterior',
  last12Months: 'Últimos 12 meses completos',
}
const PERIOD_KEYS = Object.keys(PERIODS) as PeriodKey[]
const SERVICE_LABELS: Record<string, string> = {
  reception: 'Recepción',
  restaurant: 'Restauración',
  pool: 'Bar / piscina',
  unknown: 'Sin determinar',
}
const SERVICE_ICONS: Record<string, string> = {
  reception: conciergeBellIcon,
  restaurant: utensilsIcon,
  pool: martiniIcon,
}
const VENUE_MARKERS = ['#a855f7', '#2563eb', '#06b6d4', '#f59e0b']
const RESULT_ROWS = [
  { key: 'completed', label: 'Completados', color: 'bg-emerald-500' },
  { key: 'cancelled', label: 'Cancelados', color: 'bg-rose-400' },
  { key: 'noShow', label: 'No presentados', color: 'bg-amber-400' },
  { key: 'pending', label: 'Pendientes', color: 'bg-sky-400' },
  { key: 'unknown', label: 'Sin clasificar', color: 'bg-slate-400' },
] as const

function formatCount(value: number | null | undefined) {
  return value == null ? '—' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value)
}

function formatWait(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  const seconds = Math.max(0, Math.round(value / 1000))
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return minutes ? `${minutes} min ${String(remaining).padStart(2, '0')} s` : `${remaining} s`
}

function formatRate(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? '—'
    : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(value)} %`
}

function formatComparison(comparison: MetricComparison, absoluteLabel = '') {
  if (comparison.reason === 'provisional') return 'Periodo en curso'
  if (comparison.reason === 'no_baseline') return 'Sin base comparable'
  if (comparison.reason === 'unavailable' || comparison.value == null) return 'Sin comparación'
  const value = Math.abs(comparison.value)
  const prefix = comparison.value > 0 ? '+' : comparison.value < 0 ? '−' : ''
  const formatted = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(value)
  if (comparison.unit === 'points') return `${prefix}${formatted} pp`
  if (comparison.unit === 'absolute') return `${prefix}${formatted}${absoluteLabel ? ` ${absoluteLabel}` : ''}`
  return `${prefix}${formatted} %`
}

function formatHour(hour: number | null) {
  return hour == null ? '—' : `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`
}

function formatMinute(minute: number | null, end = false) {
  if (minute == null) return '—'
  const rounded = Math.round(minute)
  if (end && rounded >= 1440) return '24:00'
  const normalized = Math.max(0, Math.min(1439, rounded))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function shortDate(value: string | number) {
  const raw = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return `${raw.slice(8, 10)}/${raw.slice(5, 7)}`
}

function MetricDelta({ comparison, lowerIsBetter = false, absoluteLabel }: { comparison: MetricComparison; lowerIsBetter?: boolean; absoluteLabel?: string | undefined }) {
  const positive = comparison.value != null && (lowerIsBetter ? comparison.value < 0 : comparison.value > 0)
  const negative = comparison.value != null && (lowerIsBetter ? comparison.value > 0 : comparison.value < 0)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span
        className={`inline-flex max-w-full items-center rounded-full px-2 py-1 text-[11px] font-medium ${positive ? 'bg-emerald-50 text-emerald-700' : negative ? 'bg-rose-50 text-rose-700' : 'bg-muted text-muted-foreground'}`}
      >
        {formatComparison(comparison, absoluteLabel)}
      </span>
      {comparison.reason === 'ok' && <span className="text-[11px] text-muted-foreground">vs. periodo anterior</span>}
    </span>
  )
}

function MetricCard({
  title,
  value,
  comparison,
  iconSrc,
  detail,
  lowerIsBetter,
  absoluteLabel,
}: {
  title: string
  value: string
  comparison: MetricComparison
  iconSrc: string
  detail: string
  lowerIsBetter?: boolean
  absoluteLabel?: string | undefined
}) {
  return (
    <Card className="min-h-[158px] gap-3 border border-slate-100 p-5 shadow-[0_2px_7px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{title}</p>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <img src={iconSrc} alt="" />
        </span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-[26px] leading-none font-semibold tracking-tight">{value}</p>
        <MetricDelta comparison={comparison} lowerIsBetter={!!lowerIsBetter} absoluteLabel={absoluteLabel} />
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Card>
  )
}

function LegendDot({ color, children }: { color: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  )
}

function PatternSummary({ data }: { data: MetricsResponse['patterns']['overall'] }) {
  const values = [
    { label: 'Franja de máxima demanda', value: formatHour(data.peakHour) },
    { label: 'Espera media en hora punta', value: formatWait(data.peakWaitMs) },
    {
      label: 'Personas esperando de media',
      value: data.peakQueuePeople == null
        ? '—'
        : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(data.peakQueuePeople),
    },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {values.map((item) => (
        <div key={item.label} className="min-h-[118px] rounded-xl border bg-muted/20 p-4">
          <p className="text-xs leading-5 text-muted-foreground">{item.label}</p>
          <p className="mt-3 text-xl font-semibold tracking-tight">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

function CoverageNotice({ data }: { data: MetricsResponse }) {
  const messages: string[] = [...(data.coverage.notes ?? [])]
  if (data.coverage.status === 'partial') {
    messages.push('El histórico disponible es parcial; los indicadores afectados se muestran con su cobertura real.')
  } else if (data.coverage.status === 'unavailable') {
    messages.push('Todavía no hay cobertura analítica suficiente para este periodo.')
  }
  if (data.coverage.volume === 'partial') messages.push('El conteo de altas tiene cobertura parcial.')
  else if (data.coverage.volume === 'unavailable' && data.coverage.status !== 'unavailable') {
    messages.push('No hay cobertura suficiente para calcular el volumen de altas.')
  }
  if (data.coverage.wait === 'unavailable') messages.push('Sin muestras suficientes para calcular la espera media.')
  else if (data.coverage.wait === 'partial') messages.push('La espera solo incluye turnos con primera llamada acreditada; la cobertura es parcial.')
  if (data.coverage.occupancy !== 'complete') {
    messages.push('Los patrones de ocupación pueden no cubrir todas las horas del periodo.')
  }
  if (data.period.provisional) {
    messages.push('El periodo incluye hoy y es provisional; no se compara con días completos.')
  }
  if (data.freshness.delayed) {
    messages.push('La actualización lleva más de 30 minutos de retraso.')
  }
  if (!messages.length) return null
  return (
    <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      {messages.map((message) => <p key={message}>{message}</p>)}
    </div>
  )
}

function MetricsContent({ data, onPage, busy }: {
  data: MetricsResponse
  onPage: (page: number) => void
  busy: boolean
}) {
  const summary = data.summary
  const volumeUnavailable = data.coverage.volume === 'unavailable'
  const generatedLabel = volumeUnavailable ? '—' : formatCount(summary.generated)
  const chartConfig = {
    completed: { label: 'Completados', color: '#16a36a' },
    generated: { label: 'Generados', color: '#3182ce' },
  } satisfies ChartConfig
  const breakdown = RESULT_ROWS.filter((item) => item.key !== 'unknown' || summary.unknown > 0).map((item) => ({
    ...item,
    value: summary[item.key],
    percent: summary.generated > 0 ? (summary[item.key] / summary.generated) * 100 : 0,
  }))
  const serviceActivity = ['reception', 'restaurant', 'pool', ...(data.services.some((s) => s.serviceType === 'unknown') ? ['unknown'] : [])].map((serviceType) =>
    data.services.find((item) => item.serviceType === serviceType) ?? {
      serviceType,
      generated: 0,
      comparison: { value: null, unit: 'percent' as const, reason: 'unavailable' as const },
    },
  )

  return (
    <div className="space-y-5" aria-live="polite">
      <CoverageNotice data={data} />
      {summary.generated === 0 && (
        <div role="status" className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {volumeUnavailable
            ? 'No hay cobertura analítica suficiente para determinar cuántos turnos se generaron en este periodo.'
            : 'No hay turnos generados en este periodo. Las métricas que necesitan muestras aparecen como “—”, no como cero.'}
        </div>
      )}

      <section aria-labelledby="metrics-executive-title" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="metrics-executive-title" className="text-lg font-semibold">Métricas ejecutivas</h2>
            <p className="text-sm text-muted-foreground">Resultados de turnos dados de alta en el periodo.</p>
          </div>
          <p className="hidden text-xs text-muted-foreground sm:block">{generatedLabel} turnos generados</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Turnos completados"
            value={formatCount(data.executive.completed.value)}
            comparison={data.executive.completed.comparison}
            iconSrc={userCheckIcon}
            detail={`Llegada confirmada · ${generatedLabel} altas en el periodo`}
          />
          <MetricCard
            title="Tiempo medio de espera"
            value={formatWait(data.executive.meanWaitMs.value)}
            comparison={data.executive.meanWaitMs.comparison}
            iconSrc={timerIcon}
            detail={summary.waitSamples ? `Primera llamada · ${formatCount(summary.waitSamples)} muestras` : 'Sin muestras de primera llamada'}
            lowerIsBetter
          />
          <MetricCard
            title="Tasa de atención"
            value={formatRate(data.executive.attentionRate.value)}
            comparison={data.executive.attentionRate.comparison}
            iconSrc={lineChartIcon}
            detail={`${formatCount(summary.completed)} completados / ${formatCount(summary.completed + summary.cancelled + summary.noShow)} resueltos`}
          />
          <MetricCard
            title="Servicios activos"
            value={formatCount(data.executive.activeServices.value)}
            comparison={data.executive.activeServices.comparison}
            iconSrc={layersIcon}
            detail={`Con al menos un alta · ${formatCount(summary.activeVenues)} establecimientos`}
            absoluteLabel="servicios"
          />
        </div>
        <details className="group rounded-lg border bg-card px-4 py-3 text-sm">
          <summary className="w-fit cursor-pointer rounded-sm font-medium underline decoration-muted-foreground/50 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Cómo se calculan estas métricas
          </summary>
          <dl className="mt-3 grid gap-x-8 gap-y-3 border-t pt-3 text-sm sm:grid-cols-2">
            <div><dt className="font-medium">Turnos completados</dt><dd className="text-muted-foreground">Llegada confirmada; cada turno pertenece al día local en que se dio de alta.</dd></div>
            <div><dt className="font-medium">Espera media</dt><dd className="text-muted-foreground">Primera llamada real menos alta. Incluye turnos llamados que luego se cancelan o no se presentan; sin llamada no hay muestra.</dd></div>
            <div><dt className="font-medium">Tasa de atención</dt><dd className="text-muted-foreground">Completados ÷ (completados + cancelados + no presentados). Excluye pendientes y sin clasificar.</dd></div>
            <div><dt className="font-medium">Servicios activos</dt><dd className="text-muted-foreground">Colas distintas con al menos un alta durante el periodo; no significa que estén abiertas ahora.</dd></div>
          </dl>
        </details>
      </section>

      <section aria-labelledby="metrics-pattern-title" className="space-y-3">
        <div>
          <h2 id="metrics-pattern-title" className="text-lg font-semibold">Patrones de cola</h2>
          <p className="text-sm text-muted-foreground">Horas de espera observada, no horarios de apertura comercial.</p>
        </div>
        <Card className="gap-5 p-5 sm:p-6">
          <CardHeader className="p-0">
            <CardTitle role="heading" aria-level={3} className="text-base">Patrones de lista de espera</CardTitle>
            <CardDescription>La hora punta se determina por las altas locales; la ocupación muestra personas esperando por cola.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-0">
            <PatternSummary data={data.patterns.overall} />
            <details className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
              <summary className="w-fit cursor-pointer rounded-sm font-medium underline decoration-muted-foreground/50 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Interpretar horarios y cobertura
              </summary>
              <ul className="mt-3 list-disc space-y-2 border-t pt-3 pl-5 text-muted-foreground">
                <li>La franja punta es la hora local con más altas; los empates se resuelven eligiendo la primera.</li>
                <li>Personas esperando es un promedio ponderado por tiempo y por cola; los intervalos sin cobertura se excluyen.</li>
                <li>Inicio y fin son la primera y última presencia observada en jornadas cerradas con cobertura completa. Un fin a medianoche se muestra como 24:00; no representa el horario comercial.</li>
              </ul>
            </details>
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Servicio</TableHead>
                    <TableHead className="text-right">Inicio medio de espera</TableHead>
                    <TableHead className="text-right">Fin medio de espera</TableHead>
                    <TableHead className="text-right">Días observados</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.patterns.services.length ? data.patterns.services.map((item) => (
                    <TableRow key={item.serviceType}>
                      <TableCell className="font-medium">{SERVICE_LABELS[item.serviceType] ?? item.serviceType}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMinute(item.startMinute)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMinute(item.endMinute, true)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(item.observedDays)}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={4} className="h-16 text-center text-muted-foreground">Sin días completos con observación suficiente.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="metrics-overview-title" className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(340px,1fr)]">
        <Card className="gap-5 p-5 sm:p-6">
          <CardHeader className="p-0">
            <CardTitle role="heading" aria-level={3} id="metrics-overview-title" className="text-base">Analítica general</CardTitle>
            <CardDescription>Evolución diaria de las altas y de los resultados de esas mismas cohortes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-0">
            {volumeUnavailable ? (
              <div role="status" className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                Sin cobertura suficiente para mostrar la evolución diaria.
              </div>
            ) : data.trend.length ? (
              <ChartContainer
                config={chartConfig}
                className="h-[260px] min-h-[220px] w-full min-w-0"
                initialDimension={{ width: 640, height: 260 }}
                aria-label="Gráfico de líneas con turnos generados y completados por día"
                role="img"
              >
                <LineChart accessibilityLayer data={data.trend} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
                  <CartesianGrid vertical={false} stroke="#e9edf2" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={9}
                    tick={{ fontSize: 11, fill: '#737b87' }}
                    tickFormatter={shortDate}
                    minTickGap={20}
                  />
                  <YAxis tickLine={false} axisLine={false} width={42} allowDecimals={false} tick={{ fontSize: 11, fill: '#737b87' }} />
                  <ChartTooltip
                    cursor={{ stroke: '#cbd5e1', strokeDasharray: '3 3' }}
                    content={<ChartTooltipContent labelFormatter={(label) => shortDate(String(label))} />}
                  />
                  <Line type="monotone" dataKey="generated" stroke="var(--color-generated)" strokeWidth={2} dot={data.trend.length === 1 ? { r: 3 } : false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="completed" stroke="var(--color-completed)" strokeWidth={2} dot={data.trend.length === 1 ? { r: 3 } : false} activeDot={{ r: 4 }} />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                No hay datos diarios disponibles para este periodo.
              </div>
            )}
            {!volumeUnavailable && <div className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Leyenda del gráfico">
              <LegendDot color="#3182ce">Turnos generados</LegendDot>
              <LegendDot color="#16a36a">Turnos completados</LegendDot>
            </div>}
            {!volumeUnavailable && <p className="sr-only">{data.trend.map((item) => `${item.date}: ${item.generated ?? 'sin cobertura'} generados, ${item.completed ?? 'sin cobertura'} completados`).join('. ')}</p>}
          </CardContent>
        </Card>

        <Card className="gap-5 p-5 sm:p-6">
          <CardHeader className="p-0">
            <CardTitle role="heading" aria-level={3} className="text-base">Desglose de actividad</CardTitle>
            <CardDescription>Estado actual de los turnos de la cohorte seleccionada.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-0">
            <div>
              <p className="text-3xl font-semibold tabular-nums">{generatedLabel}</p>
              <p className="text-xs text-muted-foreground">turnos generados</p>
            </div>
            <ul className="space-y-4">
              {breakdown.map((item) => (
                <li key={item.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className={`size-2.5 rounded-full ${item.color}`} />
                      {item.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {volumeUnavailable ? '—' : formatCount(item.value)} <span className="ml-1">{!volumeUnavailable && summary.generated ? `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(item.percent)} %` : '—'}</span>
                    </span>
                  </div>
                  {!volumeUnavailable && (
                    <div
                      role="progressbar"
                      aria-label={`${item.label} sobre todos los turnos generados`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, item.percent)}
                      className="h-1.5 overflow-hidden rounded-full bg-slate-100"
                    >
                      <div className={`h-full rounded-full ${item.color}`} style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Los porcentajes usan como base todos los turnos generados. La tasa de atención, en cambio, se calcula solo sobre los resueltos.
            </p>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="metrics-admin-title" className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(340px,1fr)]">
        <Card className="gap-4 p-5 sm:p-6">
          <CardHeader className="p-0">
            <CardTitle role="heading" aria-level={3} id="metrics-admin-title" className="text-base">Comparativa por establecimiento</CardTitle>
            <CardDescription>Rendimiento durante el periodo seleccionado · {volumeUnavailable ? '—' : formatCount(data.venues.total)} establecimientos con actividad.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Establecimiento</TableHead>
                    <TableHead className="text-right">Espera media</TableHead>
                    <TableHead className="text-right">Máxima demanda</TableHead>
                    <TableHead className="text-right">Turnos generados</TableHead>
                    <TableHead className="text-right">Atención</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.venues.items.length ? data.venues.items.map((venue, index) => (
                    <TableRow key={venue.venueId}>
                      <TableCell className="min-w-44 font-medium">
                        <span className="inline-flex max-w-full items-center gap-2">
                          <span aria-hidden="true" className="size-[9px] shrink-0 rounded-full" style={{ backgroundColor: VENUE_MARKERS[index % VENUE_MARKERS.length] }} />
                          <span className="truncate">{venue.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatWait(venue.meanWaitMs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatHour(venue.peakHour)}</TableCell>
                      <TableCell className="text-right tabular-nums">{volumeUnavailable ? '—' : formatCount(venue.generated)}</TableCell>
                      <TableCell className="min-w-44 text-right tabular-nums">
                        {venue.attentionRate == null ? '—' : (
                          <span className="inline-flex items-center justify-end gap-2">
                            <span
                              role="progressbar"
                              aria-label={`${venue.name}: tasa de atención`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.max(0, Math.min(100, venue.attentionRate))}
                              className="hidden h-1.5 w-[92px] overflow-hidden rounded-full bg-slate-100 sm:inline-flex"
                            >
                              <span className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, venue.attentionRate))}%`, backgroundColor: VENUE_MARKERS[index % VENUE_MARKERS.length] }} />
                            </span>
                            {formatRate(venue.attentionRate)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={5} className="h-16 text-center text-muted-foreground">{data.coverage.volume === 'unavailable' ? 'Sin cobertura suficiente para mostrar establecimientos.' : 'Sin actividad para este periodo.'}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {data.venues.total > data.venues.pageSize && (
              <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Página {data.venues.page} de {Math.ceil(data.venues.total / data.venues.pageSize)}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={busy || data.venues.page <= 1} onClick={() => onPage(data.venues.page - 1)}>Anterior</Button>
                  <Button variant="outline" size="sm" disabled={busy || data.venues.page * data.venues.pageSize >= data.venues.total} onClick={() => onPage(data.venues.page + 1)}>Siguiente</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="gap-4 p-5 sm:p-6">
          <CardHeader className="p-0">
            <CardTitle role="heading" aria-level={3} className="text-base">Actividad por servicio</CardTitle>
            <CardDescription>Turnos generados por tipo y variación frente al periodo anterior.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-0">
            {serviceActivity.map((item, index) => (
              <div key={item.serviceType} className="flex items-center gap-3 rounded-lg px-2 py-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${['bg-blue-50 text-blue-700', 'bg-emerald-50 text-emerald-700', 'bg-violet-50 text-violet-700', 'bg-slate-100 text-slate-700'][index]}`}>
                  <img alt="" src={SERVICE_ICONS[item.serviceType] ?? layersIcon} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{SERVICE_LABELS[item.serviceType] ?? item.serviceType}</p>
                  <p className="text-xs text-muted-foreground">Turnos generados</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{volumeUnavailable ? '—' : formatCount(item.generated)}</p>
                  <p className="text-[11px] text-muted-foreground">{volumeUnavailable ? 'Sin comparación' : formatComparison(item.comparison)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

export function CommercialMetrics() {
  const [search, setSearch] = useSearchParams()
  const [now, setNow] = useState(() => new Date())
  const periodValue = search.get('mPeriod') ?? 'last30'
  const period: PeriodKey = PERIOD_KEYS.includes(periodValue as PeriodKey)
    ? periodValue as PeriodKey
    : 'last30'
  const venueId = search.get('mVenue') ?? ''
  const serviceType = search.get('mService') ?? ''
  const pageValue = Number(search.get('mPage') ?? '1')
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 100000) : 1

  const [venues, setVenues] = useState<Venue[]>([])
  const [venuesError, setVenuesError] = useState('')
  const [venuesLoading, setVenuesLoading] = useState(true)
  const [snapshot, setSnapshot] = useState<{ key: string; data: MetricsResponse } | null>(null)
  const snapshotRef = useRef<{ key: string; data: MetricsResponse } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const scheduleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const requestKeyRef = useRef('')

  const timezone = venues.find((venue) => venue.id === venueId)?.timezone ?? 'Europe/Madrid'
  const venueCatalogState = venueId ? (venuesLoading ? 'loading' : 'ready') : 'global'
  useEffect(() => {
    const refreshClock = () => setNow(new Date())
    const timer = window.setInterval(refreshClock, 60_000)
    document.addEventListener('visibilitychange', refreshClock)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshClock)
    }
  }, [])
  const range = useMemo(() => periodRange(period, timezone, now), [period, timezone, now])
  const filterKey = `${range.from}:${range.to}:${venueId}:${serviceType}:${page}`
  const data = snapshot?.key === filterKey ? snapshot.data : null

  const updateFilters = useCallback((changes: Record<string, string>) => {
    const next = new URLSearchParams(search)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearch(next, { replace: true })
  }, [search, setSearch])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    async function loadVenues() {
      setVenuesLoading(true)
      setVenuesError('')
      try {
        const items: Venue[] = []
        let pageNumber = 1
        let hasMore = true
        while (hasMore) {
          const result = await api<MetricsVenuePage>(
            `/commercial/metrics/venues?page=${pageNumber}`,
            'GET', undefined, undefined, controller.signal,
          )
          items.push(...result.items)
          hasMore = result.hasMore
          pageNumber += 1
        }
        if (active) setVenues(items)
      } catch (cause) {
        if (active && !controller.signal.aborted) setVenuesError(errorMessage(cause))
      } finally {
        if (active) setVenuesLoading(false)
      }
    }
    void loadVenues()
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (venueCatalogState === 'loading') return
    requestKeyRef.current = filterKey
    requestRef.current?.abort()
    if (scheduleRef.current) clearTimeout(scheduleRef.current)
    const controller = new AbortController()
    requestRef.current = controller
    let active = true
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let isFetching = false

    const clearTimer = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = null
      scheduleRef.current = null
    }
    const schedule = (at: number) => {
      clearTimer()
      if (document.visibilityState === 'hidden') return
      const wait = Math.max(1000, at - Date.now())
      refreshTimer = setTimeout(() => void fetchMetrics(), Math.min(wait, 15 * 60 * 1000))
      scheduleRef.current = refreshTimer
    }
    const fetchMetrics = async () => {
      if (!active || isFetching || document.visibilityState === 'hidden') return
      isFetching = true
      const hasCurrent = snapshotRef.current?.key === filterKey
      setLoading(!hasCurrent)
      setRefreshing(hasCurrent)
      setError('')
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page) })
      if (venueId) params.set('venueId', venueId)
      if (serviceType) params.set('serviceType', serviceType)
      try {
        const result = await api<MetricsResponse>(
          `/commercial/metrics?${params.toString()}`,
          'GET', undefined, undefined, controller.signal,
        )
        if (!active || controller.signal.aborted || requestKeyRef.current !== filterKey) return
        snapshotRef.current = { key: filterKey, data: result }
        setSnapshot(snapshotRef.current)
        schedule(result.freshness.nextRefreshAt)
      } catch (cause) {
        if (active && !controller.signal.aborted && requestKeyRef.current === filterKey) {
          setError(errorMessage(cause))
          // On failure retain the same-filter snapshot; use a short retry while visible.
          schedule(Date.now() + 60_000)
        }
      } finally {
        isFetching = false
        if (active && !controller.signal.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') clearTimer()
      else void fetchMetrics()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    void fetchMetrics()
    return () => {
      active = false
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      controller.abort()
      requestRef.current = null
    }
  }, [filterKey, range.from, range.to, venueId, serviceType, page, retry, venueCatalogState])

  const refreshNow = () => setRetry((value) => value + 1)
  const selectedVenueName = venues.find((venue) => venue.id === venueId)?.name

  return (
    <div className="space-y-6" data-testid="commercial-metrics">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Métricas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? `${data.period.from} — ${data.period.to} · ${selectedVenueName ?? 'Todos los establecimientos'}` : 'Indicadores agregados de actividad y espera.'}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:flex">
          <Select value={period} onValueChange={(value) => updateFilters({ mPeriod: String(value), mPage: '1' })}>
            <SelectTrigger aria-label="Periodo de métricas" className="min-w-[220px] bg-background">
              <SelectValue>{PERIODS[period]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PERIOD_KEYS.map((key) => <SelectItem key={key} value={key}>{PERIODS[key]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={venueId || 'all'} onValueChange={(value) => updateFilters({ mVenue: value === 'all' ? '' : String(value), mPage: '1' })}>
            <SelectTrigger aria-label="Establecimiento" className="min-w-[210px] bg-background">
              <SelectValue>{venueId ? selectedVenueName ?? 'Establecimiento no disponible' : 'Todos los establecimientos'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los establecimientos</SelectItem>
              {venues.map((venue) => <SelectItem key={venue.id} value={venue.id}>{venue.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={serviceType || 'all'} onValueChange={(value) => updateFilters({ mService: value === 'all' ? '' : String(value), mPage: '1' })}>
            <SelectTrigger aria-label="Tipo de servicio" className="min-w-[180px] bg-background">
              <SelectValue>{serviceType ? SERVICE_LABELS[serviceType] ?? 'Servicio no disponible' : 'Todos los servicios'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los servicios</SelectItem>
              <SelectItem value="reception">Recepción</SelectItem>
              <SelectItem value="restaurant">Restauración</SelectItem>
              <SelectItem value="pool">Bar / piscina</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground">
        <span>
          {data?.freshness.lastCompleteAt
            ? `Último corte completo: ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(data.freshness.lastCompleteAt)}`
            : 'Esperando el primer corte analítico'}
          {data?.freshness.updating ? ' · Actualización en curso' : ' · Actualización cada 15 minutos'}
        </span>
        <Button variant="ghost" size="sm" onClick={refreshNow} disabled={loading || refreshing}>
          <RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {venuesLoading && <p role="status" className="text-xs text-muted-foreground">Cargando establecimientos autorizados…</p>}
      {venuesError && <p role="status" className="text-xs text-amber-700">No se pudo cargar el catálogo de establecimientos: {venuesError}</p>}
      {loading && !data && (
        <div role="status" aria-live="polite" className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
          Cargando métricas…
        </div>
      )}
      {error && data && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>No se pudo actualizar. Se mantienen los datos de estos mismos filtros: {error}</span>
          <Button variant="outline" size="sm" onClick={refreshNow}>Reintentar</Button>
        </div>
      )}
      {error && !data && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <span>No se pudieron cargar las métricas: {error}</span>
          <Button variant="outline" size="sm" onClick={refreshNow}>Reintentar</Button>
        </div>
      )}
      {data && <MetricsContent data={data} busy={refreshing} onPage={(nextPage) => updateFilters({ mPage: String(nextPage) })} />}
    </div>
  )
}

export default CommercialMetrics
