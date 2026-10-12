import { createBrowserRouter } from 'react-router'
import { nativeRoutes } from '../routes/native-routes'
import { webRoutes } from '../routes/web-routes'
import type { AppRuntime } from './runtime'
import { withRouteRecovery } from '../recovery/with-route-recovery'

export function createAppRouter(runtime: AppRuntime) {
  return createBrowserRouter(
    withRouteRecovery(runtime === 'native' ? nativeRoutes : webRoutes),
  )
}
