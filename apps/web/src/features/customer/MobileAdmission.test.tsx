import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { PublicQueue } from './PublicQueue'


const mock = vi.hoisted(() => ({ fetch: vi.fn(), prepare: vi.fn(), finish: vi.fn(), push: vi.fn() }))
vi.mock('@/platform/capacitor/native-push-context', () => ({ usePushAfterJoin: () => mock.push }))
vi.mock('@/app/bootstrap/runtime', () => ({ detectRuntime: () => 'native' }))
vi.mock('@/data/api/customer', () => ({ customerFetch: mock.fetch }))
vi.mock('@/platform/capacitor/installation', () => ({ prepareMobileJoin: mock.prepare, finishMobileJoin: mock.finish }))
beforeEach(() => {
  mock.push.mockReset(); mock.fetch.mockReset(); mock.finish.mockReset().mockResolvedValue(undefined)
  mock.prepare.mockReset().mockImplementation(async (_service, key, input) => ({ key, input }))
})
afterEach(() => { cleanup(); localStorage.clear() })
const token = 'ab'.repeat(32)
const service = (type: string) => ({ id: 'q', name: 'Service', venueId: 'v', venueName: 'Venue', type, open: 1, canJoin: true, queueState: 'active', spaces: [{ id: 'room', name: 'Room', maxPartySize: 4 }], receptionServices: ['check_in'] })
function mount() {
  return render(<MemoryRouter initialEntries={['/q/q?lang=en']}><Routes>
    <Route path="/q/:queueId" element={<PublicQueue />} />
    <Route path="/t/:recoveryToken" element={<p>Secure turn opened</p>} />
  </Routes></MemoryRouter>)
}
it.each(['restaurant', 'reception', 'pool'])('joins mobile %s with no phone, contact payload or consent, preserving operational fields', async type => {
  mock.fetch.mockImplementation(async (_url, init) => init?.method === 'POST'
    ? Response.json({ code: 'ABCDEF', position: 1, etaMinutes: 0, status: 'waiting', notification: 'disabled', recoveryToken: token })
    : Response.json(service(type)))
  mount()
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Guest' } })
  expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  expect(await screen.findByText('Secure turn opened')).toBeVisible()
  const post = mock.fetch.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(post[1].body)).toEqual({ displayName: 'Guest', partySize: 1, locale: 'en',
    ...(type === 'restaurant' ? { preferredSpaceId: 'fastest' } : type === 'reception' ? { receptionService: 'check_in' } : {}) })
  expect(mock.prepare).toHaveBeenCalledTimes(1)
  expect(mock.prepare.mock.invocationCallOrder[0]!).toBeLessThan(mock.fetch.mock.invocationCallOrder.at(-1)!)
  expect(mock.finish).toHaveBeenCalledWith(post[1].headers['Idempotency-Key'])
  expect(mock.push).toHaveBeenCalledExactlyOnceWith(post[1].headers['Idempotency-Key'])
  expect(mock.push.mock.invocationCallOrder[0]).toBeGreaterThan(mock.finish.mock.invocationCallOrder[0]!)
})
it('does not POST when secure storage fails', async () => {
  mock.fetch.mockImplementation(async () => Response.json(service('pool')))
  mock.prepare.mockRejectedValue(new Error('Secure storage unavailable'))
  mount()
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Guest' } })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Secure storage unavailable')
  expect(mock.fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  expect(mock.finish).not.toHaveBeenCalled()
  expect(mock.push).not.toHaveBeenCalled()
})
it('retries a lost response with the frozen key and does not discard the pending intent', async () => {
  let posts = 0
  mock.fetch.mockImplementation(async (_url, init) => {
    if (init?.method !== 'POST') return Response.json(service('pool'))
    posts++
    if (posts === 1) throw new Error('Response lost')
    return Response.json({ code: 'ABCDEF', position: 1, etaMinutes: 0, status: 'waiting', notification: 'disabled', recoveryToken: token })
  })
  mount()
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Guest' } })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await screen.findByRole('alert')
  expect(mock.finish).not.toHaveBeenCalled()
  expect(mock.push).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await screen.findByText('Secure turn opened')
  const calls = mock.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
  expect(calls[0]![1].headers['Idempotency-Key']).toBe(calls[1]![1].headers['Idempotency-Key'])
  expect(mock.push).toHaveBeenCalledExactlyOnceWith(calls[0]![1].headers['Idempotency-Key'])
})
it('opens the already active turn when a concurrent admission wins', async () => {
  mock.fetch.mockImplementation(async (_url, init) => init?.method === 'POST'
    ? Response.json({ error: 'active_turn_exists', entry: { serviceId: 'other', locale: 'en', recoveryToken: token } }, { status: 409 })
    : Response.json(service('pool')))
  mount()
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Guest' } })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  expect(await screen.findByText('Secure turn opened')).toBeVisible()
  expect(mock.finish).toHaveBeenCalledOnce()
  expect(mock.push).not.toHaveBeenCalled()
})
it.each([400, 503])('handles rejected/ambiguous HTTP %s without navigating or discarding uncertain commits', async status => {
  mock.fetch.mockImplementation(async (_url, init) => init?.method === 'POST'
    ? Response.json({ error: 'unavailable' }, { status }) : Response.json(service('pool')))
  mount()
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Guest' } })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('Secure turn opened')).not.toBeInTheDocument()
  expect(mock.finish).toHaveBeenCalledTimes(status === 400 ? 1 : 0)
  expect(mock.push).not.toHaveBeenCalled()
})

it('does not wait for the notification dialog before opening the confirmed turn', async () => {
  mock.push.mockReturnValue(new Promise(() => undefined))
  mock.fetch.mockImplementation(async (_url, init) => init?.method === 'POST'
    ? Response.json({ code: 'ABCDEF', position: 1, etaMinutes: 0, status: 'waiting', notification: 'disabled', recoveryToken: token })
    : Response.json(service('pool')))
  mount()
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Guest' } })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  expect(await screen.findByText('Secure turn opened')).toBeVisible()
  expect(mock.push).toHaveBeenCalledOnce()
})
