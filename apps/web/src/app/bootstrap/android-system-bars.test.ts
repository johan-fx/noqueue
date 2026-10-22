import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ native: vi.fn(), platform: vi.fn(), setStyle: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mock.native, getPlatform: mock.platform },
  SystemBars: { setStyle: mock.setStyle },
  SystemBarsStyle: { Light: 'LIGHT' }, SystemBarType: { StatusBar: 'StatusBar' },
}))
import { configureAndroidSystemBars } from './android-system-bars'
beforeEach(() => { vi.resetAllMocks(); mock.native.mockReturnValue(true); mock.platform.mockReturnValue('android') })
it.each(['web', 'ios'])('leaves %s untouched', async platform => {
  mock.platform.mockReturnValue(platform); mock.native.mockReturnValue(platform !== 'web')
  const doc = document.implementation.createHTMLDocument()
  await configureAndroidSystemBars(doc)
  expect(doc.documentElement.dataset.androidStatusBar).toBeUndefined()
  expect(doc.body.children).toHaveLength(0)
  expect(mock.setStyle).not.toHaveBeenCalled()
})
it('uses core SystemBars only for dark status icons and creates one inert surface', async () => {
  const doc = document.implementation.createHTMLDocument()
  await configureAndroidSystemBars(doc); await configureAndroidSystemBars(doc)
  expect(mock.setStyle).toHaveBeenCalledWith({ style: 'LIGHT', bar: 'StatusBar' })
  expect(doc.documentElement.dataset.androidStatusBar).toBe('true')
  expect(doc.querySelectorAll('#noqueue-android-status-bar')).toHaveLength(1)
  expect(doc.body.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
})
it('does not block bootstrap if cosmetic native styling fails', async () => {
  mock.setStyle.mockRejectedValue(new Error('unavailable'))
  await expect(configureAndroidSystemBars(document.implementation.createHTMLDocument())).resolves.toBeUndefined()
})
