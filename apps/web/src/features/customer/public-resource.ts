import { useNativeResourceSeed } from '@/platform/capacitor/native-route-data'
import { customerFetch } from '@/data/api/customer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { Locale } from './shared'

export function useLocale() {
  const [search, setSearch] = useSearchParams()
  const locale: Locale = search.get('lang') === 'en' ? 'en' : 'es'
  return [
    locale,
    (value: Locale) => {
      setSearch(
        (previous) => {
          previous.set('lang', value)
          return previous
        },
        { replace: true }
      )
    },
  ] as const
}
export function usePublicResource<T>(
  url: string | null,
  parse: (data: unknown) => T,
  polling = true,
  credentials: RequestCredentials = 'same-origin',
  accept?: (next: T, previous: T | null) => boolean
) {
  const [state, setState] = useState<{
    url: string
    data: T | null
    updatedAt: number
    error: boolean
  } | null>(null)
  const seed = useNativeResourceSeed(url)
  const seeded = seed ? { url: url!, data: seed.error ? null : seed.data as T, updatedAt: seed.updatedAt, error: seed.error } : null
  const current = state?.url === url && (!seeded || state.updatedAt >= seeded.updatedAt) ? state : seeded
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: Promise<void> | null = null
    let lastAccepted: T | null = seed && !seed.error ? seed.data as T : null
    const refresh = () => {
      if (pending) return pending
      clearTimeout(timer)
      pending = (async () => {
        try {
          const response = await customerFetch(url, {
            signal: controller.signal,
            cache: 'no-store',
            credentials,
          })
          if (!response.ok) throw new Error('unavailable')
          const data = parse(await response.json())
          if (accept && !accept(data, lastAccepted)) throw new Error('stale')
          if (!controller.signal.aborted) {
            lastAccepted = data
            setState({ url, data, updatedAt: Date.now(), error: false })
          }
        } catch {
          if (!controller.signal.aborted) setState(previous => ({ url, data: previous?.url === url ? previous.data : lastAccepted, updatedAt: Date.now(), error: true }))
        } finally {
          pending = null
          if (
            polling &&
            !controller.signal.aborted &&
            document.visibilityState === 'visible'
          )
            timer = setTimeout(refresh, 5000)
        }
      })()
      return pending
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
      else clearTimeout(timer)
    }
    refreshRef.current = refresh
    if (!seed) void refresh()
    else if (polling && document.visibilityState === 'visible') timer = setTimeout(refresh, 5000)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    window.addEventListener('noqueue:push-refresh', visible)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', visible)
      window.removeEventListener('noqueue:push-refresh', visible)
    }
  }, [url, parse, polling, credentials, accept, seed])
  const refreshResource = useCallback(() => refreshRef.current(), [])
  return {
    data: current?.data ?? null,
    updatedAt: current?.updatedAt ?? null,
    error: current?.error ?? false,
    refresh: refreshResource,
  }
}
