import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { PublicQueue } from './PublicQueue'
import { recentServiceIds } from './discovery-state'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})
it('records a verified direct service visit as an ID-only recent', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        id: 'direct-service',
        name: 'Direct Restaurant',
        venueId: 'venue',
        venueName: 'Hotel',
        type: 'restaurant',
        open: 0,
        spaces: [],
        receptionServices: [],
      }),
    ),
  )
  render(
    <MemoryRouter initialEntries={['/q/direct-service']}>
      <Routes>
        <Route path="/q/:queueId" element={<PublicQueue />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Direct Restaurant')
  await waitFor(() => expect(recentServiceIds()).toEqual(['direct-service']))
  expect(JSON.parse(localStorage.getItem('noqueue.recent-services')!)).toEqual([
    'direct-service',
  ])
})
it('always returns the join header to discovery home instead of venue services or prior search state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    id: 'q', name: 'Service', venueId: 'venue', venueName: 'Hotel', type: 'pool',
    open: 1, serviceOpen: true, queueState: 'active', canJoin: true,
    blockReason: null, waitingTurns: 0, waitingPeople: 0, spaces: [], receptionServices: [],
  })))
  render(
    <MemoryRouter initialEntries={[{
      pathname: '/q/q',
      search: '?lang=es',
      state: { discoveryReturn: '/v/venue?lang=es' },
    }]}>
      <Routes>
        <Route path="/" element={<h1>Buscar establecimientos</h1>} />
        <Route path="/v/:venueId" element={<h1>Servicios del establecimiento</h1>} />
        <Route path="/search" element={<h1>Resultados de búsqueda</h1>} />
        <Route path="/q/:queueId" element={<PublicQueue />} />
      </Routes>
    </MemoryRouter>,
  )

  const back = await screen.findByRole('link', { name: 'Volver' })
  expect(back).toHaveAttribute('href', '/?lang=es')
  fireEvent.click(back)
  expect(await screen.findByRole('heading', { name: 'Buscar establecimientos' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Servicios del establecimiento' })).not.toBeInTheDocument()
})
it.each(['restaurant', 'reception', 'pool'] as const)(
  'shows the %s form without wait information',
  async (type) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            id: 'q',
            name: 'Service',
            venueId: 'v',
            venueName: 'Venue',
            type,
            open: 1,
            serviceOpen: true,
            queueState: 'active',
            canJoin: true,
            blockReason: null,
            waitingTurns: 0,
            waitingPeople: 0,
            spaces: [],
            receptionServices: [],
          }),
        ),
    )
    render(
      <MemoryRouter initialEntries={['/q/q']}>
        <Routes>
          <Route path="/q/:queueId" element={<PublicQueue />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Introduce tus datos' })).toBeVisible()
    expect(screen.queryByTestId('public-waiting-turns')).not.toBeInTheDocument()
    expect(screen.queryByText(/Lista activa|estimación|minutos|turnos? en lista/)).not.toBeInTheDocument()
  },
)
