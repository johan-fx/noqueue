import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ value: 'native' as 'native' | 'web' }))
vi.mock('../bootstrap/runtime', () => ({ detectRuntime: () => runtime.value }))

import {
  canUseNativeViewTransitions,
  navigateApp,
  observeNativePopTransitions,
  transitionIntentForPathChange,
} from './native-transitions'

describe('native route transition decisions', () => {
  beforeEach(() => {
    runtime.value = 'native'
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
  })

  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
    delete (window as unknown as { matchMedia?: unknown }).matchMedia
    document.documentElement.removeAttribute('data-noqueue-transition-intent')
    vi.restoreAllMocks()
  })

  it('uses a forward default, honors back/replace intents, and presents turn routes bottom-up', () => {
    expect(transitionIntentForPathChange('/', '/search')).toBe('forward')
    expect(transitionIntentForPathChange('/q/one', '/search', 'back')).toBe('back')
    expect(transitionIntentForPathChange('/q/one', '/q/one', 'back')).toBe('none')
    expect(transitionIntentForPathChange('/q/one', '/t/token', 'forward')).toBe('bottom-up')
    expect(transitionIntentForPathChange('/search', '/t/token', 'replace', true)).toBe('bottom-up')
    expect(transitionIntentForPathChange('/t/token', '/t/token')).toBe('none')
    expect(transitionIntentForPathChange('/', '/t/token', 'none')).toBe('none')
    expect(transitionIntentForPathChange('/search', '/v/venue', undefined, true)).toBe('replace')
    expect(transitionIntentForPathChange('/search', '/v/venue', 'none')).toBe('none')
  })

  it('presents a turn without changing history replacement or leaking its token into metadata', () => {
    const navigate = vi.fn()
    navigateApp(navigate as never, '/t/private-token?lang=es', { replace: true, state: { joined: true } }, '/q/one')
    expect(navigate).toHaveBeenCalledWith('/t/private-token?lang=es', {
      replace: true, state: { joined: true }, viewTransition: true,
    })
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('bottom-up')
  })

  it('keeps the cancelled confirmation home exit as a normal back transition', () => {
    expect(transitionIntentForPathChange('/t/token', '/', 'back')).toBe('back')
    expect(transitionIntentForPathChange('/t/token', '/')).toBe('forward')
    expect(transitionIntentForPathChange('/t/token', '/', 'none')).toBe('none')
    expect(transitionIntentForPathChange('/t/token', '/v/venue', 'back')).toBe('back')
    expect(transitionIntentForPathChange('/t/token', '/t/token', 'back')).toBe('none')
    const navigate = vi.fn()
    navigateApp(navigate as never, '/?lang=en', { intent: 'back' }, '/t/token')
    expect(navigate).toHaveBeenCalledWith('/?lang=en', { viewTransition: true })
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('back')
  })

  it.each(['reduced', 'missing-api', 'web'] as const)('returns home without animation for %s', (mode) => {
    if (mode === 'reduced') vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    if (mode === 'missing-api') delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
    if (mode === 'web') runtime.value = 'web'
    const navigate = vi.fn()
    navigateApp(navigate as never, '/?lang=es', { intent: 'back' }, '/t/token')
    expect(navigate).toHaveBeenCalledWith('/?lang=es', mode === 'web' ? {} : { viewTransition: false })
  })

  it.each(['reduced', 'missing-api', 'web'] as const)('still opens the turn without animation for %s', (mode) => {
    if (mode === 'reduced') vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    if (mode === 'missing-api') delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
    if (mode === 'web') runtime.value = 'web'
    const navigate = vi.fn()
    navigateApp(navigate as never, '/t/token', { replace: true }, '/q/one')
    expect(navigate).toHaveBeenCalledWith('/t/token', mode === 'web'
      ? { replace: true } : { replace: true, viewTransition: false })
  })

  it('requires native runtime, the View Transition API, and motion permission', () => {
    expect(canUseNativeViewTransitions()).toBe(true)
    expect(canUseNativeViewTransitions({ native: false })).toBe(false)
    expect(canUseNativeViewTransitions({ native: true, document: document.implementation.createHTMLDocument(), window })).toBe(false)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    })
    expect(canUseNativeViewTransitions()).toBe(false)
  })

  it('sets transition intent before a native programmatic navigation', () => {
    const navigate = vi.fn((to, options) => {
      expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('forward')
      expect(to).toBe('/v/venue')
      expect(options?.viewTransition).toBe(true)
    })

    navigateApp(navigate as never, '/v/venue', { state: { source: 'qr' } }, '/')

    expect(navigate).toHaveBeenCalledWith('/v/venue', {
      state: { source: 'qr' },
      viewTransition: true,
    })
  })

  it('does not enable transitions for search-param changes or web navigation', () => {
    const navigate = vi.fn()
    navigateApp(navigate as never, '/search?lang=en', {}, '/search')
    expect(navigate).toHaveBeenCalledWith('/search?lang=en', { viewTransition: false })
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBeUndefined()

    runtime.value = 'web'
    navigate.mockClear()
    navigateApp(navigate as never, '/v/venue', { state: { source: 'web' } }, '/')
    expect(navigate).toHaveBeenCalledWith('/v/venue', { state: { source: 'web' } })
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBeUndefined()
  })

  it('leaves delta navigation to React Router and classifies known/unknown POP history', () => {
    const navigate = vi.fn()
    navigateApp(navigate as never, -1)
    expect(navigate).toHaveBeenCalledWith(-1)

    window.history.replaceState({ idx: 2 }, '', '/from')
    const router = {
      state: { location: { pathname: '/from' } },
      subscribe: () => () => undefined,
    }
    const dispose = observeNativePopTransitions(router as never)

    window.history.pushState({ idx: 1 }, '', '/to')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 1 } }))
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('back')

    window.history.pushState({}, '', '/other')
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('replace')

    window.history.pushState({ idx: 4 }, '', '/t/token')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 4 } }))
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('bottom-up')

    window.history.pushState({ idx: 3 }, '', '/from?lang=en')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 3 } }))
    expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('none')
    dispose()
  })
})
