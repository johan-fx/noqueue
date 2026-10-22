import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createNativePush, initialPushState } from './push-registration'
import { detectRuntime } from '@/app/bootstrap/runtime'
import { useAppNavigate } from '@/app/navigation/native-transitions'
import { Button } from '@/components/ui/button'
import bellRing from '@/assets/notifications/bell-ring.svg'
import { NativePushNotice } from './NativePushNotice'

import { NativePushContext as Context } from './native-push-context'

type Controller = ReturnType<typeof createNativePush>

export function NativePushProvider({ children, hasActiveTurn = false }: { children: ReactNode; hasActiveTurn?: boolean }) {
  const navigate = useAppNavigate()
  const [state, setState] = useState(initialPushState)
  const controller = useRef<Controller | null>(null)
  const activeTurn = useRef(hasActiveTurn)
  useLayoutEffect(() => { activeTurn.current = hasActiveTurn }, [hasActiveTurn])
  useEffect(() => {
    if (detectRuntime() !== 'native' || import.meta.env.VITE_MOBILE_PUSH_ENABLED !== 'true') return
    const instance = createNativePush({
      locale: () => new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es',
      hasActiveTurn: () => activeTurn.current,
      status: setState, navigate: path => navigate(path, { intent: 'replace' }),
      refresh: () => window.dispatchEvent(new Event('noqueue:push-refresh')),
    })
    controller.current = instance
    void instance.start()
    return () => { controller.current = null; void instance.dispose() }
  }, [navigate])
  useEffect(() => { void controller.current?.reconcile() }, [hasActiveTurn])
  const requestAfterJoin = useCallback((key: string) => { void controller.current?.requestAfterJoin(key) }, [])
  return <Context.Provider value={{ state, enabled: detectRuntime() === 'native' && import.meta.env.VITE_MOBILE_PUSH_ENABLED === 'true', enable: () => { void controller.current?.enable() }, requestAfterJoin }}>{children}</Context.Provider>
}

/** Only active turns may offer activation; no app-side opt-out. */
export function NativePushControls({ locale, hasTurn = true }: { locale: 'es' | 'en'; hasTurn?: boolean }) {
  const context = useContext(Context)
  if (!context?.enabled || !hasTurn) return null
  const { state, enable } = context, es = locale === 'es'
  if (state.registration === 'unavailable' || state.registration === 'checking') return null
  if (state.permission === 'granted' || state.permission === 'unknown') {
    if (state.registration !== 'error') return null
    return <div className="px-4 pb-3 text-sm text-gray-500">
      <p role="status">{es ? 'No se pudieron activar las notificaciones. Puedes reintentar sin cambiar tu turno.' : 'Notifications could not be enabled. You can retry without changing your turn.'}</p>
      <Button className="mt-2 min-h-11" onClick={enable}>{es ? 'Reintentar' : 'Retry'}</Button>
    </div>
  }
  return <div className="px-4 pb-3">
    <NativePushNotice locale={locale} busy={state.registration === 'busy'} onActivate={enable} icon={bellRing} />
    {state.settingsError && <p role="status" className="mt-2 text-sm text-gray-500">
      {es ? 'Abre Ajustes del dispositivo → No Queue → Notificaciones para activarlas.' : 'Open device Settings → No Queue → Notifications to enable them.'}
    </p>}
    {state.registration === 'error' && <p role="status" className="mt-2 text-sm text-gray-500">
      {es ? 'No se pudo completar la activación. Puedes volver a intentarlo.' : 'Activation could not be completed. You can try again.'}
    </p>}
  </div>
}
