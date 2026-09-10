import { describe, expect, it } from 'vitest'
import config from './vite.config.ts'

describe('Vite development API routing', () => {
  it('proxies same-origin /api requests to the local Wrangler server', () => {
    expect(config.server?.proxy).toMatchObject({
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    })
  })
})
