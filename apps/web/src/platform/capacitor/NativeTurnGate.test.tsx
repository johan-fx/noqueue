import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData } from 'react-router'
const mock = vi.hoisted(() => ({ fetch: vi.fn(), listeners: new Map<string, (data: never) => void>(), minimize: vi.fn(), ready: vi.fn() }))
vi.mock('@/app/bootstrap/native-splash', () => ({ finishNativeStartup: mock.ready }))
vi.mock('@/data/api/customer', () => ({ customerFetch: mock.fetch }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async (name: string, cb: (data: never) => void) => { mock.listeners.set(name, cb); return { remove: async () => mock.listeners.delete(name) } }, minimizeApp: mock.minimize } }))
import { NativeTurnGate } from './NativeTurnGate'
import { createNativeOwnership, type NativeOwnershipCoordinator } from './native-ownership'
import { createNativeRouteLoader, type NativeRouteData } from './native-route-loader'
function Gate({ coordinator }: { coordinator: NativeOwnershipCoordinator }) {
  const data = useLoaderData<NativeRouteData>()
  return <NativeTurnGate coordinator={coordinator} data={data}><Outlet /></NativeTurnGate>
}
const token = 'aa'.repeat(32), old = 'bb'.repeat(32)
const entry = { serviceId: 'q', locale: 'es', recoveryToken: token }
let router: ReturnType<typeof createMemoryRouter>
function mount(path = '/') {
  const coordinator = createNativeOwnership()
  router = createMemoryRouter([{ id: 'native-root', loader: createNativeRouteLoader(coordinator), hydrateFallbackElement: <p>Preparing</p>, element: <Gate coordinator={coordinator} />, children: [
    { path: '/', element: <h1>Discovery</h1> }, { path: '/q/:id', element: <h1>Join form</h1> }, { path: '/t/:token', element: <h1>Timer</h1> },
  ] }], { initialEntries: [path] })
  render(<RouterProvider router={router} />)
}
beforeEach(() => { mock.listeners.clear(); mock.minimize.mockClear(); mock.ready.mockClear(); mock.fetch.mockReset().mockImplementation(async () => Response.json({ entries: [entry] })) })
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
it.each([true, false])('Android back from a public join flow returns home (history=%s)', async canGoBack => {
  mock.fetch.mockImplementation(async () => Response.json({ entries: [] }))
  mount('/q/service?lang=en')
  expect(await screen.findByText('Join form')).toBeVisible()

  act(() => mock.listeners.get('backButton')!({ canGoBack } as never))

  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('?lang=en')
  })
  expect(mock.minimize).not.toHaveBeenCalled()
})
it('keeps the previous public form inert while preparing the newly discovered owned turn', async () => {
  mock.fetch.mockImplementation(async () => Response.json({ entries: [] }))
  mount('/q/new')
  await screen.findByText('Join form')
  let finish!: (response: Response) => void
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/entries')
    ? Response.json({ entries: [entry] })
    : new Promise<Response>(resolve => { finish = resolve }))
  await act(async () => window.dispatchEvent(new Event('noqueue:turn-changed')))
  await waitFor(() => expect(screen.getByText('Join form').closest('[inert]')).not.toBeNull())
  expect(screen.queryByText('Timer')).not.toBeInTheDocument()
  await act(async () => finish(Response.json({})))
  expect(await screen.findByText('Timer')).toBeVisible()
})
it('hides a different private ticket immediately if ownership changes', async () => {
  mock.fetch.mockImplementation(async () => Response.json({ entries: [{ ...entry, recoveryToken: old }] }))
  mount(`/t/${old}`)
  await screen.findByText('Timer')
  let finish!: (response: Response) => void
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/entries')
    ? Response.json({ entries: [entry] })
    : new Promise<Response>(resolve => { finish = resolve }))
  await act(async () => window.dispatchEvent(new Event('noqueue:turn-changed')))
  expect((await screen.findByRole('status', { name: 'Cargando' })).textContent).toBe('')
  expect(screen.getByRole('status')).toHaveClass('animate-spin')
  expect(screen.queryByText('Timer')).not.toBeInTheDocument()
  await act(async () => finish(Response.json({})))
  expect(await screen.findByText('Timer')).toBeVisible()
  expect(router.state.location.pathname).toBe(`/t/${token}`)
})

it('retains the native splash while ownership is unresolved and hides after child commit', async () => {
  let resolve!: (response: Response) => void
  mock.fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
  mock.ready.mockImplementation(() => expect(screen.getByText('Discovery')).toBeVisible())
  mount()
  expect(mock.ready).not.toHaveBeenCalled()
  await act(async () => resolve(Response.json({ entries: [] })))
  await screen.findByText('Discovery')
  expect(mock.ready).toHaveBeenCalledOnce()
  mock.ready.mockReset()
})
it('reveals the owned turn only after redirect and prepared route, never intermediate discovery', async () => {
  mock.ready.mockImplementation(() => {
    expect(screen.getByText('Timer')).toBeVisible()
    expect(screen.queryByText('Discovery')).not.toBeInTheDocument()
  })
  mount()
  await screen.findByText('Timer')
  expect(mock.ready).toHaveBeenCalledOnce()
  mock.ready.mockReset()
})
it('releases splash when initial ownership failure commits a recoverable error', async () => {
  mock.fetch.mockRejectedValue(new Error('offline'))
  mock.ready.mockImplementation(() => expect(screen.getByRole('alert')).toBeVisible())
  mount()
  await screen.findByRole('alert')
  expect(mock.ready).toHaveBeenCalledOnce()
  mock.ready.mockReset()
})
