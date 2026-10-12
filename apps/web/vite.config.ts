import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export const pwaOptions = {
  // Registration is coordinated by the app. In particular, do not inject the
  // plugin's convenience register script, which would bypass the multi-tab gate.
  registerType: 'prompt' as const,
  injectRegister: null,
  devOptions: { enabled: false },
  // Keep an update in the waiting state until the requesting page confirms it
  // is the only open window client. The custom imported listener performs that
  // check before calling skipWaiting().
  workbox: {
    skipWaiting: false,
    clientsClaim: true,
    importScripts: ['/noqueue-update-gate.js'],
    // Auth verification links must reach the Worker, never the SPA navigation fallback.
    navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/assets(?:\/|$)/],
  },
  manifest: {
    name: 'No Queue',
    short_name: 'No Queue',
    description: 'Join and follow a venue queue without waiting in line.',
    display: 'standalone' as const,
    theme_color: '#ffffff',
    background_color: '#ffffff',
  },
}

export default defineConfig({
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA(pwaOptions),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
})
