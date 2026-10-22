import { createBrowserRouter } from 'react-router'
import { createNativeRoutes } from '../routes/native-routes'
import { webRoutes } from '../routes/web-routes'
import type { AppRuntime } from './runtime'
import { withRouteRecovery } from '../recovery/with-route-recovery'
import { observeNativePopTransitions } from '../navigation/native-transitions'

export function createAppRouter(runtime: AppRuntime) {
  const router = createBrowserRouter(
    withRouteRecovery(runtime === 'native' ? createNativeRoutes() : webRoutes),
  )
  if (runtime === 'native') {
    const cleanupPopTransitions = observeNativePopTransitions(router)
    const dispose = router.dispose.bind(router)
    let cleaned = false
    router.dispose = () => {
      if (!cleaned) {
        cleaned = true
        cleanupPopTransitions()
      }
      dispose()
    }
  }
  return router
}
