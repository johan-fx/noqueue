import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { PublicVenue } from './PublicVenue'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it.each(['es', 'en'] as const)('shows turns only for active services in venue (%s)', async (locale) => {
  const service = { id: 'q', name: 'Groups', venueName: 'Venue', type: 'restaurant', open: 1, spaces: [], receptionServices: [], averageWaitMinutes: 4, serviceOpen: true, queueState: 'active', canJoin: true, blockReason: null, waitingPeople: 6, waitingTurns: 2 }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'v', name: 'Venue', services: [
    service,
    { ...service, id: 'empty', name: 'Empty active', waitingPeople: 0, waitingTurns: 0 },
    { ...service, id: 'closed', name: 'Closed empty', serviceOpen: false, canJoin: false, blockReason: 'closed', waitingPeople: 0, waitingTurns: 0 },
    { ...service, id: 'pending', name: 'Closed pending', serviceOpen: false, canJoin: false, blockReason: 'closed' },
    { ...service, id: 'paused', name: 'Paused pending', queueState: 'paused' },
    { ...service, id: 'inactive', name: 'Direct access', queueState: 'inactive' },
    { ...service, id: 'old', name: 'Legacy response', waitingTurns: undefined },
  ] })))
  render(<MemoryRouter initialEntries={[`/v/v?lang=${locale}`]}><Routes><Route path="/v/:venueId" element={<PublicVenue />} /></Routes></MemoryRouter>)
  await screen.findByText('Groups')
  const count = locale === 'es' ? '2 turnos en lista de espera' : '2 turns waiting'
  expect(within(screen.getByRole('link', { name: new RegExp('Groups') })).getByText(count)).toBeVisible()
  for (const name of ['Closed pending', 'Closed empty', 'Paused pending', 'Direct access']) {
    expect(screen.queryByRole('link', { name: new RegExp(name) })).not.toBeInTheDocument()
  }
  expect(within(screen.getByRole('link', { name: new RegExp('Empty active') })).getByText(locale === 'es' ? '1 turno en lista de espera' : '1 turn waiting')).toBeVisible()
  for (const name of ['Legacy response']) {
    const link = screen.getByRole('link', { name: new RegExp(name) })
    expect(within(link).queryByTestId('public-waiting-turns')).not.toBeInTheDocument()
    expect(link.querySelector('.lucide-ticket')).toBeNull()
  }
})
it('includes scheduled-closed cards only with an explicit opening projection, without turn count or join link', async () => {
  const service = { id: 'q', name: 'Restaurante', averageWaitMinutes: null, venueName: 'Venue', type: 'restaurant', open: 0, spaces: [], receptionServices: [], serviceOpen: false, queueState: 'inactive', canJoin: false, blockReason: 'closed', waitingPeople: 6, waitingTurns: 2, nextOpening: { at: Date.now() + 7200000, serverNow: Date.now(), localTime: '18:00' } }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'v', name: 'Venue', services: [service, { ...service, id: 'old', name: 'Legacy closed', nextOpening: undefined }, { ...service, id: 'paused', name: 'Paused open', serviceOpen: true, queueState: 'paused' }] })))
  render(<MemoryRouter initialEntries={['/v/v?lang=es']}><Routes><Route path="/v/:venueId" element={<PublicVenue />} /></Routes></MemoryRouter>)
  const card = await screen.findByRole('article', { name: 'Restaurante' })
  expect(within(card).getByText('Abre a las 18:00h')).toBeVisible()
  expect(within(card).queryByTestId('public-waiting-turns')).not.toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(screen.queryByText('Legacy closed')).not.toBeInTheDocument()
  expect(screen.queryByText('Paused open')).not.toBeInTheDocument()
})
