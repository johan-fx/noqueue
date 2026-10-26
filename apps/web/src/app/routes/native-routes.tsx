import { LoadingSpinner } from '@/components/LoadingSpinner'
import { redirect, type RouteObject } from 'react-router'
import { NativeShell } from '../shells/NativeShell'
import { createNativeOwnership } from '@/platform/capacitor/native-ownership'
import { createNativeRouteLoader, nativeShouldRevalidate } from '@/platform/capacitor/native-route-loader'
import { NativeNotFound } from '@/features/customer/NativeNotFound'

export function createNativeRoutes(): RouteObject[] {
  const coordinator = createNativeOwnership()
  return [
  {
    id: 'native-root',
    loader: createNativeRouteLoader(coordinator),
    shouldRevalidate: nativeShouldRevalidate,
    hydrateFallbackElement: <LoadingSpinner fullScreen />,
    element: <NativeShell coordinator={coordinator} />,
    children: [
      {
        path: '/',
        lazy: async () => {
          const { PublicDiscovery } = await import('@/features/customer/PublicDiscovery')
          return { Component: () => <PublicDiscovery /> }
        },
      },
      {
        path: '/search',
        lazy: async () => {
          const { PublicDiscovery } = await import('@/features/customer/PublicDiscovery')
          return { Component: () => <PublicDiscovery search /> }
        },
      },
      { path: '/turns', element: null },
      {
        path: '/v/:venueId',
        // Venue-level service selection is deprecated. Keep the path as a
        // compatibility redirect for old QR/deep links, but never surface it.
        loader: ({ request }) => {
          const lang = new URL(request.url).searchParams.get('lang')
          return redirect(lang === 'es' || lang === 'en' ? `/?lang=${lang}` : '/')
        },
      },
      {
        path: '/q/:queueId',
        lazy: async () => ({
          Component: (await import('@/features/customer/PublicQueue')).PublicQueue,
        }),
      },
      {
        path: '/t/:recoveryToken',
        lazy: async () => ({
          Component: (await import('@/features/customer/CustomerTurn'))
            .CustomerTurn,
        }),
      },
      { path: '*', element: <NativeNotFound /> },
    ],
  },
]

}

// Static route inventory compatibility; production and tests use the factory.
export const nativeRoutes = createNativeRoutes()
