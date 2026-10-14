import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import type { PublicSearchResult } from '@noqueue/contracts/discovery'
import { ServiceResult } from './ServiceResult'
afterEach(cleanup)
const service: PublicSearchResult = {
  id: 'q', venueId: 'v', name: 'Restaurante PlayaSol', venueName: 'Venue', type: 'restaurant',
  address: 'Calle del Mero 28, Málaga', open: true, serviceOpen: true, queueState: 'active',
  canJoin: true, blockReason: null, waitingTurns: 2, waitingPeople: 6,
  waitMinutes: 25, distanceMeters: 350, attribution: [],
}
it.each(['restaurant', 'reception', 'pool'] as const)('keeps the compact Figma row without a counter (%s)', (type) => {
  const { container } = render(<MemoryRouter><ServiceResult service={{ ...service, type }} locale="es" returnTo="/search" /></MemoryRouter>)
  expect(screen.getByText('25min')).toBeVisible()
  expect(screen.getByText('350m')).toBeVisible()
  expect(screen.getByText(service.address)).toBeVisible()
  expect(screen.queryByTestId('public-waiting-turns')).not.toBeInTheDocument()
  expect(screen.queryByText(/Lista activa|personas|turnos/)).not.toBeInTheDocument()
  expect(container.querySelector('.lucide-clock')).toHaveAttribute('aria-hidden', 'true')
})
it('rounds compact search waits and uses the same rounded value in the title', () => {
  render(<MemoryRouter><ServiceResult service={{ ...service, waitMinutes: 5.223045783132531 }} locale="es" returnTo="/search" /></MemoryRouter>)
  const wait = screen.getByText('5min')
  expect(wait).toBeVisible()
  expect(wait).toHaveAttribute('title', 'Lista activa · 5 min')
})
it.each([
  { serviceOpen: false }, { queueState: 'paused' as const }, { queueState: 'inactive' as const },
  { serviceOpen: undefined },
])('does not render an unavailable or unknown service %j', (state) => {
  render(<MemoryRouter><ServiceResult service={{ ...service, ...state }} locale="en" returnTo="/search" /></MemoryRouter>)
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
