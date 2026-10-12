import { expect, test } from '@playwright/test'

test('Worker serves real missing-asset 404s without breaking SPA links or API routing', async ({ request }) => {
  const missing = await request.get('/assets/PublicQueue-no-such-build.js')
  expect(missing.status()).toBe(404)
  expect(missing.headers()['content-type']).not.toContain('text/html')
  expect(missing.headers()['cache-control']).toBe('no-store')
  expect(await missing.text()).not.toContain('<!doctype html>')

  const head = await request.head('/assets/missing-style.css')
  expect(head.status()).toBe(404)
  expect(await head.body()).toHaveLength(0)

  for (const route of ['/', '/q/example?lang=en', '/t/example?lang=es']) {
    const response = await request.get(route)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    const html = await response.text()
    const script = html.match(/<script[^>]+src="(\/assets\/[^\"]+\.js)"/)
    expect(script).not.toBeNull()
    const module = await request.get(script![1]!)
    expect(module.status()).toBe(200)
    expect(module.headers()['content-type']).toMatch(/(?:java|ecma)script/)
  }

  const health = await request.get('/api/v1/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ status: 'ok' })
})
