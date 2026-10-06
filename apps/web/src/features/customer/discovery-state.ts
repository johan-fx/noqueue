import { useSyncExternalStore } from 'react'
import type { PublicSearchInput } from '@noqueue/contracts/discovery'
const recentKey = 'noqueue.recent-services'
let coordinates: PublicSearchInput['coordinates']
const listeners = new Set<() => void>()
export function setDiscoveryCoordinates(
  value: PublicSearchInput['coordinates'],
) {
  coordinates = value
  for (const listener of listeners) listener()
}
export function useDiscoveryCoordinates() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => coordinates,
    () => undefined,
  )
}
export function recentServiceIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]')
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (id): id is string =>
                typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id),
            ),
          ),
        ].slice(0, 3)
      : []
  } catch {
    return []
  }
}
export function visitService(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return
  try {
    localStorage.setItem(
      recentKey,
      JSON.stringify(
        [id, ...recentServiceIds().filter((value) => value !== id)].slice(0, 3),
      ),
    )
  } catch {
    /* Discovery works when browser storage is unavailable. */
  }
}
export function qrDestination(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin)
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !/^\/(q|v)\/[a-zA-Z0-9_-]{1,100}$/.test(url.pathname)
    )
      return null
    return url.pathname
  } catch {
    return null
  }
}
export const discoveryScroll = new Map<string, number>()
