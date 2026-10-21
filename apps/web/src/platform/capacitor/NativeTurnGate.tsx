import { App } from '@capacitor/app'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { z } from 'zod'
import { customerFetch } from '@/data/api/customer'
import { CustomerShell, LoadError } from '@/features/customer/shared'
import { useLocale } from '@/features/customer/public-resource'
import { mobileActiveEntrySchema } from '@noqueue/contracts/queue'

const schema = z.object({ entries: z.array(mobileActiveEntrySchema).max(1) })
type Active = z.infer<typeof mobileActiveEntrySchema>

/** Native routing policy; no alternative visual shell and no dependency on push. */
export function NativeTurnGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [locale, setLocale] = useLocale()
  const [state, setState] = useState<{ path: string; entry: Active | null; error: boolean } | null>(null)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const current = useRef(state)
  useEffect(() => { current.current = state }, [state])
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const check = async () => {
      try {
        const response = await customerFetch('/api/v1/public/entries', { signal: controller.signal })
        if (!response.ok) throw new Error('recovery_unavailable')
        const data = schema.parse(await response.json())
        if (live) setState({ path: location.pathname, entry: data.entries[0] ?? null, error: false })
      } catch {
        if (live) setState(previous => ({ path: location.pathname, entry: previous?.entry ?? null, error: true }))
      } finally {
        if (live && document.visibilityState !== 'hidden') timer = setTimeout(check, 5000)
      }
    }
    void check()
    return () => { live = false; controller.abort(); clearTimeout(timer) }
  }, [location.pathname, revision])
  useEffect(() => {
    const handles: { remove(): Promise<void> }[] = []
    let disposed = false
    const listen = async (promise: Promise<{ remove(): Promise<void> }>) => {
      try { const handle = await promise; if (disposed) await handle.remove(); else handles.push(handle) } catch { /* Browser tests do not have a native bridge. */ }
    }
    const visible = () => { if (document.visibilityState !== 'hidden') refresh() }
    window.addEventListener('noqueue:turn-changed', refresh)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    void listen(App.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh() }))
    void listen(App.addListener('backButton', ({ canGoBack }) => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      if (current.current?.entry || !canGoBack) void App.minimizeApp()
      else window.history.back()
    }))
    return () => {
      disposed = true
      handles.forEach(handle => { void handle.remove() })
      window.removeEventListener('noqueue:turn-changed', refresh)
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])
  const turnPath = state?.entry ? `/t/${state.entry.recoveryToken}` : null
  const checked = state?.path === location.pathname
  // A retained, already verified turn may stay visible offline; never unlock a form.
  if (checked && state?.error && turnPath === location.pathname) return children
  if (!checked || state?.error) return <CustomerShell title="No Queue" locale={locale} setLocale={setLocale}>
    {checked && state?.error ? <LoadError locale={locale} retry={refresh} /> : <p className="p-4" role="status">{locale === 'es' ? 'Cargando…' : 'Loading…'}</p>}
  </CustomerShell>
  if (turnPath && location.pathname !== turnPath)
    return <Navigate replace to={`${turnPath}?lang=${locale}`} />
  return children
}
