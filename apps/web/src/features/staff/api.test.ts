import { afterEach, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it('bounds stalled reads, aborts transport and never retries', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(() => new Promise<Response>(() => undefined))
  vi.stubGlobal('fetch', fetcher)
  const result = expect(api('/me')).rejects.toMatchObject({ status: 503, code: 'temporarily_unavailable' })
  await vi.advanceTimersByTimeAsync(15_000)
  await result
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true)
})
it('rejects superseded reads even if transport ignores abort', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
  const controller = new AbortController()
  const result = expect(api('/me', 'GET', undefined, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await result
})
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

it.each([
  [
    'no_compatible_successor',
    'No hay otro turno compatible disponible. La lista no se ha modificado.',
  ],
  [
    'manual_attention_required',
    'Este turno requiere atención manual. Revisa la lista y gestiona el siguiente turno compatible.',
  ],
  [
    'turn_automatically_processed',
    'El sistema ya ha asignado este turno y ha avisado al siguiente cliente. La cola se actualizará automáticamente.',
  ],
  [
    'turn_automatically_assigned',
    'El sistema ya ha asignado este turno automáticamente. Actualiza la lista antes de continuar.',
  ],
])('localizes queue interaction error %s', async (code, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ error: code }, { status: 409 })),
  )
  await expect(api('/queues/q/entries')).rejects.toMatchObject({
    code,
    message,
  })
})
