import { createContext, useContext } from 'react'
import type { PushState } from './push-registration'

export const NativePushContext = createContext<{
  state: PushState
  enabled: boolean
  enable: () => void
  requestAfterJoin: (key: string) => void
} | null>(null)

const ignoreJoin: (key: string) => void = () => undefined
/** No-op outside the native provider. Call only after a confirmed successful admission. */
export function usePushAfterJoin() {
  return useContext(NativePushContext)?.requestAfterJoin ?? ignoreJoin
}
