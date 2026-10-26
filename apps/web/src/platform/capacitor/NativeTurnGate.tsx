import { LoadingSpinner } from '@/components/LoadingSpinner'
import { App } from '@capacitor/app'
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation, useNavigation, useRevalidator } from 'react-router'
import { CustomerShell, LoadError } from '@/features/customer/shared'
import { useLocale } from '@/features/customer/public-resource'
import { useAppNavigate } from '@/app/navigation/native-transitions'
import { finishNativeStartup } from '@/app/bootstrap/native-splash'
import type { NativeOwnershipCoordinator } from './native-ownership'
import type { NativeRouteData } from './native-route-loader'

/** The loader authorizes navigation; this monitor only refreshes ownership/lifecycle. */
export function NativeTurnGate({ children, coordinator, data }: {
  children: ReactNode; coordinator: NativeOwnershipCoordinator; data: NativeRouteData
}) {
  const location = useLocation(), navigation = useNavigation(), navigate = useAppNavigate()
  const revalidator = useRevalidator()
  const [locale, setLocale] = useLocale()
  const ownership = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot)
  const turnPath = ownership.entry ? `/t/${ownership.entry.recoveryToken}` : null
  const mismatch = !!turnPath && turnPath !== location.pathname
  const preparing = navigation.state !== 'idle' || coordinator.preparing
  const retained = coordinator.retained(location.pathname)
  const blocked = !data.allowed || (!preparing && ownership.error && !retained)

  useLayoutEffect(() => {
    // An ownership error is a usable retry screen; a redirect/mismatched turn
    // is not. Initial loader seeds are committed with the child route here.
    if (blocked || (!preparing && !mismatch)) finishNativeStartup()
  }, [blocked, preparing, mismatch])

  useLayoutEffect(() => {
    if (data.allowed && !mismatch && !ownership.error) coordinator.commit(location.pathname, data.seed)
  }, [coordinator, data, location.pathname, mismatch, ownership.error])

  useEffect(() => {
    if (!preparing && !ownership.error && mismatch)
      void navigate(`${turnPath}?lang=${locale}`, { replace: true, intent: 'replace' })
  }, [preparing, ownership.error, mismatch, navigate, turnPath, locale])

  useEffect(() => {
    const lifetime = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const handles: { remove(): Promise<void> }[] = []
    const schedule = () => {
      clearTimeout(timer)
      if (!lifetime.signal.aborted && document.visibilityState !== 'hidden') timer = setTimeout(() => void check(), 5000)
    }
    const check = async () => {
      clearTimeout(timer)
      try { if (!coordinator.preparing) await coordinator.check(lifetime.signal) }
      catch { /* Cancelled by a newer navigation or lifecycle event. */ }
      finally { schedule() }
    }
    const refresh = () => {
      coordinator.invalidate()
      void check()
    }
    const visible = () => {
      if (document.visibilityState !== 'hidden') refresh()
      else clearTimeout(timer)
    }
    const listen = async (promise: Promise<{ remove(): Promise<void> }>) => {
      try {
        const handle = await promise
        if (lifetime.signal.aborted) await handle.remove()
        else handles.push(handle)
      } catch { /* No native bridge in unit tests. */ }
    }
    // Initial ownership is already loaded. Do not duplicate it on mount.
    schedule()
    window.addEventListener('noqueue:turn-changed', refresh)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    void listen(App.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh() }))
    void listen(App.addListener('backButton', () => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      if (coordinator.getSnapshot().entry || location.pathname === '/') void App.minimizeApp()
      else void navigate(`/?lang=${locale}`, { replace: true, intent: 'back' })
    }))
    return () => {
      lifetime.abort(); clearTimeout(timer)
      handles.forEach(handle => { void handle.remove() })
      window.removeEventListener('noqueue:turn-changed', refresh)
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [coordinator, locale, navigate, location.pathname])

  const retry = useCallback(() => {
    coordinator.invalidate()
    void revalidator.revalidate()
  }, [coordinator, revalidator])
  if (blocked) return <CustomerShell title="No Queue" locale={locale} setLocale={setLocale}>
    <LoadError locale={locale} retry={retry} />
  </CustomerShell>
  // Public screens remain visible but inert while the authorized turn is prepared.
  // Never retain a different private ticket after its ownership is revoked.
  if (mismatch && location.pathname.startsWith('/t/')) return <CustomerShell title="No Queue" locale={locale} setLocale={setLocale}>
    <LoadingSpinner locale={locale} className="flex-1" />
  </CustomerShell>
  return <div inert={mismatch || undefined}>{children}</div>
}
