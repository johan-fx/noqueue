import { describe, expect, it } from 'vitest'
import config, { pwaOptions } from './vite.config.ts'

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

describe('Vite PWA update coordination', () => {
  it('uses a waiting worker and leaves registration under explicit app control', () => {
    expect(pwaOptions.registerType).toBe('prompt')
    expect(pwaOptions.injectRegister).toBeNull()
    expect(pwaOptions.devOptions.enabled).toBe(false)
    expect(pwaOptions.workbox).toMatchObject({
      skipWaiting: false,
      clientsClaim: true,
      importScripts: ['/noqueue-update-gate.js'],
    })
  })

  it('keeps API and missing static assets out of the SPA navigation fallback', () => {
    expect(pwaOptions.workbox.navigateFallbackDenylist).toEqual([
      /^\/api(?:\/|$)/,
      /^\/assets(?:\/|$)/,
    ])
  })
})
