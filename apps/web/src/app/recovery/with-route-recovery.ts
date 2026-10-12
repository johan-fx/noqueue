import type { RouteObject } from 'react-router'
import { RouteErrorBoundary, RouteLoadingScreen } from './RouteErrorBoundary'

export function withRouteRecovery(children: RouteObject[]): RouteObject[] {
  return [{
    id: 'app-recovery',
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: RouteLoadingScreen,
    children,
  }]
}
