import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { nativeRoutes } from '@/app/routes/native-routes'
import { nativeDiscoveryReturn, setDiscoveryCoordinates } from './discovery-state'

vi.mock('@/app/bootstrap/runtime', () => ({ detectRuntime: () => 'native' }))
vi.mock('@/platform/capacitor/installation', () => ({ installationSecret: async () => 'ab'.repeat(32) }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })), minimizeApp: vi.fn() } }))
const fetcher = vi.fn()
const service = { id: 'q', venueId: 'v', name: 'Restaurante Sol', venueName: 'Hotel Sol', type: 'restaurant', open: 1, serviceOpen: true, queueState: 'active', canJoin: true, spaces: [{ id: 'room', name: 'Room', maxPartySize: 4 }], receptionServices: [], averageWaitMinutes: 5, waitingPeople: 0, waitingTurns: 0 }
const result = { ...service, open: true, waitMinutes: 5, distanceMeters: null, address: 'Calle Mayor 1', attribution: [] }
let router: ReturnType<typeof createMemoryRouter>
let searchFailure = false, recoveryFailure = false
function mount(path = '/') {
  router = createMemoryRouter(nativeRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}
beforeEach(() => {
  searchFailure = recoveryFailure = false
  vi.stubEnv('VITE_API_URL', 'https://app.example')
  vi.stubEnv('VITE_MOBILE_PUSH_ENABLED', 'false')
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  fetcher.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/search')) return searchFailure ? Response.json({}, { status: 503 }) : Response.json({ items: [result], hasMore: false, page: 1 })
    if (url.endsWith('/venues/v/services')) return Response.json({ id: 'v', name: 'Hotel Sol', services: [service] })
    if (url.endsWith('/services/q')) return Response.json(service)
    if (url.endsWith('/entries')) return recoveryFailure ? Response.json({}, { status: 503 }) : Response.json({ entries: [] })
    return Response.json({}, { status: 404 })
  })
})
afterEach(() => { cleanup(); router?.dispose(); localStorage.clear(); setDiscoveryCoordinates(undefined); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('uses the web home with QR, location and search, without tabs, extra catalog or permission requests', async () => {
  mount()
  expect(await screen.findByRole('button', { name: /Escanear QR/ })).toBeVisible()
  expect(screen.getByRole('button', { name: /Usar mi ubicación/ })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Busca un establecimiento' })).toBeVisible()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByText(/Mis turnos|Servicios disponibles|Consultar mis turnos/)).not.toBeInTheDocument()
  expect(fetcher.mock.calls.every(([url]) => url.endsWith('/entries'))).toBe(true)
})
it('uses the same result row as web and opens the anonymous form directly', async () => {
  mount('/search?text=Sol&type=restaurant&lang=en')
  fireEvent.click(await screen.findByRole('link', { name: /Restaurante Sol/ }))
  expect(await screen.findByLabelText('Name')).toBeVisible()
  expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByText(/View venue:/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Back' }))
  expect(await screen.findByRole('textbox')).toHaveValue('Sol')
  expect(screen.getByRole('button', { name: 'Restaurants' })).toHaveAttribute('aria-pressed', 'true')
})
it('opens the shared venue presentation, with no native navigation added', async () => {
  mount('/v/v?lang=es')
  expect(await screen.findByRole('heading', { name: 'Te damos la bienvenida a Hotel Sol' })).toBeVisible()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Volver' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: /Restaurante Sol/ }))
  expect(await screen.findByLabelText('Nombre')).toBeVisible()
})
it('preserves text while retrying discovery independently from installation recovery', async () => {
  searchFailure = true
  mount('/search?text=missing')
  expect(await screen.findByRole('alert')).toHaveTextContent('No podemos cargar los servicios')
  searchFailure = false
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  expect(await screen.findByRole('link', { name: /Restaurante Sol/ })).toBeVisible()
  expect(screen.getByRole('textbox')).toHaveValue('missing')
})
it('fails closed on recovery error and does not mistake it for an empty installation', async () => {
  recoveryFailure = true
  mount('/q/q')
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pueden actualizar')
  expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
  recoveryFailure = false
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  expect(await screen.findByLabelText('Nombre')).toBeVisible()
})
it('redirects legacy /turns to the shared home without a list', async () => {
  mount('/turns?lang=en')
  expect(await screen.findByRole('button', { name: /Scan QR/ })).toBeVisible()
  expect(router.state.location.pathname).toBe('/')
  expect(screen.queryByText(/Your turns|My turns/)).not.toBeInTheDocument()
})
it('unknown paths offer search only, not a turn dashboard', async () => {
  mount('/unsupported')
  expect(await screen.findByRole('heading', { name: 'Este enlace no está disponible en la app' })).toBeVisible()
  expect(screen.queryByText('Consultar mis turnos')).not.toBeInTheDocument()
  await act(() => router.navigate('/?lang=en'))
  expect(await screen.findByRole('button', { name: /Scan QR/ })).toBeVisible()
})
it('search still uses authenticated native transport', async () => {
  mount('/search')
  await screen.findByRole('link', { name: /Restaurante Sol/ })
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/search'))).toBe(true))
  const [url, init] = fetcher.mock.calls.find(([url]) => url.endsWith('/search'))!
  expect(url).toBe('https://app.example/api/v1/mobile/search')
  expect(init.credentials).toBe('omit')
  expect(init.headers.get('Authorization')).toBe(`Bearer ${'ab'.repeat(32)}`)
})
it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/staff', '/q/id', '/search#x', null])('rejects untrusted native return context %s', value => {
  expect(nativeDiscoveryReturn(value)).toBeUndefined()
})
