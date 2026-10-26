import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Spinner } from '@/components/ui/spinner'
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useRouteError } from 'react-router'
import { detectRuntime } from '../bootstrap/runtime'
import { finishNativeStartup } from '../bootstrap/native-splash'
import {
  getPwaUpdateErrorMessage,
  requestAppReload,
} from '../pwa/update-coordinator'
import { isModuleLoadError } from './module-load-error'

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

const copy = {
  es: {
    title: 'No se ha podido cargar esta pantalla',
    module: 'Puede haber una nueva versión de No Queue o un problema de conexión.',
    generic: 'Se ha producido un error inesperado. Puedes intentar cargar la pantalla de nuevo.',
    offline: 'No tienes conexión. Conéctate a internet y vuelve a intentarlo.',
    preserve: 'Se volverá a abrir este mismo enlace sin borrar los datos guardados en este dispositivo.',
    reload: 'Volver a cargar',
    loading: 'Preparando la recarga…',
  },
  en: {
    title: 'This screen could not be loaded',
    module: 'There may be a new version of No Queue or a connection problem.',
    generic: 'An unexpected error occurred. You can try loading the screen again.',
    offline: 'You are offline. Connect to the internet and try again.',
    preserve: 'The same link will reopen without deleting data saved on this device.',
    reload: 'Reload',
    loading: 'Preparing to reload…',
  },
}

/** Eagerly bundled: recovery cannot depend on the route chunk that failed to load. */
export function RouteErrorBoundary() {
  useLayoutEffect(() => { finishNativeStartup() }, [])
  const error = useRouteError()
  const { search } = useLocation()
  const locale = new URLSearchParams(search).get('lang') === 'en' ? 'en' : 'es'
  const text = copy[locale]
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  // Capacitor's route modules are packaged locally; an offline native shell
  // can still reload them without registering a web service worker.
  const canReload = online || detectRuntime() === 'native'
  const requested = useRef(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string>()

  const reload = async () => {
    if (requested.current || !canReload) return
    requested.current = true
    setPending(true)
    setFailure(undefined)
    try {
      // One reload owner: it waits for a compatible worker, keeps this URL and
      // never clears local storage, cookies, or recovery tokens. No auto retry.
      await requestAppReload()
    } catch (reason) {
      setFailure(getPwaUpdateErrorMessage(reason, locale))
      requested.current = false
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 bg-background p-6 text-foreground" lang={locale}>
      <p className="text-sm font-semibold">No Queue</p>
      <h1 className="text-2xl font-semibold">{text.title}</h1>
      <p>{isModuleLoadError(error) ? text.module : text.generic}</p>
      <p className="text-sm text-muted-foreground">{text.preserve}</p>
      {!canReload && <p role="alert">{text.offline}</p>}
      {failure && canReload && <p role="alert">{failure}</p>}
      <button
        type="button"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={pending || !canReload}
        aria-busy={pending || undefined}
        onClick={() => void reload()}
      >
        {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
        {pending ? text.loading : text.reload}
      </button>
      {pending && <p role="status">{text.loading}</p>}
    </main>
  )
}

export function RouteLoadingScreen() {
  const en = new URLSearchParams(window.location.search).get('lang') === 'en'
  if (detectRuntime() === 'native') return <LoadingSpinner fullScreen locale={en ? 'en' : 'es'} />
  return <p className="p-6" role="status">{en ? 'Loading…' : 'Cargando…'}</p>
}
