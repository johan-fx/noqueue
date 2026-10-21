import { IosFcm } from './ios-fcm'
import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { pushNoticeDataSchema, pushResolutionSchema, pushStatusSchema } from '@noqueue/contracts/mobile-push'
import { nativePushFetch } from '@/data/api/customer'

export type PushState = 'off' | 'busy' | 'enabled' | 'denied' | 'error' | 'unavailable'
type Options = { locale: () => 'es' | 'en'; status: (state: PushState) => void; navigate: (path: string) => void; refresh: () => void }
/** One instance owned by NativeShell. Listeners before registration, no unsolicited prompt. */
export function createNativePush(options: Options) {
  let disposed = false, listenersReady = false, wantsPush = false, tail = Promise.resolve(), pendingNotice: string | undefined
  let registrationTimer: ReturnType<typeof setTimeout> | undefined
  const listeners: PluginListenerHandle[] = []
  const set = (state: PushState) => { if (!disposed) options.status(state) }
  const serialize = (work: () => Promise<void>) => {
    tail = tail.catch(() => undefined).then(async () => { if (!disposed) await work() }).catch(() => set('error'))
    return tail
  }
  async function api(path: string, body?: unknown) {
    const response = await nativePushFetch(path, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!response.ok) throw Object.assign(new Error('push_request_failed'), { status: response.status })
    return response.json()
  }
  async function resolveNotice(id: string) {
    pendingNotice = id
    let result
    try { result = pushResolutionSchema.parse(await api('/notices/' + id)) }
    catch (error) {
      if ((error as { status?: number }).status === 404) {
        pendingNotice = undefined
        if (!disposed) options.navigate('/')
        return
      }
      throw error
    }
    if (disposed) return
    pendingNotice = undefined
    // Never navigate to a URL from a notification payload; resolve ownership first.
    options.navigate(`/t/${result.recoveryToken}?lang=${result.locale}`)
    options.refresh()
  }
  const ios = () => Capacitor.getPlatform() === 'ios'
  async function localAvailable() {
    return !ios() || (await IosFcm.availability()).available
  }
  async function stopNative() {
    if (ios()) await IosFcm.stop()
    await PushNotifications.unregister()
  }
  async function saveToken(value: string) {
    if (!wantsPush || disposed) return
    clearTimeout(registrationTimer)
    const platform = Capacitor.getPlatform()
    await api('/registration', { platform, ...(ios() ? { provider: 'fcm' } : {}), token: value, locale: options.locale() })
    if (wantsPush) set('enabled')
  }
  async function register() {
    // Readiness/permission requests can finish after the shell has unmounted.
    if (disposed || !wantsPush) return
    const platform = Capacitor.getPlatform()
    if (platform !== 'ios' && platform !== 'android') { set('unavailable'); return }
    set('busy')
    if (platform === 'android') await PushNotifications.createChannel({ id: 'queue-updates', name: 'NoQueue', importance: 4, visibility: 0 })
    clearTimeout(registrationTimer)
    registrationTimer = setTimeout(() => set('error'), 15000)
    if (ios()) await IosFcm.start()
    if (disposed || !wantsPush) { clearTimeout(registrationTimer); if (ios()) await IosFcm.pause(); return }
    await PushNotifications.register()
  }
  function available(status: ReturnType<typeof pushStatusSchema.parse>) {
    const platform = Capacitor.getPlatform()
    return status.available && (platform === 'ios' || platform === 'android') && status.providers[platform]
  }
  async function reconcile() {
    if (pendingNotice) await resolveNotice(pendingNotice)
    const status = pushStatusSchema.parse(await api('/registration'))
    wantsPush = status.enabled
    if (!available(status) || !await localAvailable()) {
      wantsPush = false
      if (ios()) await IosFcm.pause()
      set('unavailable'); return
    }
    const permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'denied') {
      wantsPush = false
      if (status.enabled) await api('/revoke', {})
      await stopNative()
      set('denied')
    } else if (permission.receive === 'granted' && status.enabled) await register()
    else { wantsPush = false; if (ios()) await IosFcm.pause(); set('off') }
  }
  async function listen(promise: Promise<PluginListenerHandle>) {
    const handle = await promise
    if (disposed) await handle.remove(); else listeners.push(handle)
  }
  const ready = (async () => {
    if (ios()) {
      await listen(IosFcm.addListener('tokenReceived', ({ token }) => {
        void serialize(() => saveToken(token))
      }))
      await listen(IosFcm.addListener('tokenError', () => {
        clearTimeout(registrationTimer); if (wantsPush) set('error')
      }))
    }
    await listen(PushNotifications.addListener('registration', ({ value }) => {
      // On iOS this is an APNs token, NOT the FCM recipient. The native bridge
      // binds it to Firebase and emits tokenReceived only after token exchange.
      if (!ios()) void serialize(() => saveToken(value))
    }))
    await listen(PushNotifications.addListener('registrationError', () => { clearTimeout(registrationTimer); if (wantsPush) set('error') }))
    await listen(PushNotifications.addListener('pushNotificationReceived', () => { if (!disposed) options.refresh() }))
    await listen(PushNotifications.addListener('pushNotificationActionPerformed', event => {
        const data = pushNoticeDataSchema.safeParse(event.notification.data)
        if (data.success) void serialize(() => resolveNotice(data.data.notificationId))
      }))
    await listen(App.addListener('appStateChange', ({ isActive }) => { if (isActive && listenersReady) void serialize(reconcile) }))
    listenersReady = true
  })().catch(() => set('error'))
  return {
    start: async () => { await ready; if (listenersReady) await serialize(reconcile) },
    enable: async () => {
      await ready
      if (!listenersReady) return
      return serialize(async () => {
        set('busy')
        // Readiness before prompting; user may always continue without push.
        const status = pushStatusSchema.parse(await api('/registration'))
        if (!available(status) || !await localAvailable()) { set('unavailable'); return }
        let permission = await PushNotifications.checkPermissions()
        if (disposed) return
        if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') permission = await PushNotifications.requestPermissions()
        if (disposed) return
        wantsPush = permission.receive === 'granted'
        if (!wantsPush) { await api('/revoke', {}); await stopNative(); set('denied'); return }
        await register()
      })
    },
    disable: async () => {
      // Stop accepting new registration callbacks immediately, even while POST is in flight.
      wantsPush = false
      clearTimeout(registrationTimer)
      await ready
      return serialize(async () => {
        wantsPush = false
        await api('/revoke', {}) // Backend first; failed revocation must remain visible/retryable.
        await stopNative()
        set('off')
      })
    },
    dispose: async () => { disposed = true; wantsPush = false; clearTimeout(registrationTimer); await ready; if (ios()) await IosFcm.pause().catch(() => undefined); await Promise.all(listeners.splice(0).map(l => l.remove())) },
  }
}
