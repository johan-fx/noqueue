import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { createNativePush, type PushState } from './push-registration'
import { detectRuntime } from '@/app/bootstrap/runtime'

type Controller = ReturnType<typeof createNativePush>
const Context = createContext<{ state: PushState; enabled: boolean; enable: () => void; disable: () => void } | null>(null)
export function NativePushProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [state, setState] = useState<PushState>('off')
  const controller = useRef<Controller | null>(null)
  useEffect(() => {
    if (detectRuntime() !== 'native' || import.meta.env.VITE_MOBILE_PUSH_ENABLED !== 'true') return
    const instance = createNativePush({
      locale: () => new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es',
      status: setState, navigate,
      refresh: () => window.dispatchEvent(new Event('noqueue:push-refresh')),
    })
    controller.current = instance
    void instance.start()
    return () => { controller.current = null; void instance.dispose() }
  }, [navigate])
  return <Context.Provider value={{ state, enabled: detectRuntime() === 'native' && import.meta.env.VITE_MOBILE_PUSH_ENABLED === 'true', enable: () => { void controller.current?.enable() }, disable: () => { void controller.current?.disable() } }}>{children}</Context.Provider>
}
/** Used only alongside an admitted/active turn; null in the browser and disabled builds. */
export function NativePushControls({ locale, hasTurn = true }: { locale: 'es' | 'en'; hasTurn?: boolean }) {
  const context = useContext(Context)
  if (!context?.enabled) return null
  if (!hasTurn && ['off', 'busy'].includes(context.state)) return null
  const { state, enable, disable } = context, es = locale === 'es'
  return <div className="px-4 pb-3 text-sm text-gray-500">
    {state === 'enabled'
      ? <button className="underline" onClick={disable}>{es ? 'Desactivar avisos' : 'Disable notifications'}</button>
      : <button className="underline" disabled={state === 'busy' || state === 'unavailable'} onClick={enable}>{es ? 'Activar avisos' : 'Enable notifications'}</button>}
    {['denied', 'error', 'unavailable'].includes(state) && <p role="status" className="mt-1">
      {state === 'denied' ? es ? 'Puedes permitir los avisos en los ajustes del dispositivo.' : 'You can allow notifications in device settings.'
        : state === 'unavailable' ? es ? 'Avisos no disponibles en este entorno.' : 'Notifications are unavailable in this environment.'
        : es ? 'No se pudieron activar. Puedes reintentar.' : 'Could not enable notifications. You can retry.'}
    </p>}
  </div>
}
