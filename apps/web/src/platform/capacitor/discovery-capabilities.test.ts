import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ runtime: 'native', check: vi.fn(), request: vi.fn(), position: vi.fn() }))
vi.mock('@/app/bootstrap/runtime', () => ({ detectRuntime: () => m.runtime }))
vi.mock('@capacitor/geolocation', () => ({ Geolocation: { checkPermissions: m.check, requestPermissions: m.request, getCurrentPosition: m.position } }))
import { discoveryPosition, discoveryQrDestination } from './discovery-capabilities'
beforeEach(() => { vi.clearAllMocks(); m.runtime = 'native'; vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://app.noqueue-app.com'); m.check.mockResolvedValue({ coarseLocation: 'prompt' }); m.request.mockResolvedValue({ coarseLocation: 'granted' }); m.position.mockResolvedValue({ coords: { latitude: 40, longitude: -3 } }) })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('requests only approximate location on explicit invocation and does not watch in background', async () => {
  expect(m.check).not.toHaveBeenCalled()
  expect(await discoveryPosition()).toEqual({ latitude: 40, longitude: -3 })
  expect(m.request).toHaveBeenCalledWith({ permissions: ['coarseLocation'] })
  expect(m.position).toHaveBeenCalledWith({ enableHighAccuracy: false, timeout: 10000, maximumAge: 0 })
})
it('does not request permission again when already granted', async () => {
  m.check.mockResolvedValue({ coarseLocation: 'granted' })
  await discoveryPosition(); expect(m.request).not.toHaveBeenCalled()
})
it('denial fails without requesting a position', async () => {
  m.request.mockResolvedValue({ coarseLocation: 'denied' })
  await expect(discoveryPosition()).rejects.toThrow('location_denied')
  expect(m.position).not.toHaveBeenCalled()
})
it('web keeps the navigator capability and options', async () => {
  m.runtime = 'web'
  const getCurrentPosition = vi.fn(success => success({ coords: { latitude: 41, longitude: -2 } }))
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  expect(await discoveryPosition()).toEqual({ latitude: 41, longitude: -2 })
  expect(m.check).not.toHaveBeenCalled()
})
it.each(['/q/abc', '/v/abc', '/q/abc?lang=en'])('accepts canonical QR %s', route => {
  expect(discoveryQrDestination('https://app.noqueue-app.com' + route)).toBe(route)
})
it.each(['https://evil.example/q/abc', 'https://localhost/q/abc', 'capacitor://localhost/q/abc', '/q/abc', 'https://app.noqueue-app.com/t/' + 'aa'.repeat(32), 'https://app.noqueue-app.com/q/abc?lang=es&lang=en', 'https://app.noqueue-app.com/q/abc?source=whatsapp', 'https://app.noqueue-app.com/q/abc#x'])('rejects untrusted QR %s', url => {
  expect(discoveryQrDestination(url)).toBeNull()
})
