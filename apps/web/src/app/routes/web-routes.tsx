import { DemoQueue, DemoEntry } from '@/features/join-queue/web/DemoQueue'
import { WebJoinQueueScreen } from '@/features/join-queue/web/WebJoinQueueScreen'
import type { RouteObject } from 'react-router'
import { WebShell } from '../shells/WebShell'

export const webRoutes: RouteObject[] = [
  {
    path: '/login',
    lazy: async () => ({
      Component: (await import('@/features/auth/Login')).Login,
    }),
  },
  {
    path: '/settings/:view?',
    lazy: async () => ({
      Component: (await import('@/features/auth/Settings')).AccountSettingsPage,
    }),
  },
  {
    path: '/staff',
    lazy: async () => ({
      Component: (await import('@/features/staff/StaffApp')).StaffApp,
    }),
  },
  {
    element: <WebShell />,
    children: [
      { path: '/q/demo-queue', element: <DemoQueue /> },
      {
        path: '/q/:queueId',
        lazy: async () => ({
          Component: (await import('@/features/staff/PublicQueue')).PublicQueue,
        }),
      },
      { path: '/t/:recoveryToken', element: <DemoEntry /> },
      { path: '*', element: <WebJoinQueueScreen /> },
    ],
  },
]
