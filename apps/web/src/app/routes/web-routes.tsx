import { DemoQueue } from '@/features/join-queue/web/DemoQueue'
import { WebJoinQueueScreen } from '@/features/join-queue/web/WebJoinQueueScreen'
import { redirect, type RouteObject } from 'react-router'
import { WebShell } from '../shells/WebShell'

export const webRoutes: RouteObject[] = [
  { path: '/privacy', lazy: async () => ({ Component: (await import('@/features/privacy/PrivacyPage')).PrivacyPage }) },
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
