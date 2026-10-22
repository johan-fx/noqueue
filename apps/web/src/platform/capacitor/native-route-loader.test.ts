import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterContextProvider } from 'react-router'
import { createNativeOwnership } from './native-ownership'
import { createNativeRouteLoader, nativeShouldRevalidate, type NativeRouteData } from './native-route-loader'
const mock = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/data/api/customer', () => ({ customerFetch: mock.fetch }))
const token = 'aa'.repeat(32)
const entry = { serviceId: 'q', locale: 'es', recoveryToken: token }
const service = { id: 'q', venueId: 'v', name: 'Restaurant', venueName: 'Venue', type: 'restaurant', open: 1, serviceOpen: true, queueState: 'active', canJoin: true, spaces: [{ id: 'room', name: 'Room', maxPartySize: 4 }], receptionServices: [], averageWaitMinutes: 5, waitingPeople: 0, waitingTurns: 0 }
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const args = (path: string, signal = new AbortController().signal) => ({ request: new Request(`https://localhost${path}`, { signal }), params: {}, context: new RouterContextProvider(), url: new URL(`https://localhost${path}`), pattern: path })
beforeEach(() => {
  mock.fetch.mockReset().mockImplementation(async (url: string) => url.endsWith('/entries') ? Response.json({ entries: [] }) : Response.json(service))
})
afterEach(() => { vi.useRealTimers(); localStorage.clear(); document.documentElement.removeAttribute('data-noqueue-transition-intent') })

describe('native destination preparation', () => {
  it('waits for authorization before even requesting the page, then seeds its data', async () => {
    const gate = deferred<Response>(), page = deferred<Response>()
    mock.fetch.mockImplementation((url: string) => url.endsWith('/entries') ? gate.promise : page.promise)
    const coordinator = createNativeOwnership()
    const loading = createNativeRouteLoader(coordinator)(args('/q/q'))
    expect(mock.fetch).toHaveBeenCalledTimes(1)
    gate.resolve(Response.json({ entries: [] }))
    await vi.waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(2))
    let finished = false
    void loading.then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    page.resolve(Response.json(service))
    const result = await loading as NativeRouteData
    expect(result.allowed).toBe(true)
    expect(result.seed?.data).toMatchObject({ id: 'q' })
    expect(result.seed?.error).toBe(false)
  })
  it('redirects before fetching a forbidden form and canonicalizes legacy turns', async () => {
    mock.fetch.mockResolvedValue(Response.json({ entries: [entry] }))
    const result = await createNativeRouteLoader(createNativeOwnership())(args('/q/other?lang=en')) as Response
    expect(result.headers.get('Location')).toBe(`/t/${token}?lang=en`)
    expect(result.headers.get('X-Remix-Replace')).toBe('true')
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('bottom-up')
    expect(mock.fetch).toHaveBeenCalledTimes(1)
    mock.fetch.mockImplementation(async () => Response.json({ entries: [] }))
    const legacy = await createNativeRouteLoader(createNativeOwnership())(args('/turns?lang=en')) as Response
    expect(legacy.headers.get('Location')).toBe('/?lang=en')
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('replace')
  })
  it('fails closed on ownership errors and duplicate active entries', async () => {
    for (const response of [Response.json({}, { status: 503 }), Response.json({ entries: [entry, entry] })]) {
      mock.fetch.mockResolvedValueOnce(response)
      const result = await createNativeRouteLoader(createNativeOwnership())(args('/q/q')) as NativeRouteData
      expect(result.allowed).toBe(false)
      expect(result.ownership.error).toBe(true)
      expect(result.seed).toBeNull()
    }
    expect(mock.fetch).toHaveBeenCalledTimes(2)
  })
  it('keeps page fetch errors recoverable without treating them as authorization errors', async () => {
    mock.fetch.mockImplementation(async (url: string) => url.endsWith('/entries') ? Response.json({ entries: [] }) : Response.json({}, { status: 503 }))
    const result = await createNativeRouteLoader(createNativeOwnership())(args('/q/q')) as NativeRouteData
    expect(result.allowed).toBe(true)
    expect(result.seed).toMatchObject({ key: '/api/v1/public/services/q', error: true })
  })
  it('only retains the exact previously committed owned turn while offline', async () => {
    const coordinator = createNativeOwnership()
    mock.fetch.mockImplementation(async () => Response.json({ entries: [entry] }))
    await coordinator.check(new AbortController().signal)
    const seed = { key: `/api/v1/public/entries/${token}`, data: { safe: 'retained' }, error: false, updatedAt: 1 }
    coordinator.commit(`/t/${token}`, seed)
    mock.fetch.mockRejectedValue(new Error('offline'))
    const load = createNativeRouteLoader(coordinator)
    expect(await load(args(`/t/${token}`))).toMatchObject({ allowed: true, seed })
    expect(await load(args('/q/q'))).toMatchObject({ allowed: false, seed: null })
  })
  it('restarts authorization if a turn changes while the page is being prepared', async () => {
    const page = deferred<Response>(), coordinator = createNativeOwnership()
    mock.fetch.mockImplementation((url: string) => url.endsWith('/entries') ? Promise.resolve(Response.json({ entries: [] })) : page.promise)
    const loading = createNativeRouteLoader(coordinator)(args('/q/q'))
    await vi.waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(2))
    mock.fetch.mockImplementation(async () => Response.json({ entries: [entry] }))
    coordinator.invalidate()
    const result = await loading as Response
    expect(result.headers.get('Location')).toBe(`/t/${token}?lang=es`)
    page.resolve(Response.json(service))
  })
  it('aborts a replaced navigation, including a transport that ignores cancellation', async () => {
    const pending = deferred<Response>(), signal = new AbortController(), coordinator = createNativeOwnership()
    mock.fetch.mockReturnValue(pending.promise)
    const result = createNativeRouteLoader(coordinator)(args('/q/q', signal.signal))
    signal.abort()
    await expect(result).rejects.toBeDefined()
    expect(coordinator.preparing).toBe(false)
    pending.resolve(Response.json({ entries: [entry] }))
    await Promise.resolve()
    expect(coordinator.getSnapshot().entry).toBeNull()
  })
  it('times out preparation at 15 seconds instead of trapping the user in pending UI', async () => {
    vi.useFakeTimers()
    mock.fetch.mockReturnValue(new Promise(() => {}))
    const coordinator = createNativeOwnership()
    const result = createNativeRouteLoader(coordinator)(args('/q/q'))
    await vi.advanceTimersByTimeAsync(15000)
    expect(await result).toMatchObject({ allowed: false, ownership: { error: true } })
    expect(coordinator.preparing).toBe(false)
  })
  it('shares one in-flight ownership request across consumers', async () => {
    const pending = deferred<Response>(), coordinator = createNativeOwnership()
    mock.fetch.mockReturnValue(pending.promise)
    const first = coordinator.check(new AbortController().signal)
    const second = coordinator.check(new AbortController().signal)
    expect(mock.fetch).toHaveBeenCalledTimes(1)
    pending.resolve(Response.json({ entries: [] }))
    expect(await first).toEqual(await second)
  })
  it('skips query-only preparation but rechecks explicit revalidation and pathname changes', async () => {
    const coordinator = createNativeOwnership()
    const router = createMemoryRouter([{ id: 'native-root', loader: createNativeRouteLoader(coordinator), shouldRevalidate: nativeShouldRevalidate, children: [{ path: '*' }] }])
    try {
      await vi.waitFor(() => expect(router.state.initialized).toBe(true))
      expect(mock.fetch).toHaveBeenCalledTimes(1)
      await router.navigate('/?lang=en')
      expect(mock.fetch).toHaveBeenCalledTimes(1)
      await router.revalidate()
      expect(mock.fetch).toHaveBeenCalledTimes(2)
      await router.navigate('/q/q')
      expect(mock.fetch).toHaveBeenCalledTimes(4)
    } finally { router.dispose() }
  })
})
