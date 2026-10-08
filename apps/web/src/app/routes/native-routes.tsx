import { NativeJoinQueueScreen } from '@/features/join-queue/native/NativeJoinQueueScreen'
import type { RouteObject } from 'react-router'
import { NativeShell } from '../shells/NativeShell'

export const nativeRoutes: RouteObject[] = [
  {
    element: <NativeShell />,
    children: [
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
      { path: '*', element: <NativeJoinQueueScreen /> },
    ],
  },
]
