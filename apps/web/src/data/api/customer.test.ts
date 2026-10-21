import { afterEach, expect, it, vi } from 'vitest'
import { customerFetch, nativeApiUrl } from './customer'
const runtime = vi.hoisted(() => ({ value: 'web' }))
const identity = vi.hoisted(() => vi.fn().mockResolvedValue('ab'.repeat(32)))
vi.mock('@/app/bootstrap/runtime', () => ({ detectRuntime: () => runtime.value }))
vi.mock('@/platform/capacitor/installation', () => ({ installationSecret: identity }))
afterEach(() => { runtime.value = 'web'; identity.mockClear(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('leaves web requests unchanged without consulting native storage', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetcher)
  const init = { method: 'POST', credentials: 'same-origin' as const }
  await customerFetch('/api/v1/public/entries/token/commands', init)
  expect(fetcher).toHaveBeenCalledWith('/api/v1/public/entries/token/commands', init)
  expect(identity).not.toHaveBeenCalled()
})
it('uses explicit HTTPS mobile endpoints, the secret and no cookies/redirect/referrer', async () => {
  runtime.value = 'native'; vi.stubEnv('VITE_API_URL', 'https://app.example')
  const fetcher = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetcher)
  await customerFetch('/api/v1/public/services/q/entries', { method: 'POST', headers: { 'Idempotency-Key': 'key' }, credentials: 'include' })
  const [url, init] = fetcher.mock.calls[0]!
  expect(url).toBe('https://app.example/api/v1/mobile/services/q/entries')
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })
  expect(init.headers.get('Authorization')).toBe(`Bearer ${'ab'.repeat(32)}`)
  expect(init.headers.get('Idempotency-Key')).toBe('key')
})
it.each(['https://evil.example', '//evil.example', '/api/v1/public/entries/../../auth', '/api/v1/public/entries/%2e%2e', '/api/v1/staff', '/api/v1/public/entries?url=x', '/api/v1/public/search/extra', '/api/v1/public/search?text=a'])('rejects caller-controlled or unsupported destinations %s', path => {
  expect(() => nativeApiUrl(path, 'https://app.example')).toThrow()
})
it('maps only the exact search route to authenticated native POST, with query in the body', async () => {
  runtime.value = 'native'; vi.stubEnv('VITE_API_URL', 'https://app.example')
  const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] })); vi.stubGlobal('fetch', fetcher)
  await customerFetch('/api/v1/public/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hotel' }) })
  const [url, init] = fetcher.mock.calls[0]!
  expect(url).toBe('https://app.example/api/v1/mobile/search')
  expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', body: '{"text":"Hotel"}' })
  expect(init.headers.get('Authorization')).toBe(`Bearer ${'ab'.repeat(32)}`)
})
it.each(['', 'http://app.example', 'https://user:secret@app.example', 'https://app.example/api', 'https://app.example?secret=x'])('fails closed for invalid API origin %s', origin => {
  expect(() => nativeApiUrl('/api/v1/public/entries', origin)).toThrow()
})
it('push transport is native-only and rejects injected destinations before reading identity', async () => {
  const { nativePushFetch } = await import('./customer')
  await expect(nativePushFetch('/registration')).rejects.toThrow()
  runtime.value = 'native'; vi.stubEnv('VITE_API_URL', 'https://app.example')
  for (const path of ['//evil.invalid', '/registration?x=y', '/notices/../../auth', '/notices/' + 'ab'.repeat(32)]) await expect(nativePushFetch(path)).rejects.toThrow()
  expect(identity).not.toHaveBeenCalled()
  const fetcher = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetcher)
  await nativePushFetch('/registration', { method: 'POST' })
  expect(fetcher.mock.calls[0]![0]).toBe('https://app.example/api/v1/mobile/push/registration')
  expect(fetcher.mock.calls[0]![1].headers.get('Authorization')).toBe(`Bearer ${'ab'.repeat(32)}`)
})
