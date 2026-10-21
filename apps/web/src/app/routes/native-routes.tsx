import { NativeTurns } from '@/features/customer/NativeTurns'
import type { RouteObject } from 'react-router'
import { NativeShell } from '../shells/NativeShell'
import { NativeNotFound } from '@/features/customer/NativeNotFound'

export const nativeRoutes: RouteObject[] = [
  {
    element: <NativeShell />,
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
      { path: '/turns', element: <NativeTurns /> },
      {
        path: '/v/:venueId',
        lazy: async () => ({
          Component: (await import('@/features/customer/PublicVenue')).PublicVenue,
        }),
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
