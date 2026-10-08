import type { Request } from '@playwright/test'
import type { Page } from '../fixtures.js'

export type ApiMockResponse = {
  status?: number
  json: unknown
  abort?: boolean
}

export type ApiMockRoute = {
  method: string
  path: string
  expectedHits?: number | { min: number; max?: number }
  respond: (request: Request) => ApiMockResponse | Promise<ApiMockResponse>
}

const requestKey = (method: string, pathname: string) =>
  `${method.toUpperCase()} ${pathname}`

export async function strictApiMocks(page: Page, cases: ApiMockRoute[]) {
  const routes = new Map<string, ApiMockRoute>()
  for (const mock of cases) {
    const key = requestKey(mock.method, mock.path)
    if (routes.has(key)) throw new Error(`Duplicate API mock: ${key}`)
    routes.set(key, mock)
  }

  const hits = new Map<string, number>()
  const unexpected: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const key = requestKey(request.method(), url.pathname)
    const mock = routes.get(key)
    if (!mock) {
      unexpected.push(key)
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'UNEXPECTED_API_REQUEST',
          error: 'unexpected_api_request',
          method: request.method(),
          path: url.pathname,
        }),
      })
      return
    }

    hits.set(key, (hits.get(key) ?? 0) + 1)
    const response = await mock.respond(request)
    if (response.abort) {
      await route.abort()
      return
    }
    await route.fulfill({
      status: response.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response.json),
    })
  })

  return {
    hits,
    unexpected,
    async assertComplete() {
      if (unexpected.length) {
        throw new Error(`Unexpected API requests: ${unexpected.join(', ')}`)
      }
      const missing: string[] = []
      const excessive: string[] = []
      for (const [key, mock] of routes) {
        const expectation = mock.expectedHits
        if (expectation === undefined) continue
        const count = hits.get(key) ?? 0
        const min = typeof expectation === 'number' ? expectation : expectation.min
        const max = typeof expectation === 'number' ? expectation : expectation.max
        if (count < min) missing.push(`${key}: ${count} < ${min}`)
        if (max !== undefined && count > max)
          excessive.push(`${key}: ${count} > ${max}`)
      }
      if (missing.length || excessive.length) {
        throw new Error(
          [
            missing.length ? `Missing expected API hits: ${missing.join(', ')}` : '',
            excessive.length ? `Excess API hits: ${excessive.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('; '),
        )
      }
    },
  }
}
