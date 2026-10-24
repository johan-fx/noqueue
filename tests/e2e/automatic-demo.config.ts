import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'
if (!process.env.QUEUE_DEMO_DIR || process.env.NOQUEUE_E2E_AUTO_REPLACEMENT !== 'true')
  throw new Error('Use pnpm demo:queue:automatic (isolated worker required)')
export default defineConfig({
  ...base,
  testDir: './demo', testMatch: '**/automatic.spec.ts', timeout: 900_000,
  retries: 0, workers: 1, maxFailures: 1, fullyParallel: false, reporter: [['list']],
  outputDir: `${process.env.QUEUE_DEMO_DIR}/browser-results`,
  projects: [{ name: 'automatic-demo', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' } }],
})
