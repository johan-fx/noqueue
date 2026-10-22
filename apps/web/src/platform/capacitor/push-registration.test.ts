import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ listeners: new Map<string, (arg: unknown) => void>(), api: vi.fn(), failListener: vi.fn(), platform: vi.fn(), remove: vi.fn(),
  fcmAvailable: vi.fn(), fcmStart: vi.fn(), fcmStop: vi.fn(), fcmPause: vi.fn(), permission: vi.fn(), request: vi.fn(), register: vi.fn(), unregister: vi.fn(), channel: vi.fn(), channels: vi.fn(), display: vi.fn(), settings: vi.fn(), activeTurn: false }))
vi.mock('./ios-fcm', () => ({ IosFcm: {
  availability: m.fcmAvailable, start: m.fcmStart, stop: m.fcmStop, pause: m.fcmPause,
  addListener: async (name: string, fn: (arg: unknown) => void) => { if (m.failListener(name)) throw new Error('listener unavailable'); m.listeners.set(name, fn); return { remove: m.remove } },
} }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: m.platform } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async (name: string, fn: (arg: unknown) => void) => { if (m.failListener(name)) throw new Error('listener unavailable'); m.listeners.set(name, fn); return { remove: m.remove } } } }))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: async (name: string, fn: (arg: unknown) => void) => { if (m.failListener(name)) throw new Error('listener unavailable'); m.listeners.set(name, fn); return { remove: m.remove } },
  checkPermissions: m.permission, requestPermissions: m.request, register: m.register, unregister: m.unregister, createChannel: m.channel, listChannels: m.channels,
} }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { areEnabled: m.display } }))
vi.mock('capacitor-native-settings', () => ({ NativeSettings: { open: m.settings }, AndroidSettings: { AppNotification: 'notifications', ApplicationDetails: 'app' }, IOSSettings: { AppNotification: 'notifications', App: 'app' } }))
vi.mock('@/data/api/customer', () => ({ nativePushFetch: m.api }))
import { createNativePush } from './push-registration'
const status = () => ({ available: true, enabled: false, providers: { ios: true, android: true } })
const controllers: ReturnType<typeof createNativePush>[] = []
function setup() {
  const options = { hasActiveTurn: () => m.activeTurn, locale: () => 'es' as const, status: vi.fn(), navigate: vi.fn(), refresh: vi.fn() }
  const controller = createNativePush(options); controllers.push(controller)
  return { ...options, controller }
}
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
beforeEach(() => {
  vi.resetAllMocks(); m.listeners.clear(); m.activeTurn = false; m.channels.mockResolvedValue({ channels: [] }); m.display.mockResolvedValue({ value: true }); m.settings.mockResolvedValue({ status: true }); m.platform.mockReturnValue('android')
  m.fcmAvailable.mockResolvedValue({ available: true, initialized: false }); m.fcmPause.mockResolvedValue(undefined); m.fcmStop.mockResolvedValue(undefined)
  m.permission.mockResolvedValue({ receive: 'prompt' }); m.request.mockImplementation(async () => { m.permission.mockResolvedValue({ receive: 'granted' }); return { receive: 'granted' } })
  m.api.mockImplementation(async path => new Response(JSON.stringify(path === '/registration' ? status() : {})))
})
afterEach(async () => { await Promise.all(controllers.splice(0).map(c => c.dispose())); vi.useRealTimers() })
it('installs all listeners before registration and never prompts at startup', async () => {
  const f = setup(); await f.controller.start()
  expect(m.request).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled()
  expect(m.listeners.size).toBe(5)
  m.register.mockImplementation(async () => { expect(m.listeners.has('registration')).toBe(true); m.listeners.get('registration')!({ value: 'test-token-123456789012345' }) })
  await f.controller.enable(); await flush()
  expect(m.request).toHaveBeenCalledTimes(1)
  expect(m.api).toHaveBeenCalledWith('/registration', expect.objectContaining({ body: JSON.stringify({ platform: 'android', token: 'test-token-123456789012345', locale: 'es' }) }))
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'enabled' }))
})
it('does not ask permission or register when that platform is unconfigured', async () => {
  m.api.mockResolvedValue(new Response(JSON.stringify({ ...status(), providers: { android: false, ios: true } })))
  const f = setup(); await f.controller.enable()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'unavailable' })); expect(m.request).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled()
})
it('denial revokes notifications without touching identity or admission', async () => {
  m.request.mockResolvedValue({ receive: 'denied' }); const f = setup(); await f.controller.enable()
  expect(m.register).not.toHaveBeenCalled(); expect(m.api).toHaveBeenCalledWith('/revoke', expect.anything())
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'off', permission: 'denied' }))
})
it('refreshes an already enabled token on resume without another prompt', async () => {
  m.api.mockImplementation(async () => new Response(JSON.stringify({ ...status(), enabled: true })))
  m.permission.mockResolvedValue({ receive: 'granted' }); const f = setup(); await f.controller.start()
  expect(m.register).toHaveBeenCalledTimes(1); expect(m.request).not.toHaveBeenCalled()
  m.listeners.get('registration')?.({ value: 'enabled-test-token-1234567890' }); await flush()
  m.listeners.get('appStateChange')!({ isActive: true }); await flush()
  expect(m.register).toHaveBeenCalledTimes(2)
})
async function disableInSettings(controller: ReturnType<typeof createNativePush>) {
  m.permission.mockResolvedValue({ receive: 'denied' })
  await controller.reconcile()
}
it('revokes backend first and ignores late token callbacks after disabling', async () => {
  const f = setup(); await f.controller.enable(); await disableInSettings(f.controller)
  m.listeners.get('registration')!({ value: 'late-token-123456789012345' }); await flush()
  expect(m.unregister).toHaveBeenCalledOnce()
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1]?.method === 'POST')).toHaveLength(0)
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'off' }))
})
it('resolves an opaque notification hint through authorized API instead of trusting payload URLs', async () => {
  const f = setup(); await f.controller.start(); m.api.mockResolvedValue(new Response(JSON.stringify({ recoveryToken: 'ab'.repeat(32), locale: 'en' })))
  m.listeners.get('pushNotificationActionPerformed')!({ notification: { data: { type: 'queue-update', notificationId: '11'.repeat(16), url: 'https://evil.invalid' } } }); await flush()
  expect(m.api).toHaveBeenLastCalledWith('/notices/' + '11'.repeat(16), expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(f.navigate).toHaveBeenCalledWith(`/t/${'ab'.repeat(32)}?lang=en`); expect(f.refresh).toHaveBeenCalled()
})
it('ignores malformed notification data; unknown/foreign notice never opens a turn', async () => {
  const f = setup(); await f.controller.start(); m.api.mockResolvedValue(new Response('{}', { status: 404 }))
  m.listeners.get('pushNotificationActionPerformed')!({ notification: { data: { url: '/t/fake' } } }); await flush()
  expect(f.navigate).not.toHaveBeenCalled()
  m.listeners.get('pushNotificationActionPerformed')!({ notification: { data: { type: 'queue-update', notificationId: '12'.repeat(16) } } }); await flush()
  expect(f.navigate).toHaveBeenCalledWith('/')
})
it('surfaces registration failures/timeouts and releases every listener on dispose', async () => {
  vi.useFakeTimers(); const f = setup(); await f.controller.enable()
  await vi.advanceTimersByTimeAsync(15000); expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'error' }))
  m.listeners.get('registrationError')!({ error: 'provider-details-must-not-be-logged' })
  await f.controller.dispose(); expect(m.remove).toHaveBeenCalledTimes(5)
})
it('does not claim enabled if uploading the provider token fails', async () => {
  const f = setup(); await f.controller.enable(); m.api.mockResolvedValue(new Response('{}', { status: 503 }))
  m.listeners.get('registration')!({ value: 'test-token-123456789012345' }); await flush()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'error' }))
})

it('fails closed if native listeners cannot be installed, removing already installed handles', async () => {
  m.failListener.mockImplementation(name => name === 'registrationError')
  const f = setup(); await f.controller.start(); await f.controller.enable()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'error' }))
  expect(m.request).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled(); expect(m.api).not.toHaveBeenCalled()
  await f.controller.dispose(); expect(m.remove).toHaveBeenCalledTimes(1)
})
it('retains an offline notification hint in memory and resolves it on resume', async () => {
  const f = setup(); await f.controller.start()
  m.api.mockRejectedValueOnce(new TypeError('offline'))
  m.listeners.get('pushNotificationActionPerformed')!({ notification: { data: { type: 'queue-update', notificationId: '13'.repeat(16) } } }); await flush()
  expect(f.navigate).not.toHaveBeenCalled()
  m.api.mockImplementation(async path => new Response(JSON.stringify(path.startsWith('/notices/') ? { recoveryToken: 'ab'.repeat(32), locale: 'es' } : status())))
  m.listeners.get('appStateChange')!({ isActive: true }); await flush()
  expect(f.navigate).toHaveBeenCalledWith(`/t/${'ab'.repeat(32)}?lang=es`)
})

it('iOS only uploads FCM tokens, preserving case; never uploads the APNs callback', async () => {
  m.platform.mockReturnValue('ios')
  const f = setup(); await f.controller.start()
  expect(m.fcmStart).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled()
  m.fcmStart.mockImplementation(async () => { expect(m.listeners.has('tokenReceived')).toBe(true) })
  await f.controller.enable()
  expect(m.fcmStart).toHaveBeenCalledOnce()
  expect(m.fcmStart.mock.invocationCallOrder[0]).toBeLessThan(m.register.mock.invocationCallOrder[0]!)
  m.listeners.get('registration')!({ value: 'ab'.repeat(32) }); await flush()
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1]?.method === 'POST')).toHaveLength(0)
  m.listeners.get('tokenReceived')!({ token: 'MiXeD_Fcm:01234567890123456789' }); await flush()
  expect(m.api).toHaveBeenLastCalledWith('/registration', expect.objectContaining({ body: JSON.stringify({ platform: 'ios', provider: 'fcm', token: 'MiXeD_Fcm:01234567890123456789', locale: 'es' }) }))
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'enabled' }))
  m.listeners.get('tokenReceived')!({ token: 'Rotated_Fcm:01234567890123456789' }); await flush()
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1]?.method === 'POST')).toHaveLength(2)
})
it('iOS missing client configuration or native gate prevents SDK initialization and permission prompts', async () => {
  m.platform.mockReturnValue('ios'); m.fcmAvailable.mockResolvedValue({ available: false, initialized: false })
  const f = setup(); await f.controller.enable()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'unavailable' }))
  expect(m.request).not.toHaveBeenCalled(); expect(m.fcmStart).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled()
})
it('iOS disable revokes backend before SDK token deletion and ignores late tokens', async () => {
  m.platform.mockReturnValue('ios'); const f = setup(); await f.controller.enable(); await disableInSettings(f.controller)
  const revokeIndex = m.api.mock.calls.findIndex(c => c[0] === '/revoke')
  expect(m.api.mock.invocationCallOrder[revokeIndex]).toBeLessThan(m.fcmStop.mock.invocationCallOrder[0]!)
  expect(m.fcmStop.mock.invocationCallOrder[0]).toBeLessThan(m.unregister.mock.invocationCallOrder[0]!)
  m.listeners.get('tokenReceived')!({ token: 'Late-token-01234567890123456789' }); await flush()
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1]?.method === 'POST')).toHaveLength(0)
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'off' }))
})
it('iOS resumes an enabled registration without asking permission again and reports SDK errors', async () => {
  m.platform.mockReturnValue('ios'); m.permission.mockResolvedValue({ receive: 'granted' })
  m.api.mockImplementation(async () => new Response(JSON.stringify({ ...status(), enabled: true })))
  const f = setup(); await f.controller.start()
  expect(m.fcmStart).toHaveBeenCalledOnce(); expect(m.request).not.toHaveBeenCalled()
  m.listeners.get('tokenError')!({}); expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'error' }))
  m.listeners.get('appStateChange')!({ isActive: true }); await flush()
  expect(m.fcmStart).toHaveBeenCalledTimes(2)
  await f.controller.dispose(); expect(m.remove).toHaveBeenCalledTimes(7)
})
it('iOS failed backend revocation never claims off or deletes the native token prematurely', async () => {
  m.platform.mockReturnValue('ios'); const f = setup(); await f.controller.enable()
  m.api.mockImplementation(async (path) => { if (path === '/revoke') throw new TypeError('offline'); return Response.json(status()) }); await disableInSettings(f.controller)
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'error' })); expect(m.fcmStop).not.toHaveBeenCalled()
  m.api.mockImplementation(async path => Response.json(path === '/registration' ? status() : {})); await disableInSettings(f.controller); expect(m.fcmStop).toHaveBeenCalledOnce()
})
it('iOS denial and native deletion failure stay recoverable without re-registering', async () => {
  m.platform.mockReturnValue('ios'); m.request.mockResolvedValue({ receive: 'denied' })
  const f = setup(); await f.controller.enable()
  expect(m.fcmStart).not.toHaveBeenCalled(); expect(m.fcmStop).toHaveBeenCalledOnce()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'off', permission: 'denied' }))
  m.api.mockImplementation(async path => Response.json(path === '/registration' ? { ...status(), enabled: true } : {})); m.fcmStop.mockRejectedValueOnce(new Error('native failure')); await disableInSettings(f.controller)
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'error' }))
  await disableInSettings(f.controller); expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'off' }))
})
it('iOS disposal while readiness is pending never starts Firebase or prompts later', async () => {
  m.platform.mockReturnValue('ios')
  let resolve!: (value: { receive: string }) => void
  m.permission.mockImplementation(() => new Promise(r => { resolve = r }))
  const f = setup(); const enabling = f.controller.enable(); await flush()
  expect(m.permission).toHaveBeenCalledOnce()
  await f.controller.dispose()
  resolve({ receive: 'prompt' }); await enabling
  expect(m.request).not.toHaveBeenCalled(); expect(m.fcmStart).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled()
})
it('iOS disposal while native start is pending never registers APNs afterward', async () => {
  m.platform.mockReturnValue('ios')
  let resolve!: () => void
  m.fcmStart.mockImplementation(() => new Promise<void>(r => { resolve = r }))
  const f = setup(); const enabling = f.controller.enable(); await flush()
  expect(m.fcmStart).toHaveBeenCalledOnce()
  await f.controller.dispose(); resolve(); await enabling
  expect(m.register).not.toHaveBeenCalled(); expect(m.fcmPause).toHaveBeenCalled()
})

it('requests permission exactly once for a confirmed admission, including concurrent retries and resume', async () => {
  const f = setup(); await f.controller.start()
  const first = f.controller.requestAfterJoin('same-idempotency-key')
  const duplicate = f.controller.requestAfterJoin('same-idempotency-key')
  const click = f.controller.enable()
  m.listeners.get('appStateChange')!({ isActive: true })
  await Promise.all([first, duplicate, click]); await flush()
  expect(m.request).toHaveBeenCalledOnce(); expect(m.register).toHaveBeenCalledOnce()
  await f.controller.requestAfterJoin('same-idempotency-key')
  expect(m.request).toHaveBeenCalledOnce()
})
it.each(['denied', 'prompt-with-rationale'])('does not automatically ask again or open settings after %s', async receive => {
  m.permission.mockResolvedValue({ receive })
  const f = setup(); await f.controller.requestAfterJoin('new-admission')
  expect(m.request).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled(); expect(m.settings).not.toHaveBeenCalled()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ permission: receive, registration: 'off' }))
})
it('allows another permission request with rationale only from the CTA', async () => {
  m.permission.mockResolvedValue({ receive: 'prompt-with-rationale' })
  const f = setup(); await f.controller.enable()
  expect(m.request).toHaveBeenCalledOnce(); expect(m.settings).not.toHaveBeenCalled()
})
it('does not take a fresh rejection straight to settings', async () => {
  m.request.mockImplementation(async () => { m.permission.mockResolvedValue({ receive: 'denied' }); return { receive: 'denied' } })
  const f = setup(); await f.controller.requestAfterJoin('join'); expect(m.settings).not.toHaveBeenCalled()
  await f.controller.requestAfterJoin('another-join'); expect(m.request).toHaveBeenCalledOnce()
  await f.controller.enable(); expect(m.settings).toHaveBeenCalledOnce()
})
it('opens settings after denial, then registers on resume even when backend was previously revoked', async () => {
  m.activeTurn = true; m.permission.mockResolvedValue({ receive: 'denied' })
  const f = setup(); await f.controller.start(); await f.controller.enable()
  expect(m.settings).toHaveBeenCalledOnce(); expect(m.request).not.toHaveBeenCalled()
  await f.controller.reconcile(); expect(m.register).not.toHaveBeenCalled()
  m.permission.mockResolvedValue({ receive: 'granted' })
  m.listeners.get('appStateChange')!({ isActive: true }); await flush()
  expect(m.register).toHaveBeenCalledOnce(); expect(m.request).not.toHaveBeenCalled()
  m.listeners.get('registration')!({ value: 'resumed-test-token-1234567890' }); await flush()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ permission: 'granted', registration: 'enabled' }))
})
it('does not silently register a permission-granted installation without a turn or prior registration', async () => {
  m.permission.mockResolvedValue({ receive: 'granted' })
  const f = setup(); await f.controller.start(); await f.controller.reconcile()
  expect(m.register).not.toHaveBeenCalled(); expect(m.request).not.toHaveBeenCalled()
  m.activeTurn = true; await f.controller.reconcile(); expect(m.register).toHaveBeenCalledOnce()
})
it.each(['app', 'channel'])('detects Android 12 %s settings block despite receive=granted', async block => {
  m.permission.mockResolvedValue({ receive: 'granted' })
  if (block === 'app') m.display.mockResolvedValue({ value: false })
  else m.channels.mockResolvedValue({ channels: [{ id: 'queue-updates', importance: 0 }] })
  const f = setup(); await f.controller.requestAfterJoin('join')
  expect(m.request).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled(); expect(m.settings).not.toHaveBeenCalled()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ permission: 'blocked', registration: 'off' }))
  await f.controller.enable(); expect(m.settings).toHaveBeenCalledOnce()
})
it('revokes when Android presentation is blocked and ignores a late FCM token', async () => {
  const f = setup(); await f.controller.enable()
  m.display.mockResolvedValue({ value: false })
  m.listeners.get('registration')!({ value: 'late-blocked-token-1234567890' }); await flush()
  expect(m.api).toHaveBeenCalledWith('/revoke', expect.objectContaining({ method: 'POST' }))
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1]?.method === 'POST')).toHaveLength(0)
})
it('retries a failed registration without requesting permission again', async () => {
  const f = setup(); await f.controller.requestAfterJoin('join')
  m.listeners.get('registrationError')!({ error: 'offline' })
  await f.controller.enable()
  expect(m.request).toHaveBeenCalledOnce(); expect(m.register).toHaveBeenCalledTimes(2)
})
it('shows settings instructions if both specific and app settings fail to open', async () => {
  m.permission.mockResolvedValue({ receive: 'denied' }); m.settings.mockRejectedValue(new Error('not supported'))
  const f = setup(); await f.controller.enable()
  expect(m.settings).toHaveBeenCalledTimes(2)
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ permission: 'denied', settingsError: true, registration: 'off' }))
})
it('does not renew registration twice while a token upload and resume overlap', async () => {
  let finish!: (response: Response) => void
  const f = setup(); await f.controller.enable()
  m.api.mockImplementation(async (_path, init) => init?.method === 'POST'
    ? new Promise<Response>(resolve => { finish = resolve }) : Response.json(status()))
  m.listeners.get('registration')!({ value: 'uploading-test-token-1234567890' }); await flush()
  m.listeners.get('appStateChange')!({ isActive: true })
  m.listeners.get('appStateChange')!({ isActive: true })
  finish(Response.json({})); await flush()
  // One original registration and at most one refresh for the coalesced resumes.
  expect(m.register).toHaveBeenCalledTimes(2)
  expect(m.request).toHaveBeenCalledOnce()
})
it('supports Android 7 without channels but still checks app-level presentation settings', async () => {
  m.channels.mockRejectedValue({ code: 'UNAVAILABLE' }); m.channel.mockRejectedValue({ code: 'UNAVAILABLE' })
  const f = setup(); await f.controller.requestAfterJoin('join')
  expect(m.display).toHaveBeenCalled(); expect(m.register).toHaveBeenCalledOnce()
})
it('fails closed on genuine channel inspection errors', async () => {
  m.channels.mockRejectedValue(new Error('native bridge failure'))
  const f = setup(); await f.controller.requestAfterJoin('join')
  expect(m.register).not.toHaveBeenCalled()
  expect(f.status).toHaveBeenLastCalledWith(expect.objectContaining({ registration: 'error' }))
})
