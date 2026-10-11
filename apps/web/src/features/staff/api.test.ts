import { afterEach, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
afterEach(() => vi.unstubAllGlobals())
it('classifies HTML 503 without exposing HTML or parser errors and recovers', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html>private upstream failure</html>', { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true })),
  )
  await expect(api('/queues/q/entries')).rejects.toMatchObject({
    status: 503,
    code: 'temporarily_unavailable',
    message: 'Servicio temporalmente no disponible. Inténtalo de nuevo.',
  })
  await expect(api('/queues/q/entries')).resolves.toEqual({ ok: true })
})
it('classifies malformed successful payloads safely', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('<html>bad</html>')),
  )
  await expect(api('/queues/q/entries')).rejects.toBeInstanceOf(ApiError)
})
