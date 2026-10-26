import { SplashScreen } from '@capacitor/splash-screen'
import { detectRuntime } from './runtime'

const RECOVERY_ID = 'noqueue-startup-recovery'
let started = false
let ready = false
let hidden: Promise<void> | undefined
let watchdog: ReturnType<typeof setTimeout> | undefined

function hide() {
  // StrictMode, route recovery and subsequent navigation share one dismissal.
  hidden ??= SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {
    // Old native shells/dev browsers may not have this plugin. Never prevent
    // turn recovery because a cosmetic native bridge operation is unavailable.
    hidden = undefined
  })
  return hidden
}

/** Emergency recovery only, never a minimum splash duration. */
export function startNativeSplashRecovery() {
  if (detectRuntime() !== 'native' || started || ready) return
  started = true
  watchdog = setTimeout(() => {
    if (ready) return
    // The route loader normally settles (including offline) within 15s.
    // This independent fallback also handles a stuck lazy route/React mount.
    const en = new URLSearchParams(location.search).get('lang') === 'en'
    const panel = document.createElement('main')
    panel.id = RECOVERY_ID
    panel.lang = en ? 'en' : 'es'
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;justify-content:center;gap:24px;padding:32px;background:#E1E1E0;color:#1F2937'
    const heading = document.createElement('h1')
    heading.textContent = en ? 'No Queue could not start' : 'No se ha podido iniciar No Queue'
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText = 'min-height:44px;padding:12px;border:1px solid currentColor;border-radius:8px'
    button.textContent = en ? 'Try again' : 'Volver a intentar'
    button.onclick = () => location.reload() // Same URL, no data clearing or automatic loop.
    panel.append(heading, button)
    document.body.append(panel)
    const root = document.getElementById('root')
    if (root) root.inert = true
    void hide()
  }, 20000)
}

/** Called only after a usable route (or its recoverable error) commits. */
export function finishNativeStartup() {
  if (detectRuntime() !== 'native') return
  ready = true
  clearTimeout(watchdog)
  document.getElementById(RECOVERY_ID)?.remove()
  const root = document.getElementById('root')
  if (root) root.inert = false
  // Do not await requestAnimationFrame: Android's retained system splash
  // suppresses native pre-draw until hide releases it. React has committed.
  void hide()
}
