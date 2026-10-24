import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { PublicDiscovery } from './PublicDiscovery'
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  setDiscoveryCoordinates(undefined)
  vi.restoreAllMocks()
})
it('renders anonymous home and only requests location after explicit click', async () => {
  const getCurrentPosition = vi.fn()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  })
  render(
    <MemoryRouter>
      <PublicDiscovery />
    </MemoryRouter>,
  )
  expect(
    screen.getByRole('heading', {
      name: '¿Dónde quieres unirte a la lista de espera?',
    }),
  ).toBeVisible()
  expect(getCurrentPosition).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Usar mi ubicación/ }))
  expect(getCurrentPosition).toHaveBeenCalledOnce()
  getCurrentPosition.mock.calls[0]![1]({ code: 1 })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No podemos acceder a tu ubicación',
  )
})
it('searches per service, toggles one type off and renders ChevronLeft back', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      items: [
        {
          id: 'queue-a',
          venueId: 'venue-a',
          name: 'Restaurante Sol',
          venueName: 'Hotel Sol',
          type: 'restaurant',
          address: 'Calle Mayor 1',
          open: true,
          serviceOpen: true,
          queueState: 'active',
          waitMinutes: 10,
          distanceMeters: null,
          attribution: [{ text: 'Geoapify', url: 'https://www.geoapify.com/' }],
        },
      ],
      page: 1,
      hasMore: false,
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  render(
    <MemoryRouter initialEntries={['/search']}>
      <PublicDiscovery search />
    </MemoryRouter>,
  )
  expect(
    await screen.findByRole('link', { name: /Restaurante Sol/ }),
  ).toHaveAttribute('href', '/q/queue-a?lang=es')
  expect(
    screen
      .getByRole('link', { name: 'Volver' })
      .querySelector('.lucide-chevron-left'),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Restaurantes' }))
  await waitFor(() =>
    expect(JSON.parse(fetcher.mock.lastCall![1].body).type).toBe('restaurant'),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Restaurantes' }))
  await waitFor(() =>
    expect(JSON.parse(fetcher.mock.lastCall![1].body).type).toBeUndefined(),
  )
  expect(screen.queryByText(/^\d+(?:m|km)$/)).not.toBeInTheDocument()
})

import { getDiscoveryCoordinates, setDiscoveryCoordinates } from './discovery-state'
it('keeps GPS only in memory and sends a three-service 5km discovery after consent', async () => {
  const getCurrentPosition = vi.fn()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  })
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ items: [], page: 1, hasMore: false }))
  vi.stubGlobal('fetch', fetcher)
  render(
    <MemoryRouter>
      <PublicDiscovery />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Usar mi ubicación/ }))
  getCurrentPosition.mock.calls[0]![0]({
    coords: { latitude: 36.7, longitude: -4.4 },
  })
  await screen.findByText('No encontramos servicios disponibles en un radio de 5 km.')
  const body = JSON.parse(fetcher.mock.lastCall![1].body)
  expect(body).toMatchObject({
    scope: 'nearby',
    sort: 'distance',
    pageSize: 3,
    coordinates: { latitude: 36.7, longitude: -4.4 },
  })
  expect(localStorage.length).toBe(0)
  expect(window.location.search).not.toContain('36.7')
  setDiscoveryCoordinates(undefined)
})

it('uses a labelled shadcn sort trigger with a localized initial value and unavailable nearest option', async () => {
  setDiscoveryCoordinates(undefined)
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(Response.json({ items: [], page: 1, hasMore: false })),
  )
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  render(
    <MemoryRouter initialEntries={['/search?sort=distance']}>
      <PublicDiscovery search />
    </MemoryRouter>,
  )
  const trigger = screen.getByRole('combobox', { name: 'Ordenar' })
  expect(trigger.tagName).toBe('BUTTON')
  expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
  expect(trigger).toHaveTextContent('Menos espera')
  fireEvent.click(trigger)
  expect(
    await screen.findByRole('option', { name: 'Más cerca' }),
  ).toHaveAttribute('aria-disabled', 'true')
  fireEvent.keyDown(trigger, { key: 'Escape' })
  fireEvent.click(screen.getByRole('combobox', { name: 'Idioma' }))
  const english = await screen.findByRole('option', { name: 'EN' })
  fireEvent.pointerDown(english, { pointerType: 'mouse' })
  fireEvent.click(english, { detail: 1 })
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent(
    'Shortest wait',
  )
})

it('changes sort before requesting page one without losing nearby scope, text or type', async () => {
  setDiscoveryCoordinates({ latitude: 36.7, longitude: -4.4 })
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ items: [], page: 1, hasMore: false }))
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  render(
    <MemoryRouter
      initialEntries={[
        '/search?scope=nearby&sort=distance&page=2&type=pool&text=hotel',
      ]}
    >
      <PublicDiscovery search />
    </MemoryRouter>,
  )
  const trigger = screen.getByRole('combobox', { name: 'Ordenar' })
  expect(trigger).toHaveTextContent('Más cerca')
  fireEvent.click(trigger)
  const waitOption = await screen.findByRole('option', { name: 'Menos espera' })
  fireEvent.pointerDown(waitOption, { pointerType: 'mouse' })
  fireEvent.click(waitOption, { detail: 1 })
  expect(trigger).toHaveTextContent('Menos espera')
  await waitFor(() =>
    expect(JSON.parse(fetcher.mock.lastCall![1].body)).toMatchObject({
      scope: 'nearby',
      sort: 'wait',
      page: 1,
      type: 'pool',
      text: 'hotel',
    }),
  )
  setDiscoveryCoordinates(undefined)
})

it('refreshes visible discovery every five seconds and deduplicates focus', async () => {
  vi.useFakeTimers()
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ items: [], page: 1, hasMore: false }))
  vi.stubGlobal('fetch', fetcher)
  render(
    <MemoryRouter initialEntries={['/search']}>
      <PublicDiscovery search />
    </MemoryRouter>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('marks the initial anonymous home ready without requiring a search response', () => {
  const ready = vi.fn()
  window.addEventListener('noqueue:public-page-ready', ready)
  try {
    render(<MemoryRouter><PublicDiscovery /></MemoryRouter>)
    expect(ready).toHaveBeenCalled()
    expect((ready.mock.calls.at(-1)![0] as CustomEvent).detail).toEqual({ pathname: '/', ready: true })
  } finally { window.removeEventListener('noqueue:public-page-ready', ready) }
})


it.each(['Quitar', 'Desactivar ubicación'])('returns to a clean home with %s and allows opting in again', async (action) => {
  setDiscoveryCoordinates({ latitude: 36.7, longitude: -4.4 })
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [], page: 1, hasMore: false }))
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const getCurrentPosition = vi.fn()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  const router = createMemoryRouter([
    { path: '/', element: <PublicDiscovery /> },
    { path: '/search', element: <PublicDiscovery search /> },
  ], { initialEntries: ['/?type=pool&page=2&scope=nearby&sort=distance'] })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { name: 'No hay servicios cerca de ti' })
  expect(screen.queryByRole('button', { name: 'Ver más' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: action }))
  expect(await screen.findByRole('button', { name: /Usar mi ubicación/ })).toBeVisible()
  expect(getDiscoveryCoordinates()).toBeUndefined()
  expect(router.state.location.pathname + router.state.location.search).toBe('/?lang=es')
  expect(router.state.historyAction).toBe('REPLACE')
  expect(screen.queryByText('Ubicación activada')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'No hay servicios cerca de ti' })).not.toBeInTheDocument()
  expect(getCurrentPosition).not.toHaveBeenCalled()
  expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' })
  fireEvent.click(screen.getByRole('button', { name: 'Busca un establecimiento' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/search'))
  await waitFor(() => expect(JSON.parse(String(fetcher.mock.lastCall![1]?.body ?? '{}'))).toMatchObject({ scope: 'global', sort: 'wait', page: 1 }))
  expect(JSON.parse(String(fetcher.mock.lastCall![1]?.body ?? '{}'))).not.toHaveProperty('coordinates')
  expect(JSON.parse(String(fetcher.mock.lastCall![1]?.body ?? '{}'))).not.toHaveProperty('type')
  fireEvent.click(screen.getByRole('link', { name: 'Volver' }))
  fireEvent.click(await screen.findByRole('button', { name: /Usar mi ubicación/ }))
  expect(getCurrentPosition).toHaveBeenCalledOnce()
  await act(async () => getCurrentPosition.mock.calls[0]![0]({ coords: { latitude: 40, longitude: -3 } }))
  expect(await screen.findByText('Ubicación activada')).toBeVisible()
  router.dispose()
})

it('removes location from search, preserves English and recent services, and clears every search parameter', async () => {
  setDiscoveryCoordinates({ latitude: 36.7, longitude: -4.4 })
  localStorage.setItem('noqueue.recent-services', JSON.stringify(['queue-a']))
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [], page: 1, hasMore: false }))
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const router = createMemoryRouter([
    { path: '/', element: <PublicDiscovery /> },
    { path: '/search', element: <PublicDiscovery search /> },
  ], { initialEntries: ['/search?lang=en&scope=nearby&sort=distance&type=pool&page=3&text=hotel'] })
  render(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(await screen.findByRole('button', { name: /Use my location/ })).toBeVisible()
  expect(router.state.location.pathname + router.state.location.search).toBe('/?lang=en')
  await waitFor(() => expect(JSON.parse(String(fetcher.mock.lastCall![1]?.body))).toMatchObject({ scope: 'global', sort: 'wait', page: 1, text: '', recentIds: ['queue-a'] }))
  expect(JSON.parse(String(fetcher.mock.lastCall![1]?.body))).not.toHaveProperty('coordinates')
  expect(localStorage.getItem('noqueue.recent-services')).toBe('["queue-a"]')
  router.dispose()
})

it.each(['loading', 'error'])('can remove location while nearby results are %s', async (state) => {
  setDiscoveryCoordinates({ latitude: 36.7, longitude: -4.4 })
  let finish!: (response: Response) => void
  const fetcher = vi.fn<typeof fetch>(() => state === 'error'
    ? Promise.resolve(Response.json({}, { status: 503 }))
    : new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  render(<MemoryRouter><PublicDiscovery /></MemoryRouter>)
  await waitFor(() => expect(fetcher).toHaveBeenCalled())
  if (state === 'error') await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Quitar' }))
  expect(screen.getByRole('button', { name: /Usar mi ubicación/ })).toBeVisible()
  expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true)
  if (state === 'loading') await act(async () => finish(Response.json({ items: [], page: 1, hasMore: false })))
  expect(screen.queryByText('Ubicación activada')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'No hay servicios cerca de ti' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
