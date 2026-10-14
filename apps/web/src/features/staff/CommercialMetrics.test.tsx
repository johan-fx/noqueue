import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { MetricsResponse, MetricsVenuePage } from '@noqueue/contracts/metrics'
import { CommercialMetrics } from './CommercialMetrics'
import { periodRange } from './metricsPeriod'
import { api } from './api'

vi.mock('./api', () => ({ api: vi.fn(), errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }))

function makeMetrics(generated = 0): MetricsResponse {
  const comparison = { value: null, unit: 'percent' as const, reason: 'unavailable' as const }
  const metric = { value: null, sampleSize: 0, comparison }
  const summary = {
    generated,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    pending: generated,
    unknown: 0,
    waitSumMs: 0,
    waitSamples: 0,
    meanWaitMs: null,
    attentionRate: null,
    activeServices: 0,
    activeVenues: 0,
  }
  return {
    period: { from: '2026-10-13', to: '2026-10-13', timezone: 'Europe/Madrid', provisional: false, previous: { from: '2026-10-12', to: '2026-10-12' } },
    summary,
    executive: { completed: metric, meanWaitMs: metric, attentionRate: metric, activeServices: metric },
    trend: [],
    patterns: {
      overall: { serviceType: 'overall', peakHour: null, peakWaitMs: null, peakQueuePeople: null, startMinute: null, endMinute: null, observedDays: 0 },
      services: [],
    },
    services: [],
    venues: { items: [], page: 1, pageSize: 20, total: 0 },
    coverage: { status: 'complete', since: null, historical: false, volume: 'complete', wait: 'unavailable', occupancy: 'unavailable' },
    freshness: { lastCompleteAt: null, nextRefreshAt: Date.now() + 900_000, updating: false, delayed: false },
  }
}

const venues: MetricsVenuePage = {
  items: [{ id: 'hotel', name: 'Hotel', timezone: 'Europe/Madrid' }],
  page: 1,
  hasMore: false,
}
let previousVisibilityState: PropertyDescriptor | undefined

function FilterHarness() {
  const [search, setSearch] = useSearchParams()
  return (
    <>
      <button type="button" onClick={() => {
        const next = new URLSearchParams(search)
        next.set('mPeriod', 'today')
        setSearch(next)
      }}>Cambiar filtro</button>
      <CommercialMetrics />
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
  if (previousVisibilityState) Object.defineProperty(document, 'visibilityState', previousVisibilityState)
  else Reflect.deleteProperty(document, 'visibilityState')
  previousVisibilityState = undefined
})

it('uses a calendar year for the last-12-month preset, including leap-year clamping', () => {
  expect(periodRange('last12Months', 'UTC', new Date('2025-03-01T12:00:00.000Z'))).toEqual({
    from: '2024-03-01',
    to: '2025-02-28',
  })
  expect(periodRange('last12Months', 'UTC', new Date('2024-03-01T12:00:00.000Z'))).toEqual({
    from: '2023-03-01',
    to: '2024-02-29',
  })
})

it('shows explicit empty and unavailable-sample states instead of implying zero measurements', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes('/metrics/venues') ? venues : makeMetrics(0),
  )
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  expect(await screen.findByText(/No hay turnos generados en este periodo/)).toBeVisible()
  expect(screen.getByText('Sin muestras de primera llamada')).toBeVisible()
  expect(screen.getByText(/Sin muestras suficientes para calcular la espera media/)).toBeVisible()
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText('Cómo se calculan estas métricas'))
  expect(screen.getByText(/Completados ÷/)).toBeVisible()
})

it('does not mislabel unavailable historical volume as an empty period', async () => {
  const data = makeMetrics(0)
  data.coverage.status = 'unavailable'
  data.coverage.volume = 'unavailable'
  vi.mocked(api).mockImplementation(async (path) => path.includes('/metrics/venues') ? venues : data)
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  expect(await screen.findByText(/No hay cobertura analítica suficiente para determinar cuántos turnos/)).toBeVisible()
  expect(screen.queryByText(/No hay turnos generados en este periodo/)).not.toBeInTheDocument()
  expect(screen.getByText('Sin cobertura suficiente para mostrar la evolución diaria.')).toBeVisible()
  expect(screen.queryByRole('img', { name: /Gráfico de líneas con turnos generados/ })).not.toBeInTheDocument()
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
})

it('recomputes calendar presets after the selected timezone crosses midnight', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T21:59:30.000Z'))
  const metricRequests: string[] = []
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.includes('/metrics/venues')) return venues
    metricRequests.push(path)
    return makeMetrics(1)
  })
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(metricRequests[0]).toContain('from=2026-09-14')
  expect(metricRequests[0]).toContain('to=2026-10-13')
  await act(async () => {
    vi.advanceTimersByTime(60_000)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(metricRequests[1]).toContain('from=2026-09-15')
  expect(metricRequests[1]).toContain('to=2026-10-14')
})

it('aligns venue wait, peak-hour, generated, and attention values with the Figma table columns', async () => {
  const data = makeMetrics(12)
  data.venues = {
    items: [{
      venueId: 'hotel',
      name: 'Hotel Centro',
      generated: 12,
      completed: 10,
      cancelled: 1,
      noShow: 1,
      pending: 0,
      unknown: 0,
      waitSumMs: 1_230_000,
      waitSamples: 10,
      meanWaitMs: 123_000,
      attentionRate: 83.3,
      activeServices: 2,
      activeVenues: 1,
      peakHour: 11,
    }],
    page: 1,
    pageSize: 20,
    total: 1,
  }
  vi.mocked(api).mockImplementation(async (path) => path.includes('/metrics/venues') ? venues : data)
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  const row = await screen.findByRole('row', { name: /Hotel Centro/ })
  expect(row).toHaveTextContent('2 min 03 s')
  expect(row).toHaveTextContent('11:00–12:00')
  expect(row).toHaveTextContent('12')
  expect(row).toHaveTextContent('83,3 %')
  expect(screen.getByRole('columnheader', { name: 'Espera media' })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Máxima demanda' })).toBeVisible()
})

it('labels first and last observed queue presence at midnight as 00:00 and 24:00', async () => {
  const data = makeMetrics(1)
  data.patterns.services = [{ serviceType: 'restaurant', peakHour: null, peakWaitMs: null, peakQueuePeople: null, startMinute: 0, endMinute: 1440, observedDays: 1 }]
  vi.mocked(api).mockImplementation(async (path) => path.includes('/metrics/venues') ? venues : data)
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  expect(await screen.findByText('00:00')).toBeVisible()
  expect(screen.getByText('24:00')).toBeVisible()
  fireEvent.click(screen.getByText('Interpretar horarios y cobertura'))
  expect(screen.getByText(/no representa el horario comercial/i)).toBeVisible()
})

it('surfaces partial historical and occupancy coverage', async () => {
  const data = makeMetrics(3)
  data.coverage.status = 'partial'
  data.coverage.volume = 'partial'
  data.coverage.wait = 'partial'
  data.coverage.occupancy = 'partial'
  data.coverage.historical = true
  vi.mocked(api).mockImplementation(async (path) => path.includes('/metrics/venues') ? venues : data)
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  expect(await screen.findByText(/El histórico disponible es parcial/)).toBeVisible()
  expect(screen.getByText(/Los patrones de ocupación pueden no cubrir todas las horas/)).toBeVisible()
  fireEvent.click(screen.getByText('Interpretar horarios y cobertura'))
  expect(screen.getByText(/intervalos sin cobertura se excluyen/)).toBeVisible()
})

it('does not render a previous filter snapshot while the newly selected filter is loading', async () => {
  let requestCount = 0
  let resolveFirst: ((value: MetricsResponse) => void) | undefined
  let resolveSecond: ((value: MetricsResponse) => void) | undefined
  vi.mocked(api).mockImplementation((path) => {
    if (path.includes('/metrics/venues')) return Promise.resolve(venues)
    requestCount += 1
    if (requestCount === 1) return new Promise<MetricsResponse>((resolve) => { resolveFirst = resolve })
    return new Promise<MetricsResponse>((resolve) => { resolveSecond = resolve })
  })
  render(<MemoryRouter><FilterHarness /></MemoryRouter>)
  await waitFor(() => expect(requestCount).toBe(1))
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar filtro' }))
  await waitFor(() => expect(requestCount).toBe(2))
  expect(await screen.findByText('Cargando métricas…')).toBeVisible()
  await act(async () => resolveSecond?.(makeMetrics(13)))
  expect((await screen.findAllByText('13'))[0]).toBeVisible()
  await act(async () => resolveFirst?.(makeMetrics(8)))
  expect((await screen.findAllByText('13'))[0]).toBeVisible()
  expect(screen.queryByText('8')).not.toBeInTheDocument()
})

it('retains the same-filter data after a refresh fails and offers retry', async () => {
  let requestCount = 0
  vi.mocked(api).mockImplementation((path) => {
    if (path.includes('/metrics/venues')) return Promise.resolve(venues)
    requestCount += 1
    return requestCount === 1
      ? Promise.resolve(makeMetrics(8))
      : Promise.reject(new Error('sin conexión'))
  })
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  expect((await screen.findAllByText('8'))[0]).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
  expect(await screen.findByText(/Se mantienen los datos de estos mismos filtros: sin conexión/)).toBeVisible()
  expect(screen.getAllByText('8')[0]).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  await waitFor(() => expect(requestCount).toBeGreaterThanOrEqual(3))
})

it('suspends scheduled refresh while the document is hidden and reloads on return', async () => {
  const nextRefreshAt = Date.now() + 100
  let resolveFirst: ((value: MetricsResponse) => void) | undefined
  let metricsCalls = 0
  vi.mocked(api).mockImplementation((path) => {
    if (path.includes('/metrics/venues')) return Promise.resolve(venues)
    metricsCalls += 1
    if (metricsCalls === 1) return new Promise<MetricsResponse>((resolve) => { resolveFirst = resolve })
    return Promise.resolve({ ...makeMetrics(2), freshness: { lastCompleteAt: Date.now(), nextRefreshAt, updating: false, delayed: false } })
  })
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  await waitFor(() => expect(metricsCalls).toBe(1))
  previousVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  await act(async () => {
    resolveFirst?.({ ...makeMetrics(2), freshness: { lastCompleteAt: Date.now(), nextRefreshAt, updating: false, delayed: false } })
  })
  expect((await screen.findAllByText('2'))[0]).toBeVisible()
  await new Promise((resolve) => setTimeout(resolve, 175))
  expect(metricsCalls).toBe(1)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
  })
  await waitFor(() => expect(metricsCalls).toBe(2))
})

it('includes unknown historical service activity instead of dropping it from the breakdown', async () => {
  const data=makeMetrics(5)
  data.coverage.historical=true
  data.coverage.status='partial'
  data.services=[{serviceType:'unknown',generated:5,comparison:{value:null,unit:'percent',reason:'unavailable'}}]
  vi.mocked(api).mockImplementation(async(path)=>path.includes('/metrics/venues')?venues:data)
  render(<MemoryRouter><CommercialMetrics /></MemoryRouter>)
  await screen.findByText('Actividad por servicio')
  expect(screen.getByText('Sin determinar',{exact:true})).toBeVisible()
})
