import * as CookieConsent from 'vanilla-cookieconsent'
import type { CookieConsentConfig } from 'vanilla-cookieconsent'
import { CONSENT_DAYS, PRIVACY_REVISION, privacyOrigins } from '@noqueue/contracts/privacy-policy'
import { CMP_KEY, STATE_KEY, PrivacyController } from './controller'
import { googleTransport } from './google'
import { safePage, type PrivacyConfig } from './policy'
export { crossesPrivacyBoundary } from './policy'
export { legalCopy } from './legal'
export type { PrivacyConfig } from './policy'

export type PrivacyHandle = {
  refresh: () => void
  suspend: () => void
  resume: () => void
  show: () => void
  setLanguage: (locale: 'es' | 'en') => void
  destroy: () => void
}
const noop: PrivacyHandle = { refresh() {}, suspend() {}, resume() {}, show() {}, setLanguage() {}, destroy() {} }
export function startPrivacy(config: PrivacyConfig, locale: 'es' | 'en' = 'es'): PrivacyHandle {
  if (config.native) return noop
  let language = locale, destroyed = false, syncing = false, ready = false, suspended = false
  let storageAvailable = false
  try {
    localStorage.setItem('noqueue.privacy.probe', '1')
    localStorage.removeItem('noqueue.privacy.probe')
    storageAvailable = true
  } catch { /* Fail closed even when existing preferences remain readable. */ }
  const controller = new PrivacyController(config, {
    storage: {
      getItem: (key) => storageAvailable ? localStorage.getItem(key) : null,
      setItem: (key, value) => { if (!storageAvailable) throw new Error('Storage unavailable'); localStorage.setItem(key, value) },
    },
    location: () => window.location, now: Date.now, uuid: () => crypto.randomUUID(), analytics: googleTransport(),
    receipt: async (body) => {
      const response = await fetch(`${privacyOrigins[1]}/api/v1/privacy/consents`, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      return response.status === 204
    },
  })
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const schedule = () => {
    if (destroyed) return
    const state = controller.state
    if (controller.eligible && state && !state.acknowledged && state.attempts < 3) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (controller.state?.decisionId === state.decisionId) attempt()
      }, state.attempts === 1 ? 5000 : 30000)
      timers.add(timer)
    }
  }
  const attempt = () => { void controller.retry().then(schedule) }
  const choose = () => {
    if (syncing || destroyed || !ready) return
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    void controller.choose(CookieConsent.acceptedCategory('analytics'), language).then(schedule)
  }
  const translations = (en: boolean) => ({
    consentModal: {
      title: en ? 'Optional analytics' : 'Analítica opcional',
      description: en ? 'May we use Google Analytics to count public page visits? Queue tickets, searches and personal form data are excluded. You can use NoQueue without accepting.' : '¿Podemos usar Google Analytics para medir visitas públicas? Excluimos turnos, búsquedas y datos personales de formularios. Puedes usar NoQueue sin aceptar.',
      acceptAllBtn: en ? 'Accept analytics' : 'Aceptar analítica',
      acceptNecessaryBtn: en ? 'Reject' : 'Rechazar',
      showPreferencesBtn: en ? 'Configure' : 'Configurar',
      footer: `<a href="/privacy/?lang=${en ? 'en' : 'es'}">${en ? 'Privacy and storage' : 'Privacidad y almacenamiento'}</a>`,
    },
    preferencesModal: {
      title: en ? 'Privacy and analytics' : 'Privacidad y analítica',
      acceptAllBtn: en ? 'Accept analytics' : 'Aceptar analítica',
      acceptNecessaryBtn: en ? 'Reject' : 'Rechazar',
      savePreferencesBtn: en ? 'Save preferences' : 'Guardar preferencias',
      closeIconLabel: en ? 'Close' : 'Cerrar',
      sections: [
        { title: en ? 'Necessary' : 'Necesarias', description: en ? 'Storage for the service, security and remembering this choice.' : 'Almacenamiento para el servicio, la seguridad y recordar esta elección.', linkedCategory: 'necessary' },
        { title: 'Google Analytics', description: controller.eligible
          ? (en ? 'Optional public visit statistics. No ads. Google loads only after acceptance is recorded. If recording fails, analytics stays off.' : 'Estadísticas opcionales de visitas públicas. Sin publicidad. Google solo se carga tras registrar la aceptación. Si falla el registro, la analítica sigue apagada.')
          : (en ? 'Analytics is disabled in this environment. No data is sent to Google.' : 'La analítica está desactivada en este entorno. No se envían datos a Google.'), linkedCategory: 'analytics' },
        { description: `<a href="/privacy/?lang=${en ? 'en' : 'es'}">${en ? 'Read privacy and storage information' : 'Leer información de privacidad y almacenamiento'}</a>` },
      ],
    },
  })
  const options: CookieConsentConfig = {
    mode: 'opt-in', revision: PRIVACY_REVISION, autoShow: false, hideFromBots: false,
    disablePageInteraction: false, manageScriptTags: false, autoClearCookies: false,
    cookie: { name: CMP_KEY, useLocalStorage: true, expiresAfterDays: CONSENT_DAYS },
    categories: { necessary: { enabled: true, readOnly: true }, analytics: { enabled: false } },
    guiOptions: { consentModal: { layout: 'box inline', position: 'bottom right', equalWeightButtons: true }, preferencesModal: { layout: 'box', equalWeightButtons: true } },
    language: { default: language, translations: { es: translations(false), en: translations(true) } },
    onFirstConsent: choose, onChange: choose,
  }
  const syncUi = () => {
    syncing = true
    const state = controller.state
    // Only update a valid existing choice. Do not manufacture first consent on page load.
    if (state) CookieConsent.acceptCategory(state.analytics ? ['necessary', 'analytics'] : ['necessary'])
    syncing = false
  }
  let hadState = Boolean(controller.state)
  const initialize = async () => {
    ready = false
    if (!controller.state) {
      try { localStorage.removeItem(CMP_KEY) } catch { /* Optional UI storage. */ }
    }
    try {
      await CookieConsent.run(options)
      if (destroyed) return
      ready = true
      syncUi()
      if (!suspended) controller.resume()
      refresh()
      attempt()
    } catch { controller.suspend() }
  }
  const refresh = () => {
    if (!ready || destroyed) return
    controller.refresh()
    const hasState = Boolean(controller.state)
    if (hadState && !hasState) {
      hadState = false
      CookieConsent.reset(false)
      void initialize()
      return
    }
    hadState = hasState
    if (controller.eligible && !hasState && safePage(config.surface, location.pathname)) CookieConsent.show(true)
  }
  void initialize()
  const storage = (event: StorageEvent) => {
    if (event.key === STATE_KEY || event.key === null) { refresh(); syncUi() }
  }
  const pagehide = () => controller.suspend()
  const pageshow = (event: PageTransitionEvent) => { if (ready && !suspended) controller.resume(event.persisted); refresh() }
  const visible = () => { if (document.visibilityState === 'visible') refresh() }
  window.addEventListener('storage', storage)
  window.addEventListener('pagehide', pagehide)
  window.addEventListener('pageshow', pageshow)
  document.addEventListener('visibilitychange', visible)
  // Also expires consent in long-lived visible tabs; no server request is made here.
  const interval = setInterval(refresh, 1000)
  return {
    refresh, suspend: () => { suspended = true; controller.suspend() }, resume: () => { suspended = false; if (ready) controller.resume() },
    show: () => { syncUi(); CookieConsent.showPreferences() },
    setLanguage: (value) => { language = value; void CookieConsent.setLanguage(value) },
    destroy: () => {
      destroyed = true; controller.suspend(); clearInterval(interval)
      for (const timer of timers) clearTimeout(timer)
      window.removeEventListener('storage', storage); window.removeEventListener('pagehide', pagehide)
      window.removeEventListener('pageshow', pageshow); document.removeEventListener('visibilitychange', visible)
      CookieConsent.reset(false)
    },
  }
}
