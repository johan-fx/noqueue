import { DemoQueue, DemoEntry } from '@/features/join-queue/web/DemoQueue'
import { WebJoinQueueScreen } from '@/features/join-queue/web/WebJoinQueueScreen'
import type { RouteObject } from 'react-router'
import { WebShell } from '../shells/WebShell'

export const webRoutes: RouteObject[] = [
  {
    element: <WebShell />,
    children: [
      { path: '/q/demo-queue', element: <DemoQueue /> },
      { path: '/t/:recoveryToken', element: <DemoEntry /> },
      { path: '*', element: <WebJoinQueueScreen /> },
    ],
  },
]
