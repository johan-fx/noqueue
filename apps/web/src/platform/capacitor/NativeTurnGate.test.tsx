import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
const mock = vi.hoisted(() => ({ fetch: vi.fn(), listeners: new Map<string, (data: never) => void>(), minimize: vi.fn() }))
vi.mock('@/data/api/customer', () => ({ customerFetch: mock.fetch }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async (name: string, cb: (data: never) => void) => { mock.listeners.set(name, cb); return { remove: async () => mock.listeners.delete(name) } }, minimizeApp: mock.minimize } }))
import { NativeTurnGate } from './NativeTurnGate'
const token = 'aa'.repeat(32), old = 'bb'.repeat(32)
const entry = { serviceId: 'q', locale: 'es', recoveryToken: token }
let router: ReturnType<typeof createMemoryRouter>
function mount(path = '/') {
  router = createMemoryRouter([{ element: <NativeTurnGate><Outlet /></NativeTurnGate>, children: [
    { path: '/', element: <h1>Discovery</h1> }, { path: '/q/:id', element: <h1>Join form</h1> }, { path: '/t/:token', element: <h1>Timer</h1> },
  ] }], { initialEntries: [path] })
  render(<RouterProvider router={router} />)
}
beforeEach(() => { mock.listeners.clear(); mock.minimize.mockClear(); mock.fetch.mockReset().mockImplementation(async () => Response.json({ entries: [entry] })) })
afterEach(() => { cleanup(); router.dispose() })
it.each(['/', '/q/other', `/t/${old}`])('resolves %s directly to the owned active turn', async path => {
  mount(path)
  expect(await screen.findByRole('heading', { name: 'Timer' })).toBeVisible()
  expect(router.state.location.pathname).toBe(`/t/${token}`)
  expect(screen.queryByText('Join form')).not.toBeInTheDocument()
})
it('rechecks background resume without push and prioritizes current turn over deep links', async () => {
  mock.fetch.mockImplementation(async () => Response.json({ entries: [] }))
  mount()
  await screen.findByText('Discovery')
  mock.fetch.mockImplementation(async () => Response.json({ entries: [entry] }))
  await act(async () => mock.listeners.get('appStateChange')!({ isActive: true } as never))
  await screen.findByText('Timer')
  await act(() => router.navigate('/q/other'))
  await waitFor(() => expect(router.state.location.pathname).toBe(`/t/${token}`))
  expect(screen.queryByText('Join form')).not.toBeInTheDocument()
})
it('keeps the final turn screen after release and permits a new service only afterwards', async () => {
  mount()
  await screen.findByText('Timer')
  mock.fetch.mockImplementation(async () => Response.json({ entries: [] }))
  await act(async () => window.dispatchEvent(new Event('noqueue:turn-changed')))
  expect(await screen.findByText('Timer')).toBeVisible()
  await act(() => router.navigate('/q/new'))
  expect(await screen.findByText('Join form')).toBeVisible()
})
it('treats duplicate legacy entries as an error, never silently chooses a turn', async () => {
  mock.fetch.mockImplementation(async () => Response.json({ entries: [entry, { ...entry, recoveryToken: old }] }))
  mount()
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByText('Discovery')).not.toBeInTheDocument()
})
it('does not unlock another form after a network failure', async () => {
  mount()
  await screen.findByText('Timer')
  mock.fetch.mockRejectedValue(new Error('offline'))
  await act(() => router.navigate('/q/new'))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByText('Join form')).not.toBeInTheDocument()
})
it('Android back backgrounds the active turn rather than returning to a form', async () => {
  mount()
  await screen.findByText('Timer')
  act(() => mock.listeners.get('backButton')!({ canGoBack: true } as never))
  expect(mock.minimize).toHaveBeenCalledOnce()
  expect(router.state.location.pathname).toBe(`/t/${token}`)
})
