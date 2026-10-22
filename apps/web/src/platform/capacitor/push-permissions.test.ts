import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ platform: vi.fn(), check: vi.fn(), request: vi.fn(), display: vi.fn(), channels: vi.fn(), settings: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: m.platform } }))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: { checkPermissions: m.check, requestPermissions: m.request, listChannels: m.channels } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { areEnabled: m.display } }))
vi.mock('capacitor-native-settings', () => ({ NativeSettings: { open: m.settings }, AndroidSettings: { AppNotification: 'android-notifications', ApplicationDetails: 'android-app' }, IOSSettings: { AppNotification: 'ios-notifications', App: 'ios-app' } }))
import { checkPushPermission, requestPushPermission, openPushSettings } from './push-permissions'
beforeEach(() => {
  vi.resetAllMocks(); m.platform.mockReturnValue('android'); m.check.mockResolvedValue({ receive: 'granted' }); m.request.mockResolvedValue({ receive: 'granted' })
  m.display.mockResolvedValue({ value: true }); m.channels.mockResolvedValue({ channels: [] }); m.settings.mockResolvedValue({ status: true })
})
it('checks app and channel presentation permission on Android', async () => {
  expect(await checkPushPermission()).toBe('granted')
  m.channels.mockResolvedValue({ channels: [{ id: 'queue-updates', importance: 0 }] }); expect(await checkPushPermission()).toBe('blocked')
  m.channels.mockResolvedValue({ channels: [{ id: 'unrelated', importance: 0 }] }); expect(await checkPushPermission()).toBe('granted')
  m.display.mockResolvedValue({ value: false }); expect(await checkPushPermission()).toBe('blocked')
})
it.each(['prompt', 'prompt-with-rationale', 'denied'])('preserves Android 13+ runtime state %s before checking display permission', async receive => {
  m.check.mockResolvedValue({ receive }); expect(await checkPushPermission()).toBe(receive); expect(m.display).not.toHaveBeenCalled()
})
it('checks display permission after the OS grants a request', async () => {
  m.display.mockResolvedValue({ value: false }); expect(await requestPushPermission()).toBe('blocked')
})
it('uses only PushNotifications for iOS permissions', async () => {
  m.platform.mockReturnValue('ios'); expect(await checkPushPermission()).toBe('granted'); expect(await requestPushPermission()).toBe('granted')
  expect(m.display).not.toHaveBeenCalled(); expect(m.channels).not.toHaveBeenCalled()
})
it('opens app-specific notification settings through supported plugin APIs', async () => {
  expect(await openPushSettings()).toBe(true)
  expect(m.settings).toHaveBeenCalledExactlyOnceWith({ optionAndroid: 'android-notifications', optionIOS: 'ios-notifications' })
})
it.each(['false', 'throw'])('falls back to general app settings on %s', async failure => {
  if (failure === 'false') m.settings.mockResolvedValueOnce({ status: false })
  else m.settings.mockRejectedValueOnce(new Error('unsupported'))
  expect(await openPushSettings()).toBe(true)
  expect(m.settings).toHaveBeenLastCalledWith({ optionAndroid: 'android-app', optionIOS: 'ios-app' })
})
it('returns false rather than throwing when no settings screen can be opened', async () => {
  m.settings.mockRejectedValue(new Error('unsupported')); expect(await openPushSettings()).toBe(false)
})
