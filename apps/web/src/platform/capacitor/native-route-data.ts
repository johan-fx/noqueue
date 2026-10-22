import { createContext, useContext } from 'react'

/** Ephemeral native preload. Never persisted in history, storage or diagnostics. */
export type NativeResourceSeed = {
  key: string
  data: unknown
  error: boolean
  updatedAt: number
}

export const NativeResourceContext = createContext<NativeResourceSeed | null>(null)

export function useNativeResourceSeed(key: string | null) {
  const seed = useContext(NativeResourceContext)
  return seed?.key === key ? seed : null
}
