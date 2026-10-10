import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { PublicKiosk } from './PublicKiosk'
const service = { id: 'q', venueName: 'Hotel', name: 'Restaurant', type: 'restaurant', open: 1, serviceOpen: true, canJoin: true, queueState: 'active', spaces: [{ id: 'room', name: 'Room', maxPartySize: 4 }], receptionServices: ['check_in', 'other'] }
const posts: RequestInit[] = []
function mount(type = 'restaurant', fail?: number) {
  let failed = false
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'POST') {
      posts.push(init)
      if (fail && !failed) { failed = true; return new Response('', { status: fail }) }
      return Response.json({ recoveryToken: 'PRIVATE-TOKEN', entry: {} })
    }
    return Response.json({ ...service, type })
  }))
  render(<MemoryRouter initialEntries={['/q/q/kiosk?lang=en']}><Routes><Route path="/q/:queueId/kiosk" element={<PublicKiosk />} /></Routes></MemoryRouter>)
}
async function fill(name = 'First guest') {
  await screen.findByLabelText('Name')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '612345678' } })
  fireEvent.click(screen.getByRole('switch'))
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); posts.length = 0; localStorage.clear(); sessionStorage.clear() })
it.each(['restaurant', 'reception', 'pool'])('requires explicit valid WhatsApp consent for %s and clears data after success', async (type) => {
  mount(type)
  await screen.findByLabelText('Name')
  expect(screen.getByRole('button', { name: 'Join waiting list' })).toBeDisabled()
  expect(screen.getByRole('switch')).not.toBeChecked()
  expect(screen.getByLabelText('Name')).toHaveAttribute('autocomplete', 'off')
  expect(screen.getByLabelText('Phone number')).toHaveAttribute('autocomplete', 'off')
  await fill()
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await screen.findByRole('heading', { name: "You're on the waiting list!" })
  expect(screen.queryByLabelText('Name')).toBeNull()
  expect(document.body.textContent).not.toContain('PRIVATE-TOKEN')
  expect(window.location.href + JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).not.toContain('PRIVATE-TOKEN')
  expect(JSON.parse(posts[0]!.body as string)).toMatchObject({ partySize: 1, whatsapp: { consent: true, phone: '+34612345678' } })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  expect(posts).toHaveLength(1)
  expect(screen.getByLabelText('Name')).toHaveValue('')
  expect(screen.getByRole('switch')).not.toBeChecked()
  await fill('Second guest')
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect((posts[1]!.headers as Record<string, string>)['Idempotency-Key']).not.toBe((posts[0]!.headers as Record<string, string>)['Idempotency-Key'])
})
it('resets after ten seconds and manual reset cancels the previous timer', async () => {
  mount('pool'); await fill()
  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await act(async () => {})
  act(() => vi.advanceTimersByTime(9999))
  expect(screen.getByRole('heading', { name: "You're on the waiting list!" })).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByLabelText('Name')).toHaveValue('')
  vi.useRealTimers(); await fill(); vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' })); await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Next guest' } })
  act(() => vi.advanceTimersByTime(10000))
  expect(screen.getByLabelText('Name')).toHaveValue('Next guest')
})
it.each([429, 503])('preserves the same intent for explicit retry after HTTP %s', async (status) => {
  mount('pool', status); await fill()
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await screen.findByRole('heading', { name: "You're on the waiting list!" })
  expect((posts[1]!.headers as Record<string, string>)['Idempotency-Key']).toBe((posts[0]!.headers as Record<string, string>)['Idempotency-Key'])
})
it.each(['closed', 'paused', 'capacity'])('blocks new registrations while admission is %s', async (reason) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...service, canJoin: false, serviceOpen: reason !== 'closed', queueState: reason === 'paused' ? 'paused' : 'active', blockReason: reason })))
  render(<MemoryRouter initialEntries={['/q/q/kiosk?lang=en']}><Routes><Route path="/q/:queueId/kiosk" element={<PublicKiosk />} /></Routes></MemoryRouter>)
  await screen.findByLabelText('Name')
  expect(screen.getByRole('button', { name: 'Join waiting list' })).toBeDisabled()
  expect(screen.getByLabelText('Name')).toBeDisabled()
})
it('reports network failure without submitting automatically and locks duplicate submissions', async () => {
  let reject: (reason: Error) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'POST') {
      posts.push(init)
      return new Promise<Response>((_resolve, fail) => { reject = fail })
    }
    return Response.json({ ...service, type: 'pool' })
  }))
  render(<MemoryRouter initialEntries={['/q/q/kiosk?lang=en']}><Routes><Route path="/q/:queueId/kiosk" element={<PublicKiosk />} /></Routes></MemoryRouter>)
  await fill()
  const button = screen.getByRole('button', { name: 'Join waiting list' })
  fireEvent.click(button)
  fireEvent.submit(button.closest('form')!)
  expect(posts).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  await act(async () => reject(new Error('Network lost')))
  expect(screen.getByRole('alert')).toHaveTextContent('Retry to recover')
  expect(posts).toHaveLength(1)
  expect(screen.getByLabelText('Name')).toHaveValue('First guest')
})
it('does not postpone the reset when polling refreshes service availability', async () => {
  mount('pool'); await fill(); vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await act(async () => {})
  await act(async () => vi.advanceTimersByTime(5000))
  await act(async () => vi.advanceTimersByTime(5000))
  expect(screen.getByLabelText('Name')).toHaveValue('')
})
