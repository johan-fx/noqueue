import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

export type Locale = 'es' | 'en'
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
export function CustomerShell({
  title,
  back,
  locale,
  setLocale,
  children,
}: {
  title: string
  back?: string | undefined
  locale: Locale
  setLocale: (locale: Locale) => void
  children: ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-background text-gray-700 sm:border-x">
      <header className="flex h-11 shrink-0 items-center justify-between px-4">
        {back ? (
          <Link
            className="flex h-11 w-13 items-center"
            to={back}
            aria-label={locale === 'es' ? 'Volver' : 'Back'}
          >
            <ChevronLeft className="size-6" />
          </Link>
        ) : null}
        <p className="font-semibold">{title}</p>
        <Select
          value={locale}
          items={[
            { value: 'es', label: 'ES' },
            { value: 'en', label: 'EN' },
          ]}
          onValueChange={(value) => {
            if (value === 'es' || value === 'en') setLocale(value)
          }}
        >
          <SelectTrigger
            aria-label={locale === 'es' ? 'Idioma' : 'Language'}
            className="h-11 w-auto gap-2 rounded-none border-0 bg-transparent p-0 text-base font-normal shadow-none [&_svg]:size-5"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="end"
            alignItemWithTrigger={false}
            className="min-w-20"
          >
            <SelectItem value="es">ES</SelectItem>
            <SelectItem value="en">EN</SelectItem>
          </SelectContent>
        </Select>
      </header>
      {children}
    </main>
  )
}
export function CustomerFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="sticky bottom-0 mt-auto flex gap-2 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>button]:h-12 [&>button]:flex-1 [&>button]:text-sm! [&>a]:h-12 [&>a]:flex-1 [&>a]:text-sm!">
      {children}
    </footer>
  )
}
export function usePublicResource<T>(
  url: string,
  parse: (data: unknown) => T,
  polling = false,
) {
  const [state, setState] = useState<{
    url: string
    data: T
    updatedAt: number
  } | null>(null)
  const [error, setError] = useState(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
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
          if (polling && !controller.signal.aborted)
            timer = setTimeout(refresh, 3000)
        }
      })()
      return pending
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
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
export function LoadError({
  locale,
  retry,
}: {
  locale: Locale
  retry: () => void
}) {
  return (
    <div className="m-4 space-y-3">
      <p role="alert">
        {locale === 'es'
          ? 'No se pueden actualizar los datos. Volveremos a intentarlo.'
          : 'Cannot refresh the information. We will try again.'}
      </p>
      <Button variant="outline" onClick={retry}>
        {locale === 'es' ? 'Reintentar' : 'Retry'}
      </Button>
    </div>
  )
}
