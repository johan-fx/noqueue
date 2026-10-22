import { IosFcm } from './ios-fcm'
import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { pushNoticeDataSchema, pushResolutionSchema, pushStatusSchema } from '@noqueue/contracts/mobile-push'
import { nativePushFetch } from '@/data/api/customer'
import { checkPushPermission, requestPushPermission, openPushSettings, ensurePushChannel, type PushPermission } from './push-permissions'

export type PushState = {
  permission: PushPermission
  registration: 'checking' | 'off' | 'busy' | 'enabled' | 'error' | 'unavailable'
  settingsError: boolean
}
export const initialPushState: PushState = { permission: 'unknown', registration: 'checking', settingsError: false }
type Options = {
  locale: () => 'es' | 'en'
  hasActiveTurn: () => boolean
  status: (state: PushState) => void
  navigate: (path: string) => void
  refresh: () => void
}
/** Owned by NativeShell. A confirmed admission or an explicit CTA may prompt, never startup/resume. */
export function createNativePush(options: Options) {
  let disposed = false, listenersReady = false, wantsPush = false, revocationPending = false
  let tail = Promise.resolve(), pendingNotice: string | undefined
  let state = initialPushState, registrationPending = false, epoch = 0
  let activation: Promise<void> | undefined, reconciliation: Promise<void> | undefined
  let registrationTimer: ReturnType<typeof setTimeout> | undefined
  const admissions = new Set<string>()
  const listeners: PluginListenerHandle[] = []
  const ios = () => Capacitor.getPlatform() === 'ios'
  const set = (patch: Partial<PushState>) => {
    if (!disposed) { state = { ...state, ...patch }; options.status(state) }
  }
  const fail = () => {
    clearTimeout(registrationTimer)
    registrationPending = false
    set({ registration: 'error' })
  }
  const serialize = (work: () => Promise<void>) => {
    tail = tail.catch(() => undefined).then(async () => { if (!disposed) await work() }).catch(fail)
    return tail
  }
  async function api(path: string, body?: unknown) {
    const response = await nativePushFetch(path, {
      signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
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
    // Resolve ownership first. Never navigate to a URL supplied by the payload.
    options.navigate(`/t/${result.recoveryToken}?lang=${result.locale}`)
    options.refresh()
  }
  async function available(status: ReturnType<typeof pushStatusSchema.parse>) {
    const platform = Capacitor.getPlatform()
    return status.available && (platform === 'ios' || platform === 'android') && status.providers[platform]
      && (!ios() || (await IosFcm.availability()).available)
  }
  async function permission() {
    const value = await checkPushPermission()
    set({ permission: value })
    return value
  }
  async function revoke() {
    // Block queued/late token callbacks even when backend revocation fails.
    wantsPush = false
    epoch++
    registrationPending = false
    revocationPending = true
    clearTimeout(registrationTimer)
    await api('/revoke', {})
    if (disposed) return
    if (ios()) await IosFcm.stop()
    if (disposed) return
    await PushNotifications.unregister()
    revocationPending = false
  }
  async function saveToken(value: string, tokenEpoch: number) {
    if (!wantsPush || disposed || tokenEpoch !== epoch) return
    // A callback can race with the user disabling notifications in Settings.
    if (await permission() !== 'granted') { await revoke(); set({ registration: 'off' }); return }
    if (!wantsPush || disposed || tokenEpoch !== epoch) return
    const platform = Capacitor.getPlatform()
    await api('/registration', { platform, ...(ios() ? { provider: 'fcm' } : {}), token: value, locale: options.locale() })
    if (wantsPush && !disposed && tokenEpoch === epoch) {
      clearTimeout(registrationTimer)
      registrationPending = false
      set({ registration: 'enabled' })
    }
  }
  async function register() {
    if (disposed || !wantsPush || registrationPending) return
    registrationPending = true
    set({ registration: 'busy', settingsError: false })
    if (Capacitor.getPlatform() === 'android') await ensurePushChannel()
    if (disposed || !wantsPush) return
    clearTimeout(registrationTimer)
    registrationTimer = setTimeout(fail, 15000)
    if (ios()) await IosFcm.start()
    if (disposed || !wantsPush) { clearTimeout(registrationTimer); if (ios()) await IosFcm.pause(); return }
    await PushNotifications.register()
  }
  async function readiness() {
    const status = pushStatusSchema.parse(await api('/registration'))
    if (!await available(status)) {
      wantsPush = false
      epoch++
      registrationPending = false
      clearTimeout(registrationTimer)
      if (ios()) await IosFcm.pause()
      set({ registration: 'unavailable' })
      return null
    }
    return disposed ? null : status
  }
  async function reconcile() {
    if (pendingNotice) await resolveNotice(pendingNotice)
    const status = await readiness()
    if (!status) return
    const receive = await permission()
    if (disposed) return
    if (revocationPending || (receive !== 'granted' && (status.enabled || wantsPush))) await revoke()
    if (receive === 'granted' && (status.enabled || options.hasActiveTurn() || wantsPush)) {
      wantsPush = true
      await register()
    } else {
      wantsPush = false
      if (ios()) await IosFcm.pause()
      set({ registration: 'off' })
    }
  }
  async function activate(manual: boolean) {
    const status = await readiness()
    if (!status) return
    let receive = await permission()
    if (disposed) return
    const canPrompt = receive === 'prompt' || (manual && receive === 'prompt-with-rationale')
    if (canPrompt) {
      receive = await requestPushPermission()
      if (disposed) return
      set({ permission: receive })
      if (receive !== 'granted') {
        await revoke()
        set({ registration: 'off' })
        return // A rejection must not immediately send the user to Settings.
      }
    }
    if (receive !== 'granted') {
      if (status.enabled || wantsPush || revocationPending) await revoke()
      if (manual) set({ settingsError: !await openPushSettings() })
      set({ registration: 'off' })
      return
    }
    if (revocationPending) await revoke()
    wantsPush = true
    await register()
  }
  async function listen(promise: Promise<PluginListenerHandle>) {
    const handle = await promise
    if (disposed) await handle.remove(); else listeners.push(handle)
  }
  function token(value: string) {
    const tokenEpoch = epoch
    void serialize(() => saveToken(value, tokenEpoch))
  }
  const ready = (async () => {
    if (ios()) {
      await listen(IosFcm.addListener('tokenReceived', ({ token: value }) => token(value)))
      await listen(IosFcm.addListener('tokenError', () => { if (wantsPush) fail() }))
    }
    await listen(PushNotifications.addListener('registration', ({ value }) => {
      // iOS emits an APNs token here; only the FCM bridge may provide its recipient.
      if (!ios()) token(value)
    }))
    await listen(PushNotifications.addListener('registrationError', () => { if (wantsPush) fail() }))
    await listen(PushNotifications.addListener('pushNotificationReceived', () => { if (!disposed) options.refresh() }))
    await listen(PushNotifications.addListener('pushNotificationActionPerformed', event => {
      const data = pushNoticeDataSchema.safeParse(event.notification.data)
      if (data.success) void serialize(() => resolveNotice(data.data.notificationId))
    }))
    await listen(App.addListener('appStateChange', ({ isActive }) => { if (isActive && listenersReady) void refreshPermission() }))
    listenersReady = true
  })().catch(fail)
  function refreshPermission() {
    if (!reconciliation) reconciliation = (async () => {
      await ready
      if (listenersReady) await serialize(reconcile)
    })().finally(() => { reconciliation = undefined })
    return reconciliation
  }
  function enable(manual: boolean) {
    if (disposed || registrationPending || state.registration === 'enabled') return Promise.resolve()
    if (!activation) {
      set({ registration: 'busy', settingsError: false })
      activation = (async () => {
        await ready
        if (listenersReady) await serialize(() => activate(manual))
        else fail()
      })().finally(() => { activation = undefined })
    }
    return activation
  }
  return {
    start: refreshPermission,
    reconcile: refreshPermission,
    enable: () => enable(true),
    requestAfterJoin: (key: string) => {
      if (admissions.has(key)) return Promise.resolve()
      admissions.add(key)
      return enable(false)
    },
    dispose: async () => {
      disposed = true; wantsPush = false; epoch++; clearTimeout(registrationTimer)
      await ready
      if (ios()) await IosFcm.pause().catch(() => undefined)
      await Promise.all(listeners.splice(0).map(l => l.remove()))
    },
  }
}
