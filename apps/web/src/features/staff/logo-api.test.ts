import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { deleteVenueLogo, getVenueLogo, putVenueLogo } from './logo-api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('venue logo API', () => {
  it.each([
    ['logo_dimensions_exceeded', '8 megapíxeles'],
    ['logo_image_memory_limit', 'demasiada memoria'],
    ['logo_image_complexity_limit', 'demasiados bloques'],
    ['logo_image_unsupported', 'variante de PNG'],
    ['logo_processing_busy', 'Espera unos segundos'],
    ['invalid_logo', 'está dañado'],
  ])(
    'explains %s without mislabelling a valid image as a bad format',
    async (code, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: code === 'logo_processing_busy' ? 503 : 400,
          json: async () => ({ error: code }),
          headers: { get: () => null },
        }),
      )
      await expect(
        putVenueLogo('venue', new File(['bytes'], 'logo.png'), 0, 'key'),
      ).rejects.toMatchObject({
        code,
        message: expect.stringContaining(message),
      })
    },
  )
  it('sends multipart data without overriding the browser boundary and keeps idempotency', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        logo: null,
        logoVersion: 1,
        canEditLogo: true,
      }),
      headers: { get: () => null },
    })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['png bytes'], 'brand.png', { type: 'image/png' })

    const result = await putVenueLogo('venue/1', file, 0, 'request-key')

    expect(result.logoVersion).toBe(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/staff/venues/venue%2F1/logo')
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ 'Idempotency-Key': 'request-key' })
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBe(file)
    expect((init.body as FormData).get('version')).toBe('0')
  })

  it('uses the expected GET and DELETE contracts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ logo: null, logoVersion: 2, canEditLogo: true }),
      headers: { get: () => null },
    })
    vi.stubGlobal('fetch', fetchMock)

    await getVenueLogo('venue-id')
    await deleteVenueLogo('venue-id', 1, 'delete-key')

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/staff/venues/venue-id/logo',
    )
    const deleteRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(deleteRequest.method).toBe('DELETE')
    expect(deleteRequest.headers).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'delete-key',
    })
    expect(deleteRequest.body).toBe(JSON.stringify({ version: 1 }))
  })

  it('exposes version conflicts to the editor without hiding their error code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'logo_version_conflict' }),
      headers: { get: () => null },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      api('/venues/venue-id/logo', 'DELETE', { version: 1 }, 'key'),
    ).rejects.toMatchObject({
      code: 'logo_version_conflict',
      status: 409,
    })
  })
})
