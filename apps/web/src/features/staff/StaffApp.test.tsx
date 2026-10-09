import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { StaffApp } from './StaffApp'
import { api } from './api'
vi.mock('./api', () => ({
  api: vi.fn(),
  ApiError: class extends Error {},
  errorMessage: String,
}))
vi.mock('@/data/auth/client', () => ({ authClient: { signOut: vi.fn() } }))
vi.mock('./Dashboard', () => ({
  Dashboard: ({ venue, mode }: { venue: { name: string }; mode: string }) => (
    <div>
      {venue.name} {mode}
    </div>
  ),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
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
