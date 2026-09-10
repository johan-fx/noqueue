import { WebJoinQueueScreen } from '@/features/join-queue/web/WebJoinQueueScreen'
import type { RouteObject } from 'react-router'
import { WebShell } from '../shells/WebShell'

export const webRoutes: RouteObject[] = [
  {
    element: <WebShell />,
    children: [{ path: '*', element: <WebJoinQueueScreen /> }],
  },
]
