import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ listeners: new Map<string, (arg: unknown) => void>(), api: vi.fn(), failListener: vi.fn(), platform: vi.fn(), remove: vi.fn(),
  fcmAvailable: vi.fn(), fcmStart: vi.fn(), fcmStop: vi.fn(), fcmPause: vi.fn(), permission: vi.fn(), request: vi.fn(), register: vi.fn(), unregister: vi.fn(), channel: vi.fn() }))
vi.mock('./ios-fcm', () => ({ IosFcm: {
  availability: m.fcmAvailable, start: m.fcmStart, stop: m.fcmStop, pause: m.fcmPause,
  addListener: async (name: string, fn: (arg: unknown) => void) => { if (m.failListener(name)) throw new Error('listener unavailable'); m.listeners.set(name, fn); return { remove: m.remove } },
} }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: m.platform } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async (name: string, fn: (arg: unknown) => void) => { if (m.failListener(name)) throw new Error('listener unavailable'); m.listeners.set(name, fn); return { remove: m.remove } } } }))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: async (name: string, fn: (arg: unknown) => void) => { if (m.failListener(name)) throw new Error('listener unavailable'); m.listeners.set(name, fn); return { remove: m.remove } },
  checkPermissions: m.permission, requestPermissions: m.request, register: m.register, unregister: m.unregister, createChannel: m.channel,
} }))
vi.mock('@/data/api/customer', () => ({ nativePushFetch: m.api }))
import { createNativePush } from './push-registration'
const status = () => ({ available: true, enabled: false, providers: { ios: true, android: true } })
const controllers: ReturnType<typeof createNativePush>[] = []
function setup() {
  const options = { locale: () => 'es' as const, status: vi.fn(), navigate: vi.fn(), refresh: vi.fn() }
  const controller = createNativePush(options); controllers.push(controller)
  return { ...options, controller }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
beforeEach(() => {
  vi.resetAllMocks(); m.listeners.clear(); m.platform.mockReturnValue('android')
  m.fcmAvailable.mockResolvedValue({ available: true, initialized: false }); m.fcmPause.mockResolvedValue(undefined); m.fcmStop.mockResolvedValue(undefined)
  m.permission.mockResolvedValue({ receive: 'prompt' }); m.request.mockResolvedValue({ receive: 'granted' })
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
  expect(f.status).toHaveBeenLastCalledWith('enabled')
})
it('does not ask permission or register when that platform is unconfigured', async () => {
  m.api.mockResolvedValue(new Response(JSON.stringify({ ...status(), providers: { android: false, ios: true } })))
  const f = setup(); await f.controller.enable()
  expect(f.status).toHaveBeenLastCalledWith('unavailable'); expect(m.request).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled()
})
it('denial revokes notifications without touching identity or admission', async () => {
  m.request.mockResolvedValue({ receive: 'denied' }); const f = setup(); await f.controller.enable()
  expect(m.register).not.toHaveBeenCalled(); expect(m.api).toHaveBeenCalledWith('/revoke', expect.anything())
  expect(f.status).toHaveBeenLastCalledWith('denied')
})
it('refreshes an already enabled token on resume without another prompt', async () => {
  m.api.mockImplementation(async () => new Response(JSON.stringify({ ...status(), enabled: true })))
  m.permission.mockResolvedValue({ receive: 'granted' }); const f = setup(); await f.controller.start()
  expect(m.register).toHaveBeenCalledTimes(1); expect(m.request).not.toHaveBeenCalled()
  m.listeners.get('appStateChange')!({ isActive: true }); await flush()
  expect(m.register).toHaveBeenCalledTimes(2)
})
it('revokes backend first and ignores late token callbacks after disabling', async () => {
  const f = setup(); await f.controller.enable(); await f.controller.disable()
  m.listeners.get('registration')!({ value: 'late-token-123456789012345' }); await flush()
  expect(m.unregister).toHaveBeenCalledOnce()
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1])).toHaveLength(0)
  expect(f.status).toHaveBeenLastCalledWith('off')
})
it('resolves an opaque notification hint through authorized API instead of trusting payload URLs', async () => {
  const f = setup(); await f.controller.start(); m.api.mockResolvedValue(new Response(JSON.stringify({ recoveryToken: 'ab'.repeat(32), locale: 'en' })))
  m.listeners.get('pushNotificationActionPerformed')!({ notification: { data: { type: 'queue-update', notificationId: '11'.repeat(16), url: 'https://evil.invalid' } } }); await flush()
  expect(m.api).toHaveBeenLastCalledWith('/notices/' + '11'.repeat(16), undefined)
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
  await vi.advanceTimersByTimeAsync(15000); expect(f.status).toHaveBeenLastCalledWith('error')
  m.listeners.get('registrationError')!({ error: 'provider-details-must-not-be-logged' })
  await f.controller.dispose(); expect(m.remove).toHaveBeenCalledTimes(5)
})
it('does not claim enabled if uploading the provider token fails', async () => {
  const f = setup(); await f.controller.enable(); m.api.mockResolvedValue(new Response('{}', { status: 503 }))
  m.listeners.get('registration')!({ value: 'test-token-123456789012345' }); await flush()
  expect(f.status).toHaveBeenLastCalledWith('error')
})

it('fails closed if native listeners cannot be installed, removing already installed handles', async () => {
  m.failListener.mockImplementation(name => name === 'registrationError')
  const f = setup(); await f.controller.start(); await f.controller.enable()
  expect(f.status).toHaveBeenLastCalledWith('error')
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
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1])).toHaveLength(0)
  m.listeners.get('tokenReceived')!({ token: 'MiXeD_Fcm:01234567890123456789' }); await flush()
  expect(m.api).toHaveBeenLastCalledWith('/registration', expect.objectContaining({ body: JSON.stringify({ platform: 'ios', provider: 'fcm', token: 'MiXeD_Fcm:01234567890123456789', locale: 'es' }) }))
  expect(f.status).toHaveBeenLastCalledWith('enabled')
  m.listeners.get('tokenReceived')!({ token: 'Rotated_Fcm:01234567890123456789' }); await flush()
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1])).toHaveLength(2)
})
it('iOS missing client configuration or native gate prevents SDK initialization and permission prompts', async () => {
  m.platform.mockReturnValue('ios'); m.fcmAvailable.mockResolvedValue({ available: false, initialized: false })
  const f = setup(); await f.controller.enable()
  expect(f.status).toHaveBeenLastCalledWith('unavailable')
  expect(m.request).not.toHaveBeenCalled(); expect(m.fcmStart).not.toHaveBeenCalled(); expect(m.register).not.toHaveBeenCalled()
})
it('iOS disable revokes backend before SDK token deletion and ignores late tokens', async () => {
  m.platform.mockReturnValue('ios'); const f = setup(); await f.controller.enable(); await f.controller.disable()
  const revokeIndex = m.api.mock.calls.findIndex(c => c[0] === '/revoke')
  expect(m.api.mock.invocationCallOrder[revokeIndex]).toBeLessThan(m.fcmStop.mock.invocationCallOrder[0]!)
  expect(m.fcmStop.mock.invocationCallOrder[0]).toBeLessThan(m.unregister.mock.invocationCallOrder[0]!)
  m.listeners.get('tokenReceived')!({ token: 'Late-token-01234567890123456789' }); await flush()
  expect(m.api.mock.calls.filter(c => c[0] === '/registration' && c[1])).toHaveLength(0)
  expect(f.status).toHaveBeenLastCalledWith('off')
})
it('iOS resumes an enabled registration without asking permission again and reports SDK errors', async () => {
  m.platform.mockReturnValue('ios'); m.permission.mockResolvedValue({ receive: 'granted' })
  m.api.mockImplementation(async () => new Response(JSON.stringify({ ...status(), enabled: true })))
  const f = setup(); await f.controller.start()
  expect(m.fcmStart).toHaveBeenCalledOnce(); expect(m.request).not.toHaveBeenCalled()
  m.listeners.get('tokenError')!({}); expect(f.status).toHaveBeenLastCalledWith('error')
  m.listeners.get('appStateChange')!({ isActive: true }); await flush()
  expect(m.fcmStart).toHaveBeenCalledTimes(2)
  await f.controller.dispose(); expect(m.remove).toHaveBeenCalledTimes(7)
})
it('iOS failed backend revocation never claims off or deletes the native token prematurely', async () => {
  m.platform.mockReturnValue('ios'); const f = setup(); await f.controller.enable()
  m.api.mockRejectedValueOnce(new TypeError('offline')); await f.controller.disable()
  expect(f.status).toHaveBeenLastCalledWith('error'); expect(m.fcmStop).not.toHaveBeenCalled()
  await f.controller.disable(); expect(m.fcmStop).toHaveBeenCalledOnce()
})
it('iOS denial and native deletion failure stay recoverable without re-registering', async () => {
  m.platform.mockReturnValue('ios'); m.request.mockResolvedValue({ receive: 'denied' })
  const f = setup(); await f.controller.enable()
  expect(m.fcmStart).not.toHaveBeenCalled(); expect(m.fcmStop).toHaveBeenCalledOnce()
  expect(f.status).toHaveBeenLastCalledWith('denied')
  m.fcmStop.mockRejectedValueOnce(new Error('native failure')); await f.controller.disable()
  expect(f.status).toHaveBeenLastCalledWith('error')
  await f.controller.disable(); expect(f.status).toHaveBeenLastCalledWith('off')
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
