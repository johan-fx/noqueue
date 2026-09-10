import { NativeJoinQueueScreen } from '@/features/join-queue/native/NativeJoinQueueScreen'
import type { RouteObject } from 'react-router'
import { NativeShell } from '../shells/NativeShell'

export const nativeRoutes: RouteObject[] = [
  {
    element: <NativeShell />,
    children: [{ path: '*', element: <NativeJoinQueueScreen /> }],
  },
]
