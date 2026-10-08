import { test, expect } from '../fixtures.js'
import { strictApiMocks } from '../helpers/api-mocks.js'

test.use({ serviceWorkers: 'block' })

test('strict API mocks match method and path and fail closed on unlisted calls', async ({
  page,
}) => {
  await page.goto('/')
  const mocks = await strictApiMocks(page, [
    {
      method: 'GET',
      path: '/api/v1/e2e/allowed',
      expectedHits: 1,
      respond: () => ({ json: { ok: true } }),
    },
  ])

  const allowed = await page.evaluate(async () => {
    const response = await fetch('/api/v1/e2e/allowed')
    return { status: response.status, body: await response.json() }
  })
  expect(allowed).toEqual({ status: 200, body: { ok: true } })

  const unexpected = await page.evaluate(async () => {
    const response = await fetch('/api/v1/e2e/not-listed', { method: 'POST' })
    return { status: response.status, body: await response.json() }
  })
  expect(unexpected).toEqual({
    status: 501,
    body: {
      code: 'UNEXPECTED_API_REQUEST',
      error: 'unexpected_api_request',
      method: 'POST',
      path: '/api/v1/e2e/not-listed',
    },
  })
  expect(mocks.unexpected).toEqual(['POST /api/v1/e2e/not-listed'])
  await expect(mocks.assertComplete()).rejects.toThrow('Unexpected API requests')
})

test('strict API mocks can simulate an expected transport failure without bypassing method/path tracking', async ({
  page,
}) => {
  await page.goto('/')
  const mocks = await strictApiMocks(page, [
    {
      method: 'GET',
      path: '/api/v1/e2e/offline',
      expectedHits: 1,
      respond: () => ({ json: null, abort: true }),
    },
  ])
  const result = await page.evaluate(async () => {
    try {
      await fetch('/api/v1/e2e/offline')
      return 'response'
    } catch {
      return 'network-error'
    }
  })
  expect(result).toBe('network-error')
  expect(mocks.unexpected).toEqual([])
  await mocks.assertComplete()
})
