import { startPrivacy, crossesPrivacyBoundary, type PrivacyHandle } from '@noqueue/privacy'
import type { DataRouter } from 'react-router'
import { detectRuntime } from '@/app/bootstrap/runtime'
import { restoreJoinedNotice, guardPrivacyNavigation } from './navigation'

const native = detectRuntime() === 'native'
if (!native) restoreJoinedNotice()
export const privacy: PrivacyHandle = startPrivacy({
  surface: 'app', native,
  environment: import.meta.env.VITE_APP_ENV ?? '',
  enabled: import.meta.env.VITE_ANALYTICS_ENABLED === 'true',
  measurementId: import.meta.env.VITE_GA4_MEASUREMENT_ID ?? '',
}, new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es')

privacy.suspend()

// Register before createBrowserRouter so a cross-boundary POP never reaches the SPA.
let currentPath = location.pathname
const pop = (event: PopStateEvent) => {
  if (crossesPrivacyBoundary(currentPath, location.pathname)) {
    privacy.suspend()
    event.stopImmediatePropagation()
    location.reload()
  }
}
if (!native) window.addEventListener('popstate', pop, true)
export function attachPrivacyRouter(router: DataRouter) {
  if (native) return
  router.getBlocker('privacy-document-boundary', ({ currentLocation, nextLocation, historyAction }) => {
    return guardPrivacyNavigation(currentLocation, nextLocation, historyAction, privacy)
  })
  let validatedPath: string | null = null
  const ready = (event: Event) => {
    const detail = (event as CustomEvent<{ pathname: string; ready: boolean }>).detail
    if (detail.pathname !== router.state.location.pathname) return
    validatedPath = detail.ready ? detail.pathname : null
    update(router.state)
  }
  const update = (state: DataRouter['state']) => {
    if (!state.initialized || state.navigation.state !== 'idle') return
    if (currentPath !== state.location.pathname) validatedPath = null
    currentPath = state.location.pathname
    privacy.setLanguage(new URLSearchParams(state.location.search).get('lang') === 'en' ? 'en' : 'es')
    window.dispatchEvent(new Event('noqueue:locale'))
    if (state.errors || validatedPath !== currentPath) privacy.suspend()
    else privacy.resume()
  }
  window.addEventListener('noqueue:public-page-ready', ready)
  const unsubscribe = router.subscribe(update)
  update(router.state)
  if (import.meta.hot) import.meta.hot.dispose(() => {
    window.removeEventListener('noqueue:public-page-ready', ready)
    unsubscribe(); privacy.destroy(); window.removeEventListener('popstate', pop, true)
    router.deleteBlocker('privacy-document-boundary')
  })
}
