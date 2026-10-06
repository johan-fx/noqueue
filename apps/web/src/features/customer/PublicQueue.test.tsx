import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
