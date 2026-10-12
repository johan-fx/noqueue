import { describe, expect, it, vi } from 'vitest'
import { handleWorkerRequest } from './static-assets'

describe('Worker-first static asset handling', () => {
  it('turns the SPA HTML fallback for a missing JavaScript asset into a non-cacheable 404', async () => {
    const fetchAsset = vi.fn(async () =>
      new Response('<!doctype html><html><body>app shell</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )
    const fetchApplication = vi.fn()

    const response = await handleWorkerRequest(
      new Request('https://staging.noqueue-app.com/assets/PublicQueue-old.js'),
      fetchAsset,
      fetchApplication,
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain\b/i)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toBe('Not Found')
    expect(fetchAsset).toHaveBeenCalledOnce()
    expect(fetchApplication).not.toHaveBeenCalled()
  })

  it('returns an empty 404 body for HEAD requests to missing assets', async () => {
    const response = await handleWorkerRequest(
      new Request('https://staging.noqueue-app.com/assets/missing.css', {
        method: 'HEAD',
      }),
      async () =>
        new Response('<html>SPA fallback</html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      async () => new Response('application'),
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain\b/i)
    expect(await response.text()).toBe('')
  })

  it.each([401, 503])(
    'preserves upstream %i HTML errors instead of masking them as missing assets',
    async (status) => {
      const upstreamError = new Response('<html>upstream error</html>', {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
      const response = await handleWorkerRequest(
        new Request('https://staging.noqueue-app.com/assets/chunk.js'),
        async () => upstreamError,
        async () => new Response('application'),
      )

      expect(response).toBe(upstreamError)
      expect(response.status).toBe(status)
      expect(response.headers.get('Content-Type')).toMatch(/^text\/html\b/i)
      expect(await response.text()).toBe('<html>upstream error</html>')
    },
  )

  it('preserves successful static asset bodies, MIME types, and cache headers', async () => {
    const asset = new Response('export default 1', {
      status: 200,
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: '"asset-hash"',
      },
    })
    const response = await handleWorkerRequest(
      new Request('https://staging.noqueue-app.com/assets/chunk.js'),
      async () => asset,
      async () => new Response('application'),
    )

    expect(response).toBe(asset)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/javascript; charset=utf-8',
    )
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(response.headers.get('ETag')).toBe('"asset-hash"')
    expect(await response.text()).toBe('export default 1')
  })

  it('leaves API requests on the application handler', async () => {
    const fetchAsset = vi.fn()
    const fetchApplication = vi.fn(async () =>
      Response.json({ status: 'ok' }),
    )
    const request = new Request('https://staging.noqueue-app.com/api/v1/health')

    const response = await handleWorkerRequest(
      request,
      fetchAsset,
      fetchApplication,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(fetchAsset).not.toHaveBeenCalled()
    expect(fetchApplication).toHaveBeenCalledWith(request)
  })
})
