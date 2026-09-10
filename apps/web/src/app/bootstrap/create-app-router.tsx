import { createBrowserRouter } from 'react-router'
import { nativeRoutes } from '../routes/native-routes'
import { webRoutes } from '../routes/web-routes'
import type { AppRuntime } from './runtime'

export function createAppRouter(runtime: AppRuntime) {
  return createBrowserRouter(runtime === 'native' ? nativeRoutes : webRoutes)
}
