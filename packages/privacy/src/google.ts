import type { AnalyticsTransport } from './controller'

type TagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
type Page = { location: string; title: string }
/** No script, preload, consent ping or DNS hint is created until start(). */
export function googleTransport(win: Window = window): AnalyticsTransport {
  const w = win as TagWindow
  let id = '', allowed = false, configured = false, loaded = false, script: HTMLScriptElement | null = null
  let current: Page | null = null, pending: Page | null = null
  let duration = 0
  const tag = (...args: unknown[]) => {
    if (allowed) w.gtag?.(...args)
  }
  const context = (page: Page) => ({ page_location: page.location, page_title: page.title, page_referrer: '' })
  const sendPending = () => {
    if (!allowed || !loaded || !pending) return
    const page = pending
    pending = null
    tag('set', context(page))
    tag('event', 'page_view', context(page))
  }
  const configure = () => {
    if (!allowed || !loaded || !current) return
    tag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
    tag('set', context(current))
    tag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
    tag('js', new Date())
    tag('config', id, {
      ...context(current), send_page_view: false, cookie_domain: 'none', cookie_update: false,
      cookie_expires: duration, cookie_flags: 'SameSite=Lax;Secure',
      allow_google_signals: false, allow_ad_personalization_signals: false,
      // No raw attribution input; production console must disable Enhanced Measurement too.
      campaign_id: '', campaign_source: '', campaign_medium: '', campaign_name: '', campaign_term: '', campaign_content: '',
      linker: { domains: [], accept_incoming: false }, url_passthrough: false,
    })
    configured = true
    sendPending()
  }
  return {
    start(measurementId, remainingSeconds, page) {
      id = measurementId; duration = remainingSeconds; current = page; allowed = true
      Reflect.set(w, `ga-disable-${id}`, false)
      if (loaded) { if (!configured) configure(); return }
      if (script) return
      w.dataLayer = []
      // Google expects Arguments, not arrays, in dataLayer.
      w.gtag = function () { if (allowed) w.dataLayer!.push(arguments) }
      script = w.document.createElement('script')
      script.async = true
      script.referrerPolicy = 'no-referrer'
      script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`
      script.onload = () => { loaded = true; configure() }
      script.onerror = () => { script?.remove(); script = null }
      w.document.head.append(script)
    },
    view(page) {
      if (!allowed) return
      current = page; pending = page
      // Only the current page is retained during download; no replay of prior visits.
      sendPending()
    },
    stop() {
      allowed = false; configured = false; pending = null
      if (id) Reflect.set(w, `ga-disable-${id}`, true)
      // Do not send consent=denied through a live tag: Basic mode must not produce pings.
      if (w.dataLayer) w.dataLayer.length = 0
      if (script && !loaded) {
        script.onload = null; script.remove(); script = null
        // A downloaded script may still execute: ga-disable remains set until the next grant.
      }
    },
    clearCookies() {
      for (const pair of w.document.cookie.split(';')) {
        const name = pair.trim().split('=')[0] ?? ''
        if (/^_ga(?:_|$)/.test(name)) w.document.cookie = `${name}=; Max-Age=0; Path=/; Secure; SameSite=Lax`
      }
    },
  }
}
