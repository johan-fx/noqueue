import { useSyncExternalStore } from 'react'
import {
  applyPwaUpdate,
  dismissPwaUpdate,
  getPwaUpdateErrorMessage,
  getPwaUpdateState,
  retryPwaUpdateCheck,
  subscribePwaUpdateState,
} from './update-coordinator'

function currentLocale(): 'es' | 'en' {
  if (typeof window === 'undefined') return 'es'
  return new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'es'
}

export function PwaUpdateBanner() {
  const state = useSyncExternalStore(
    subscribePwaUpdateState,
    getPwaUpdateState,
    getPwaUpdateState,
  )
  const locale = currentLocale()

  if (state.dismissed || (!state.available && !state.errorCode)) return null

  const isEnglish = locale === 'en'
  const hasError = Boolean(state.errorCode)
  const message = state.errorCode
    ? getPwaUpdateErrorMessage(state.errorCode, locale)
    : state.applying
      ? (isEnglish ? 'Applying the update…' : 'Aplicando la actualización…')
      : state.checking
        ? (isEnglish ? 'Checking for an update…' : 'Comprobando la actualización…')
        : state.available
          ? (isEnglish ? 'A new version is ready.' : 'Hay una nueva versión disponible.')
          : (isEnglish ? 'Updates could not be checked.' : 'No se pudieron comprobar las actualizaciones.')

  return (
    <aside
      aria-live={hasError ? 'assertive' : 'polite'}
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-xl rounded-xl border bg-card p-4 text-card-foreground shadow-xl sm:inset-x-auto sm:right-6 sm:w-[min(32rem,calc(100vw-3rem))]"
      data-testid="pwa-update-banner"
      role={hasError ? 'alert' : 'status'}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {isEnglish ? 'No Queue update' : 'Actualización de No Queue'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {message}
          </p>
          {state.available && (
            <p className="mt-2 text-xs text-muted-foreground">
              {isEnglish
                ? 'This tab will reload. Finish or save your changes before updating.'
                : 'Esta pestaña se recargará. Termina o guarda tus cambios antes de actualizar.'}
            </p>
          )}
          {state.errorCode === 'multiple-tabs' && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="pwa-update-blocked">
              {isEnglish
                ? 'The update is waiting. Close the other No Queue tabs, then retry.'
                : 'La actualización está pendiente. Cierra las otras pestañas de No Queue y vuelve a intentarlo.'}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          data-testid="pwa-update-later"
          disabled={state.checking || state.applying}
          onClick={dismissPwaUpdate}
          type="button"
        >
          {isEnglish ? 'Later' : 'Más tarde'}
        </button>
        {state.available ? (
          <>
            <button
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              data-testid="pwa-update-apply"
              disabled={state.checking || state.applying}
              onClick={() => void applyPwaUpdate()}
              type="button"
            >
              {state.checking || state.applying
                ? (isEnglish ? 'Please wait…' : 'Un momento…')
                : state.errorCode
                  ? (isEnglish ? 'Retry update' : 'Reintentar actualización')
                  : (isEnglish ? 'Update now' : 'Actualizar ahora')}
            </button>
          </>
        ) : (
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            data-testid="pwa-update-retry"
            disabled={state.checking || state.applying}
            onClick={() => void retryPwaUpdateCheck()}
            type="button"
          >
            {state.checking
              ? (isEnglish ? 'Checking…' : 'Comprobando…')
              : (isEnglish ? 'Retry' : 'Reintentar')}
          </button>
        )}
      </div>
    </aside>
  )
}
