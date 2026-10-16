import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { StaffApp } from './StaffApp'
import { api, ApiError } from './api'
vi.mock('./api', () => ({
  api: vi.fn(),
  ApiError: class extends Error {
    status: number
    constructor(status: number, message: string) { super(message); this.status = status }
  },
  errorMessage: String,
}))
vi.mock('./CommercialMetrics', () => ({
  default: () => <div>Métricas de cartera</div>,
  MetricsDashboard: ({ venue }: { venue: { id: string; name: string } }) => <div>Métricas de {venue.name} ({venue.id})</div>,
}))
vi.mock('@/data/auth/client', () => ({ authClient: { signOut: vi.fn() } }))
vi.mock('./Dashboard', () => ({
  Dashboard: ({ venue, mode }: { venue: { name: string }; mode: string }) => (
    <div data-testid="venue-management">
      {venue.name} {mode}
    </div>
  ),
}))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

function showAccess() {
  return render(<StrictMode><MemoryRouter initialEntries={['/staff']}><Routes>
    <Route path="/staff" element={<StaffApp />} />
    <Route path="/login" element={<p>Acceso requerido</p>} />
  </Routes></MemoryRouter></StrictMode>)
}
const emptyMember = { user: { username: 'owner' }, commercial: false, platformAdmin: false, venues: [] }

it('bounds stalled access checks, preserves the session and ignores late responses after retry', async () => {
  vi.useFakeTimers()
  const pending: { signal: AbortSignal; resolve: (data: unknown) => void }[] = []
  vi.mocked(api).mockImplementation((_path, _method, _body, _key, signal) =>
    new Promise((resolve) => pending.push({ signal: signal!, resolve })))
  const view = showAccess()
  expect(pending).toHaveLength(2)
  expect(pending[0]!.signal.aborted).toBe(true) // StrictMode cleanup
  await act(() => vi.advanceTimersByTimeAsync(15_000))
  expect(pending[1]!.signal.aborted).toBe(true)
  expect(screen.getByRole('alert')).toHaveTextContent('tardando demasiado')
  expect(screen.queryByText('Acceso requerido')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar acceso' }))
  expect(screen.getByRole('status')).toHaveTextContent('Comprobando acceso')
  await act(async () => { pending[1]!.resolve(emptyMember) })
  expect(screen.getByRole('status')).toBeVisible()
  await act(async () => { pending.at(-1)!.resolve(emptyMember) })
  expect(screen.getByText(/No tienes establecimientos asignados/)).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(15_000))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  view.unmount()
  expect(pending.at(-1)!.signal.aborted).toBe(true)
})

it('offers a read-only retry after network failure without logging out', async () => {
  vi.mocked(api).mockRejectedValue(new TypeError('Failed to fetch'))
  showAccess()
  expect(await screen.findByRole('alert')).toHaveTextContent('sin cerrar sesión')
  vi.mocked(api).mockResolvedValue(emptyMember)
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar acceso' }))
  expect(await screen.findByText(/No tienes establecimientos asignados/)).toBeVisible()
  expect(vi.mocked(api).mock.calls.every(([path, method]) => path === '/me' && method === 'GET')).toBe(true)
})

it('still redirects an actually expired session to login', async () => {
  vi.mocked(api).mockRejectedValue(new ApiError(401, 'unauthorized'))
  showAccess()
  expect(await screen.findByText('Acceso requerido')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Reintentar acceso' })).not.toBeInTheDocument()
})
function show(platformAdmin: boolean, state?: unknown, commercial = true) {
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/me'
      ? {
          user: { username: 'admin' },
          commercial,
          platformAdmin,
          venues: [],
        }
      : {
          id: 'hotel',
          name: 'Hotel Madrid',
          organizationId: 'org',
          organizationName: 'Empresa',
        },
  )
  render(
    <MemoryRouter
      initialEntries={[{ pathname: '/staff/establishments/hotel', state }]}
    >
      <Routes>
        <Route path="/staff/establishments/:venueId" element={<StaffApp />} />
      </Routes>
    </MemoryRouter>,
  )
}
it('loads direct detail and restores only a validated list page', async () => {
  show(true, { returnPage: 3 })
  expect(await screen.findByText('Hotel Madrid commercial')).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'Volver a establecimientos' }),
  ).toHaveAttribute('href', '/staff?page=3')
  expect(api).toHaveBeenCalledWith('/commercial/venues/hotel')
})
it('rejects noncommercial deep links', async () => {
  show(false, undefined, false)
  expect(await screen.findByRole('alert')).toHaveTextContent('No tienes acceso')
  expect(api).toHaveBeenCalledTimes(1)
})
it('falls back to the list for invalid return state', async () => {
  show(true, { returnPage: 'https://evil.invalid' })
  await screen.findByText('Hotel Madrid commercial')
  expect(
    screen.getByRole('link', { name: 'Volver a establecimientos' }),
  ).toHaveAttribute('href', '/staff')
})

it('opens the same management detail for commercial operators', async () => {
  show(false)
  expect(await screen.findByText('Hotel Madrid commercial')).toBeVisible()
  expect(api).toHaveBeenCalledWith('/commercial/venues/hotel')
})

it('restores the validated search, status and page from establishment detail', async () => {
  show(true, {
    returnPage: 3,
    returnSearch: 'page=3&q=Hotel+Madrid&status=suspended&untrusted=ignored',
  })
  await screen.findByText('Hotel Madrid commercial')
  expect(
    screen.getByRole('link', { name: 'Volver a establecimientos' }),
  ).toHaveAttribute('href', '/staff?page=3&q=Hotel+Madrid&status=suspended')
})

const memberVenue = {
  id: 'hotel', name: 'Hotel Madrid', organizationId: 'org', organizationName: 'Empresa',
  role: 'owner', timezone: 'Europe/Madrid', canReadMetrics: true,
  logo: null, logoVersion: 0, canEditLogo: true,
}
function showMember(venues = [memberVenue], metrics = true, url = '/staff') {
  vi.mocked(api).mockResolvedValue({ user: { username: 'owner' }, commercial: false, platformAdmin: false, features: { metrics }, venues })
  render(<MemoryRouter initialEntries={[url]}><StaffApp /></MemoryRouter>)
}

it.each(['owner', 'venue_manager'])('offers management/metrics tabs to %s and unmounts the inactive panel', async (role) => {
  showMember([{ ...memberVenue, role }])
  expect(await screen.findByRole('tab', { name: 'Gestión' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('Hotel Madrid')).toBeVisible()
  expect(screen.queryByText(/Métricas de/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Métricas' }))
  expect(await screen.findByText('Métricas de Hotel Madrid (hotel)')).toBeVisible()
  expect(screen.queryByText('Hotel Madrid', { exact: true })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Gestión' }))
  expect(await screen.findByText('Hotel Madrid')).toBeVisible()
  expect(screen.queryByText(/Métricas de/)).not.toBeInTheDocument()
})

it.each(['viewer', 'queue_staff'])('does not expose tabs to %s even with a stale feature flag and deep link', async (role) => {
  showMember([{ ...memberVenue, role }], true, '/staff?tab=metrics')
  expect(await screen.findByText('Hotel Madrid')).toBeVisible()
  expect(screen.queryByRole('tab', { name: 'Métricas' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Métricas de/)).not.toBeInTheDocument()
})

it('keeps management available when the feature or per-venue permission is off', async () => {
  showMember([memberVenue], false, '/staff?tab=metrics')
  expect(await screen.findByText('Hotel Madrid')).toBeVisible()
  expect(screen.queryByRole('tab', { name: 'Métricas' })).not.toBeInTheDocument()
  cleanup()
  showMember([{ ...memberVenue, canReadMetrics: false }], true, '/staff?tab=metrics')
  expect(await screen.findByText('Hotel Madrid')).toBeVisible()
  expect(screen.queryByText(/Métricas de/)).not.toBeInTheDocument()
})

it('switches metrics context with the establishment selector and falls back to management for a restricted venue', async () => {
  showMember([
    memberVenue,
    { ...memberVenue, id: 'second', name: 'Segundo hotel', role: 'venue_manager' },
    { ...memberVenue, id: 'restricted', name: 'Solo lectura', role: 'viewer', canReadMetrics: false },
  ], true, '/staff?tab=metrics&mVenue=untrusted')
  expect(await screen.findByText('Métricas de Hotel Madrid (hotel)')).toBeVisible()
  fireEvent.click(screen.getByRole('combobox', { name: 'Establecimiento' }))
  const secondOption = await screen.findByRole('option', { name: 'Segundo hotel' })
  fireEvent.pointerDown(secondOption, { pointerType: 'mouse' })
  fireEvent.click(secondOption)
  expect(await screen.findByText('Métricas de Segundo hotel (second)')).toBeVisible()
  expect(screen.queryByText('Métricas de Hotel Madrid (hotel)')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('combobox', { name: 'Establecimiento' }))
  const restrictedOption = await screen.findByRole('option', { name: 'Solo lectura' })
  fireEvent.pointerDown(restrictedOption, { pointerType: 'mouse' })
  fireEvent.click(restrictedOption)
  expect(screen.queryByRole('tab', { name: 'Métricas' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Métricas de/)).not.toBeInTheDocument()
})


const mixedRoles = [
  { globalRole: 'platform_admin', platformAdmin: true, memberRole: 'owner' },
  { globalRole: 'platform_admin', platformAdmin: true, memberRole: 'venue_manager' },
  { globalRole: 'commercial_operator', platformAdmin: false, memberRole: 'owner' },
  { globalRole: 'commercial_operator', platformAdmin: false, memberRole: 'venue_manager' },
]
function CurrentUrl() {
  const location = useLocation()
  return <output data-testid="current-url">{location.pathname}{location.search}</output>
}
function showMixedMember(platformAdmin: boolean, memberRole: string, metrics = true) {
  vi.mocked(api).mockImplementation(async (path) => path === '/me'
    ? {
        user: { username: 'mixed' }, commercial: true, platformAdmin,
        features: { metrics }, venues: [{ ...memberVenue, role: memberRole }],
      }
    : { items: [], page: 1, hasMore: false },
  )
  render(<MemoryRouter initialEntries={['/staff?tab=metrics&mPeriod=today&q=Hotel']}>
    <StaffApp />
    <CurrentUrl />
  </MemoryRouter>)
}
it.each(mixedRoles)('keeps only portfolio tabs for $globalRole + $memberRole and preserves existing management', async ({ platformAdmin, memberRole }) => {
  showMixedMember(platformAdmin, memberRole)
  await screen.findByText('Métricas de cartera')
  expect(screen.getAllByRole('tab', { name: 'Métricas' })).toHaveLength(1)
  expect(screen.queryByRole('tab', { name: 'Gestión' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tablist', { name: 'Vista del establecimiento' })).not.toBeInTheDocument()
  expect(screen.queryByText('Métricas de Hotel Madrid (hotel)')).not.toBeInTheDocument()
  const management = screen.getByTestId('venue-management')
  expect(management).toHaveTextContent('Hotel Madrid')
  expect(management).toBeVisible()

  fireEvent.click(screen.getByRole('tab', { name: 'Establecimientos' }))
  expect(screen.getByRole('tab', { name: 'Establecimientos' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByText('Métricas de cartera')).not.toBeInTheDocument()
  expect(screen.getByTestId('venue-management')).toBe(management)
  expect(screen.getByTestId('current-url')).toHaveTextContent('tab=establishments')
  expect(screen.getByTestId('current-url')).toHaveTextContent('mPeriod=today')
  expect(screen.getByTestId('current-url')).toHaveTextContent('q=Hotel')

  fireEvent.click(screen.getByRole('tab', { name: 'Métricas' }))
  expect(await screen.findByText('Métricas de cartera')).toBeVisible()
  expect(screen.getByTestId('venue-management')).toBe(management)
  expect(screen.getAllByRole('tab', { name: 'Métricas' })).toHaveLength(1)
  expect(screen.queryByText('Métricas de Hotel Madrid (hotel)')).not.toBeInTheDocument()
})
it.each(mixedRoles)('keeps metrics disabled for $globalRole + $memberRole despite a stale venue capability and deep link', async ({ platformAdmin, memberRole }) => {
  showMixedMember(platformAdmin, memberRole, false)
  expect(await screen.findByTestId('venue-management')).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Establecimientos' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tab', { name: 'Métricas' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Gestión' })).not.toBeInTheDocument()
  expect(screen.queryByText('Métricas de cartera')).not.toBeInTheDocument()
  expect(screen.queryByText('Métricas de Hotel Madrid (hotel)')).not.toBeInTheDocument()
})
