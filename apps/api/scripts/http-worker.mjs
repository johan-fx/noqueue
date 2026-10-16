import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const hopHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])

// getWorker().fetch deliberately bypasses the assets router. Preserve the
// configured worker-first paths and send all other paths to the real ASSETS
// binding (including its SPA fallback), not to a mock/static file server.
export function routeWorkerRequest(patterns, worker, assets) {
  if (!Array.isArray(patterns) || patterns.some((p) => !/^\/[^*]+\/\*$/.test(p))) {
    throw new Error('Unsupported E2E worker-first routing configuration')
  }
  const prefixes = patterns.map((pattern) => pattern.slice(0, -1))
  return (url, init) => prefixes.some((prefix) => new URL(url).pathname.startsWith(prefix))
    ? worker.fetch(url, init)
    : assets.fetch(url, init)
}

/** Local test transport only. One incoming request causes exactly one dispatch. */
export function createWorkerServer(dispatch, origin) {
  return createServer(async (request, response) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.once('aborted', abort)
    try {
      const url = new URL(request.url, origin)
      if (url.origin !== origin) {
        response.writeHead(400).end()
        return
      }
      const excluded = new Set([
        ...hopHeaders, 'host',
        ...(request.headers.connection ?? '').toLowerCase().split(',').map((v) => v.trim()),
      ])
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (excluded.has(name) || value === undefined) continue
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item)
      }
      const result = await dispatch(url.href, {
        method: request.method,
        headers,
        signal: controller.signal,
        redirect: 'manual',
        ...(!['GET', 'HEAD'].includes(request.method)
          ? { body: Readable.toWeb(request), duplex: 'half' }
          : {}),
      })
      response.statusCode = result.status
      for (const [name, value] of result.headers) {
        if (!hopHeaders.has(name) && name !== 'set-cookie') response.setHeader(name, value)
      }
      const cookies = result.headers.getSetCookie()
      if (cookies.length) response.setHeader('set-cookie', cookies)
      if (request.method === 'HEAD' || !result.body) {
        await result.body?.cancel()
        response.end()
      } else {
        await pipeline(Readable.fromWeb(result.body), response)
      }
    } catch {
      // Do not replay mutations, hide failures, or log bodies/credentials.
      if (response.headersSent) response.destroy()
      else {
        for (const name of response.getHeaderNames()) response.removeHeader(name)
        response.writeHead(500, { 'content-type': 'text/plain' }).end('Local test worker dispatch failed')
      }
    } finally {
      request.off('aborted', abort)
    }
  })
}
