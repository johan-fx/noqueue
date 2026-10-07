import { useEffect, useRef, useState } from 'react'
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
        { replace: true },
      )
    },
  ] as const
}
export function usePublicResource<T>(
  url: string | null,
  parse: (data: unknown) => T,
  polling = true,
) {
  const [state, setState] = useState<{
    url: string
    data: T
    updatedAt: number
  } | null>(null)
  const [error, setError] = useState(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: Promise<void> | null = null
    const refresh = () => {
      if (pending) return pending
      clearTimeout(timer)
      pending = (async () => {
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            cache: 'no-store',
          })
          if (!response.ok) throw new Error('unavailable')
          const data = parse(await response.json())
          if (!controller.signal.aborted) {
            setState({ url, data, updatedAt: Date.now() })
            setError(false)
          }
        } catch {
          if (!controller.signal.aborted) setError(true)
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
    void refresh()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', visible)
    }
  }, [url, parse, polling])
  return {
    data: state?.url === url ? state.data : null,
    updatedAt: state?.url === url ? state.updatedAt : null,
    error,
    refresh: () => refreshRef.current(),
  }
}
