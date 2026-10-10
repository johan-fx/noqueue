import { DemoQueue } from '@/features/join-queue/web/DemoQueue'
import { WebJoinQueueScreen } from '@/features/join-queue/web/WebJoinQueueScreen'
import type { RouteObject } from 'react-router'
import { WebShell } from '../shells/WebShell'

export const webRoutes: RouteObject[] = [
  {
    path: '/',
    lazy: async () => ({
      Component: (await import('@/features/customer/PublicDiscovery'))
        .PublicDiscovery,
    }),
  },
  {
    path: '/search',
    lazy: async () => {
      const { PublicDiscovery } = await import(
        '@/features/customer/PublicDiscovery'
      )
      return { Component: () => <PublicDiscovery search /> }
    },
  },
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
    path: '/staff/establishments/:venueId',
    lazy: async () => ({
      Component: (await import('@/features/staff/StaffApp')).StaffApp,
    }),
  },
  {
    path: '/staff',
    lazy: async () => ({
      Component: (await import('@/features/staff/StaffApp')).StaffApp,
    }),
  },
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
    path: '/q/:queueId/kiosk',
    lazy: async () => ({
      Component: (await import('@/features/customer/PublicKiosk')).PublicKiosk,
    }),
  },
  {
    path: '/q/:queueId/qr',
    lazy: async () => ({
      Component: (await import('@/features/customer/PublicQueueQr'))
        .PublicQueueQr,
    }),
  },
  {
    path: '/t/:recoveryToken',
    lazy: async () => ({
      Component: (await import('@/features/customer/CustomerTurn'))
        .CustomerTurn,
    }),
  },
  {
    element: <WebShell />,
    children: [
      { path: '/q/demo-queue', element: <DemoQueue /> },
      { path: '/demo', element: <WebJoinQueueScreen /> },
      { path: '*', element: <WebJoinQueueScreen /> },
    ],
  },
]
