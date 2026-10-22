import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { NativePushProvider } from '@/platform/capacitor/NativePush'
import { NativeTurnGate } from '@/platform/capacitor/NativeTurnGate'
import { NativeResourceContext } from '@/platform/capacitor/native-route-data'
import type { NativeOwnershipCoordinator } from '@/platform/capacitor/native-ownership'
import type { NativeRouteData } from '@/platform/capacitor/native-route-loader'
import { Outlet, useLoaderData, useLocation, useNavigation, useNavigationType, useRevalidator } from 'react-router'

export function NativeShell({ coordinator }: { coordinator: NativeOwnershipCoordinator }) {
  const data = useLoaderData<NativeRouteData>()
  const ownership = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot)
  const location = useLocation(), navigation = useNavigation(), revalidator = useRevalidator()
  const action = useNavigationType()
  const lastPath = useRef<string | null>(null)
  const positions = useRef(new Map<string, number>())
  const busy = (navigation.state !== 'idle' && navigation.location?.pathname !== location.pathname) || revalidator.state !== 'idle'
  const [waitingFor, setWaitingFor] = useState<string | null>(null)
  const pendingKey = navigation.location?.key ?? 'retry'
  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(() => setWaitingFor(pendingKey), 150)
    return () => { clearTimeout(timer); setWaitingFor(null) }
  }, [busy, pendingKey])
  useLayoutEffect(() => {
    // Search restores its result-list position synchronously from its native seed.
    const path = location.pathname
    const returning = action === 'POP' || document.documentElement.dataset.noqueueTransitionIntent === 'back'
    if (lastPath.current !== path && path !== '/search') window.scrollTo({ top: returning ? positions.current.get(path) ?? 0 : 0, left: 0, behavior: 'instant' })
    lastPath.current = path
    const save = () => positions.current.set(path, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => { save(); window.removeEventListener('scroll', save) }
  }, [location.pathname, action])
  return <NativePushProvider hasActiveTurn={!!ownership.entry}>
    <NativeResourceContext.Provider value={data.seed}>
      <div aria-busy={busy} inert={busy || undefined} className="bg-background pt-[env(safe-area-inset-top,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] text-foreground [&_main]:min-h-[calc(100dvh-env(safe-area-inset-top))]">
        <NativeTurnGate coordinator={coordinator} data={data}><Outlet /></NativeTurnGate>
      </div>
      {busy && waitingFor === pendingKey && <LoadingSpinner
        locale={new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es'}
        style={{ viewTransitionName: 'noqueue-loading' }}
        className="fixed inset-x-0 top-[env(safe-area-inset-top,0px)] z-50 bg-background/95 p-2"
      />}
    </NativeResourceContext.Provider>
  </NativePushProvider>
}
