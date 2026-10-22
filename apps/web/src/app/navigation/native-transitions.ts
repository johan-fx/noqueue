import { useCallback, useLayoutEffect, useRef } from 'react'
import {
  resolvePath,
  useLocation,
  useNavigate,
  type DataRouter,
  type NavigateFunction,
  type NavigateOptions,
  type To,
} from 'react-router'
import { detectRuntime } from '../bootstrap/runtime'

export type NativeTransitionIntent = 'forward' | 'back' | 'bottom-up' | 'replace' | 'none'

type NativeNavigateOptions = Omit<NavigateOptions, 'viewTransition'> & {
  /** Visual direction only; does not change the browser history operation. */
  intent?: NativeTransitionIntent
}

type RouterOrNavigate = Pick<DataRouter, 'navigate'> | NavigateFunction

type NativeTransitionEnvironment = {
  native?: boolean
  document?: Document
  window?: Window
}

function getNavigator(router: RouterOrNavigate): NavigateFunction {
  return typeof router === 'function' ? router : router.navigate.bind(router)
}

function isNativeRuntime() {
  return detectRuntime() === 'native'
}

export function canUseNativeViewTransitions(
  environment: NativeTransitionEnvironment = {},
): boolean {
  const native = environment.native ?? isNativeRuntime()
  if (!native) return false

  const doc = environment.document ?? (typeof document === 'undefined' ? undefined : document)
  const win = environment.window ?? (typeof window === 'undefined' ? undefined : window)
  if (!doc || !win) return false

  const startViewTransition = (doc as Document & {
    startViewTransition?: unknown
  }).startViewTransition
  if (typeof startViewTransition !== 'function') return false

  return !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Set before invoking React Router so the mode is present for its snapshot capture. */
export function setNativeTransitionIntent(
  intent: NativeTransitionIntent,
  doc: Document = document,
) {
  doc.documentElement.dataset.noqueueTransitionIntent = intent
}

export function transitionIntentForPathChange(
  currentPathname: string,
  nextPathname: string,
  intent?: NativeTransitionIntent,
  replace = false,
): NativeTransitionIntent {
  if (currentPathname === nextPathname || intent === 'none') return 'none'
  // Present the full-screen turn vertically, independently of history replace.
  if (/^\/t(?:\/|$)/.test(nextPathname)) return 'bottom-up'
  if (intent) return intent
  return replace ? 'replace' : 'forward'
}

function destinationPathname(to: To, currentPathname: string) {
  return resolvePath(to, currentPathname).pathname
}

/**
 * Programmatic equivalent of `useNavigate`, with an additional native-only
 * transition intent. Absolute app routes are preferred so semantics match the
 * platform links; relative targets resolve from the current URL path.
 */
export function navigateApp(
  router: RouterOrNavigate,
  to: To | number,
  options?: NativeNavigateOptions,
  currentPathname?: string,
) {
  const navigate = getNavigator(router)
  if (typeof to === 'number') return navigate(to)

  const { intent, ...navigateOptions } = options ?? {}
  if (!isNativeRuntime()) return navigate(to, navigateOptions)

  const current = currentPathname ?? window.location.pathname
  const next = destinationPathname(to, current)
  const mode = transitionIntentForPathChange(
    current,
    next,
    intent,
    navigateOptions.replace,
  )
  const enabled = mode !== 'none' && canUseNativeViewTransitions()
  if (mode !== 'none') setNativeTransitionIntent(mode)
  return navigate(to, { ...navigateOptions, viewTransition: enabled })
}

/** Stable wrapper so lifecycle providers don't restart when the current route changes. */
export function useAppNavigate() {
  const navigate = useNavigate()
  const location = useLocation()
  const latest = useRef({ navigate, pathname: location.pathname })
  useLayoutEffect(() => {
    latest.current = { navigate, pathname: location.pathname }
  }, [navigate, location.pathname])

  const appNavigate = useCallback(
    (to: To | number, options?: NativeNavigateOptions) =>
      navigateApp(latest.current.navigate, to, options, latest.current.pathname),
    [],
  )
  return appNavigate as NavigateFunction & {
    (to: To, options?: NativeNavigateOptions): void | Promise<void>
  }
}

/** Installs intent metadata before React Router handles a browser/WebView POP. */
export function observeNativePopTransitions(router: Pick<DataRouter, 'state' | 'subscribe'>) {
  if (!isNativeRuntime() || typeof window === 'undefined') return () => undefined

  let lastPathname = router.state.location.pathname
  let lastIndex = historyIndex(window.history.state)
  const unsubscribe = router.subscribe((state) => {
    lastPathname = state.location.pathname
    lastIndex = historyIndex(window.history.state)
  })

  const onPopState = (event: PopStateEvent) => {
    const nextPathname = window.location.pathname
    if (nextPathname === lastPathname) {
      setNativeTransitionIntent('none')
      return
    }

    const nextIndex = historyIndex(event.state)
    const intent = lastIndex === null || nextIndex === null || lastIndex === nextIndex
      ? 'replace'
      : nextIndex < lastIndex ? 'back' : 'forward'
    setNativeTransitionIntent(transitionIntentForPathChange(lastPathname, nextPathname, intent))
  }

  // Capture runs before React Router's own popstate listener starts its load.
  window.addEventListener('popstate', onPopState, true)
  return () => {
    unsubscribe()
    window.removeEventListener('popstate', onPopState, true)
  }
}

function historyIndex(state: unknown): number | null {
  if (!state || typeof state !== 'object' || !('idx' in state)) return null
  const index = (state as { idx?: unknown }).idx
  return typeof index === 'number' && Number.isFinite(index) ? index : null
}
