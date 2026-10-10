import { afterEach, expect, it, vi } from 'vitest'
import { publicQueueUrl, openPublicQueue } from './public-queue-links'
const mocks = vi.hoisted(() => ({ native: false, open: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open } }))
afterEach(() => {
  mocks.native = false
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  mocks.open.mockReset()
})
it('builds encoded public destinations with locale from the configured origin', () => {
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
  expect(publicQueueUrl('a/b', 'kiosk', 'en')).toBe(
    'https://public.example/q/a%2Fb/kiosk?lang=en'
  )
  expect(publicQueueUrl('q', 'qr')).toBe('https://public.example/q/q/qr')
  expect(publicQueueUrl('q')).toBe('https://public.example/q/q')
})
it('falls back only in web and refuses unsafe or malformed native origins', () => {
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', '')
  expect(publicQueueUrl('q')).toBe(`${window.location.origin}/q/q`)
  mocks.native = true
  for (const origin of [
    '',
    'http://public.example',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://user:pass@public.example',
    'https://public.example/path',
    'broken',
  ]) {
    vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', origin)
    expect(() => publicQueueUrl('q')).toThrow()
  }
})
it('opens native links using Browser and propagates failures', async () => {
  mocks.native = true
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
  await openPublicQueue('q', 'kiosk')
  expect(mocks.open).toHaveBeenCalledWith({
    url: 'https://public.example/q/q/kiosk',
  })
  mocks.open.mockRejectedValueOnce(new Error('Opening failed'))
  await expect(openPublicQueue('q', 'qr')).rejects.toThrow('Opening failed')
})
it('opens a separate web tab without an opener and reports blocked opening', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
  await openPublicQueue('q')
  expect(open).toHaveBeenCalledWith(
    expect.stringContaining('/q/q'),
    '_blank',
    'noopener,noreferrer'
  )
  open.mockReturnValue(null)
  await expect(openPublicQueue('q')).rejects.toThrow()
})
