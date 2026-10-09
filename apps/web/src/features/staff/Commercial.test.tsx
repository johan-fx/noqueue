import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router'
import { CommercialEstablishment } from './CommercialEstablishment'
import { Button } from '@/components/ui/button'
import { afterEach, expect, it, vi } from 'vitest'
import { Commercial } from './Commercial'
import { api } from './api'
vi.mock('./api', () => ({ api: vi.fn(), errorMessage: String }))
vi.mock('./Dashboard', () => ({ Dashboard: () => <p>Detail preview</p> }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const customer = {
  id: 'org',
  name: 'Empresa',
  slug: 'empresa',
  status: 'active',
  serviceCount: 3,
  configurationUpdatedAt: null,
  venueId: 'hotel',
  venueName: 'Hotel',
}
it('renders independent management links and menus without eager service requests and paginates', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 2,
    hasMore: true,
  })
  render(
    <MemoryRouter initialEntries={['/staff?page=2']}>
      <Commercial />
    </MemoryRouter>,
  )
  expect(
    await screen.findByRole('link', { name: /Gestionar Hotel/ }),
  ).toHaveAttribute('href', '/staff/establishments/hotel')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Acciones de Hotel' }),
  ).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'Página siguiente' }),
  ).toHaveAttribute('href', '/staff?page=3')
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith('/commercial/organizations?page=2')
})
it('normalizes invalid pages and offers operator management actions without eager service requests', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes('/commercial/')
      ? { items: [customer], page: 1, hasMore: false }
      : [],
  )
  render(
    <MemoryRouter initialEntries={['/staff?page=-2']}>
      <Commercial />
    </MemoryRouter>,
  )
  expect(
    await screen.findByRole('link', { name: /Gestionar Hotel/ }),
  ).toHaveAttribute('href', '/staff/establishments/hotel')
  expect(
    screen.getByRole('button', { name: 'Acciones de Hotel' }),
  ).toBeVisible()
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/commercial/organizations?page=1'),
  )
  expect(api).toHaveBeenCalledTimes(1)
  expect(
    screen.queryByRole('navigation', {
      name: 'Paginación de establecimientos',
    }),
  ).not.toBeInTheDocument()
})

it('shows a retryable error and an empty out-of-range page with a usable previous link', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ items: [], page: 9, hasMore: false })
  render(
    <MemoryRouter initialEntries={['/staff?page=9']}>
      <Commercial />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  expect(
    await screen.findByText('No hay establecimientos en esta página.'),
  ).toBeVisible()
  expect(screen.getByRole('link', { name: 'Página anterior' })).toHaveAttribute(
    'href',
    '/staff?page=8',
  )
  expect(
    screen.getByRole('link', { name: 'Página siguiente' }),
  ).toHaveAttribute('aria-disabled', 'true')
})

it.each([0, 24])(
  'hides the paginator with %i entries on the only page',
  async (count) => {
    vi.mocked(api).mockResolvedValue({
      items: Array.from({ length: count }, (_, i) => ({
        ...customer,
        venueId: `hotel-${i}`,
      })),
      page: 1,
      hasMore: false,
    })
    render(
      <MemoryRouter>
        <Commercial />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(
        screen.queryByText('Cargando establecimientos…'),
      ).not.toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('navigation', {
        name: 'Paginación de establecimientos',
      }),
    ).not.toBeInTheDocument()
  },
)
it('shows pagination when there are at least 25 establishments', async () => {
  vi.mocked(api).mockResolvedValue({
    items: Array.from({ length: 24 }, (_, index) => ({
      ...customer,
      venueId: `hotel-${index}`,
    })),
    page: 1,
    hasMore: true,
  })
  render(
    <MemoryRouter>
      <Commercial />
    </MemoryRouter>,
  )
  expect(
    await screen.findAllByRole('link', { name: /Gestionar Hotel/ }),
  ).toHaveLength(24)
  expect(
    screen.getByRole('navigation', {
      name: 'Paginación de establecimientos',
    }),
  ).toBeVisible()
})

it('shows administration tabs and real service metadata', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 1,
    hasMore: false,
  })
  render(
    <MemoryRouter>
      <Commercial />
    </MemoryRouter>,
  )
  expect(await screen.findByText('3 Servicios')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Administración' })).toBeVisible()
  expect(screen.getByText('Fecha de actualización no disponible')).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'Métricas' }))
  expect(
    screen.getByText('Las métricas estarán disponibles próximamente'),
  ).toBeVisible()
  expect(api).toHaveBeenCalledTimes(1)
})
it('preserves server-side search and status through pagination', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 2,
    hasMore: true,
  })
  render(
    <MemoryRouter initialEntries={['/staff?page=2&q=Hotel&status=active']}>
      <Commercial />
    </MemoryRouter>,
  )
  await screen.findByRole('link', { name: 'Gestionar Hotel' })
  expect(api).toHaveBeenCalledWith(
    '/commercial/organizations?page=2&q=Hotel&status=active',
  )
  expect(
    screen.getByRole('link', { name: 'Página siguiente' }),
  ).toHaveAttribute('href', '/staff?page=3&q=Hotel&status=active')
})

it('debounces search, resets the page and preserves the status filter', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 2,
    hasMore: true,
  })
  render(
    <MemoryRouter initialEntries={['/staff?page=2&status=active']}>
      <Commercial />
    </MemoryRouter>,
  )
  await screen.findByRole('link', { name: 'Gestionar Hotel' })
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ho' } })
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'Hotel' },
  })
  expect(api).toHaveBeenCalledTimes(1)
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/commercial/organizations?page=1&q=Hotel&status=active',
    ),
  )
  expect(api).toHaveBeenCalledTimes(2)
})
it('focuses search with either shortcut only when the list has no overlays', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 1,
    hasMore: false,
  })
  render(
    <MemoryRouter>
      <Commercial />
    </MemoryRouter>,
  )
  const manage = await screen.findByRole('link', { name: 'Gestionar Hotel' })
  manage.focus()
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  expect(screen.getByRole('searchbox')).toHaveFocus()
  fireEvent.click(screen.getByRole('tab', { name: 'Métricas' }))
  const metrics = screen.getByRole('tab', { name: 'Métricas' })
  metrics.focus()
  fireEvent.keyDown(document, { key: 'k', metaKey: true })
  expect(metrics).toHaveFocus()
  fireEvent.click(screen.getByRole('tab', { name: 'Establecimientos' }))
  fireEvent.click(screen.getByRole('button', { name: 'Crear nuevo' }))
  const dialog = await screen.findByRole('dialog')
  const name = screen.getByRole('textbox', { name: 'Empresa / organización' })
  name.focus()
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  expect(name).toHaveFocus()
  expect(dialog).toBeVisible()
})
it('confirms company-wide status changes, cancels without mutation and retains failed requests for retry', async () => {
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === 'PATCH') throw new Error('status offline')
    return { items: [customer], page: 1, hasMore: false }
  })
  render(
    <MemoryRouter>
      <Commercial />
    </MemoryRouter>,
  )
  const trigger = await screen.findByRole('button', {
    name: 'Acciones de Hotel',
  })
  fireEvent.click(trigger)
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Suspender empresa' }),
  )
  expect(await screen.findByRole('alertdialog')).toHaveTextContent(
    'todos los establecimientos de la empresa Empresa',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
  )
  expect(api).toHaveBeenCalledTimes(1)
  fireEvent.click(trigger)
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Suspender empresa' }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Suspender empresa' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('status offline')
  expect(screen.getByRole('alertdialog')).toBeVisible()
  expect(api).toHaveBeenCalledWith(
    '/commercial/organizations/org/status',
    'PATCH',
    { status: 'suspended' },
  )
  vi.mocked(api).mockImplementation(async (_path, method) =>
    method === 'PATCH'
      ? { ok: true }
      : {
          items: [{ ...customer, status: 'suspended' }],
          page: 1,
          hasMore: false,
        },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Suspender empresa' }))
  await screen.findByText('Empresa suspendida.')
  await screen.findByText('Inactivo')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})
it('uses suspension rather than queue state for the inactive filter and offers reactivation', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [{ ...customer, status: 'suspended' }],
    page: 1,
    hasMore: false,
  })
  render(
    <MemoryRouter>
      <Commercial />
    </MemoryRouter>,
  )
  await screen.findByText('Inactivo')
  fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/commercial/organizations?page=1&status=suspended',
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Acciones de Hotel' }))
  expect(
    await screen.findByRole('menuitem', { name: 'Reactivar empresa' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('menuitem', { name: 'Suspender empresa' }),
  ).not.toBeInTheDocument()
})

function HistoryControls() {
  const navigate = useNavigate()
  return (
    <>
      <Button onClick={() => navigate(-1)}>History back</Button>
      <Button onClick={() => navigate(1)}>History forward</Button>
    </>
  )
}
it('restores search on browser history navigation and cancels stale pending edits', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 1,
    hasMore: false,
  })
  render(
    <MemoryRouter
      initialEntries={[
        '/staff?q=Hotel',
        '/staff?q=Empresa&status=active&page=2',
      ]}
    >
      <HistoryControls />
      <Commercial />
    </MemoryRouter>,
  )
  await screen.findByRole('link', { name: 'Gestionar Hotel' })
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'Uncommitted' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'History back' }))
  await waitFor(() =>
    expect(screen.getByRole('searchbox')).toHaveValue('Hotel'),
  )
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/commercial/organizations?page=1&q=Hotel',
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'History forward' }))
  await waitFor(() =>
    expect(screen.getByRole('searchbox')).toHaveValue('Empresa'),
  )
  expect(api).not.toHaveBeenCalledWith(expect.stringContaining('Uncommitted'))
})
it('deduplicates status submission at company scope and keeps the selected filters', async () => {
  let settle: (() => void) | undefined
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === 'PATCH')
      return new Promise<void>((resolve) => {
        settle = resolve
      })
    return {
      items: [
        customer,
        { ...customer, venueId: 'second', venueName: 'Second hotel' },
      ],
      page: 1,
      hasMore: false,
    }
  })
  render(
    <MemoryRouter initialEntries={['/staff?q=Hotel&status=active']}>
      <Commercial />
    </MemoryRouter>,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Acciones de Hotel' }),
  )
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Suspender empresa' }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Suspender empresa' }),
  )
  const saving = screen.getByRole('button', { name: 'Guardando…' })
  fireEvent.click(saving)
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  expect(
    vi.mocked(api).mock.calls.filter(([, method]) => method === 'PATCH'),
  ).toHaveLength(1)
  settle?.()
  await screen.findByText('Empresa suspendida.')
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      '/commercial/organizations?page=1&q=Hotel&status=active',
    ),
  )
})

it('atomically flushes a pending search with status filtering before the debounce fires', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 2,
    hasMore: true,
  })
  render(
    <MemoryRouter initialEntries={['/staff?page=2']}>
      <Commercial />
    </MemoryRouter>,
  )
  await screen.findByRole('link', { name: 'Gestionar Hotel' })
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'Pending hotel' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Activos' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/commercial/organizations?page=1&q=Pending+hotel&status=active',
    ),
  )
  expect(screen.getByRole('searchbox')).toHaveValue('Pending hotel')
  await new Promise((resolve) => setTimeout(resolve, 350))
  expect(api).toHaveBeenCalledTimes(2)
})
it('flushes changed search on pagination and resets to the first matching page', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 2,
    hasMore: true,
  })
  render(
    <MemoryRouter initialEntries={['/staff?page=2&q=Hotel&status=active']}>
      <Commercial />
    </MemoryRouter>,
  )
  await screen.findByRole('link', { name: 'Gestionar Hotel' })
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'New company' },
  })
  fireEvent.click(screen.getByRole('link', { name: 'Página siguiente' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/commercial/organizations?page=1&q=New+company&status=active',
    ),
  )
  expect(screen.getByRole('searchbox')).toHaveValue('New company')
  await new Promise((resolve) => setTimeout(resolve, 350))
  expect(api).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('link', { name: 'Página siguiente' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/commercial/organizations?page=2&q=New+company&status=active',
    ),
  )
})
it('shows honest unavailable metadata for legacy API items without inventing zero services', async () => {
  const legacy: Partial<typeof customer> = { ...customer }
  delete legacy.serviceCount
  delete legacy.configurationUpdatedAt
  vi.mocked(api).mockResolvedValue({ items: [legacy], page: 1, hasMore: false })
  render(
    <MemoryRouter>
      <Commercial />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Servicios no disponibles')).toBeVisible()
  expect(screen.getByText('Fecha de actualización no disponible')).toBeVisible()
  expect(screen.queryByText('0 Servicios')).not.toBeInTheDocument()
  expect(
    await screen.findByRole('link', { name: 'Gestionar Hotel' }),
  ).toBeVisible()
})
it('does not steal focus with the search shortcut from a menu or company confirmation', async () => {
  vi.mocked(api).mockResolvedValue({
    items: [customer],
    page: 1,
    hasMore: false,
  })
  render(
    <MemoryRouter>
      <Commercial />
    </MemoryRouter>,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Acciones de Hotel' }),
  )
  const item = await screen.findByRole('menuitem', {
    name: 'Suspender empresa',
  })
  item.focus()
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  expect(item).toHaveFocus()
  fireEvent.click(item)
  await screen.findByRole('alertdialog')
  const cancel = screen.getByRole('button', { name: 'Cancelar' })
  cancel.focus()
  fireEvent.keyDown(document, { key: 'k', metaKey: true })
  expect(cancel).toHaveFocus()
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  expect(cancel).toHaveFocus()
  expect(api).toHaveBeenCalledTimes(1)
})

function DetailReturn() {
  const { venueId } = useParams()
  const location = useLocation()
  return (
    <CommercialEstablishment
      venueId={venueId!}
      returnPage={location.state?.returnPage}
      returnSearch={location.state?.returnSearch}
    />
  )
}
function CurrentRoute() {
  const location = useLocation()
  return (
    <div data-testid="current-route">
      {location.pathname}
      {location.search}
    </div>
  )
}
it.each(['custom', 'history'] as const)(
  'flushes pending search before immediate management navigation and preserves it on %s return',
  async (mode) => {
    vi.mocked(api).mockImplementation(async (path) =>
      path.startsWith('/commercial/venues/')
        ? {
            id: 'hotel',
            name: 'Hotel',
            organizationId: 'org',
            organizationName: 'Empresa',
          }
        : { items: [customer], page: 2, hasMore: true },
    )
    render(
      <MemoryRouter
        initialEntries={[
          '/staff?q=Earlier',
          '/staff?page=2&q=Hotel&status=active',
        ]}
      >
        <HistoryControls />
        <CurrentRoute />
        <Routes>
          <Route path="/staff" element={<Commercial />} />
          <Route
            path="/staff/establishments/:venueId"
            element={<DetailReturn />}
          />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: 'Gestionar Hotel' })
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'Pending hotel' },
    })
    fireEvent.click(screen.getByRole('link', { name: 'Gestionar Hotel' }))
    await screen.findByText('Detail preview')
    expect(screen.getByTestId('current-route')).toHaveTextContent(
      '/staff/establishments/hotel',
    )
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(screen.getByTestId('current-route')).toHaveTextContent(
      '/staff/establishments/hotel',
    )
    expect(screen.getByTestId('current-route')).not.toHaveTextContent('?')
    if (mode === 'custom')
      fireEvent.click(
        screen.getByRole('link', { name: 'Volver a establecimientos' }),
      )
    else fireEvent.click(screen.getByRole('button', { name: 'History back' }))
    await screen.findByRole('searchbox')
    expect(screen.getByRole('searchbox')).toHaveValue('Pending hotel')
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/commercial/organizations?page=1&q=Pending+hotel&status=active',
      ),
    )
    expect(screen.getByTestId('current-route')).toHaveTextContent(
      '/staff?page=1&q=Pending+hotel&status=active',
    )
    if (mode === 'history') {
      fireEvent.click(screen.getByRole('button', { name: 'History back' }))
      await waitFor(() =>
        expect(screen.getByRole('searchbox')).toHaveValue('Earlier'),
      )
      expect(screen.getByTestId('current-route')).toHaveTextContent(
        '/staff?q=Earlier',
      )
    }
  },
)
