import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { PublicDiscovery } from './PublicDiscovery'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
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
  expect(screen.getByLabelText('Ordenar')).toHaveValue('wait')
  expect(screen.getByRole('option', { name: 'Más cerca' })).toBeDisabled()
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

import { setDiscoveryCoordinates } from './discovery-state'
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
  await screen.findByText('No hay servicios disponibles en un radio de 5 km.')
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
