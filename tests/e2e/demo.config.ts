import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'

if (!process.env.QUEUE_DEMO_DIR) throw new Error('Use pnpm demo:queue:all; demo output directory is required')
export default defineConfig({
  ...base,
  testDir: './demo',
  testMatch: process.env.QUEUE_DEMO_ADAPTIVE ? '**/adaptive.spec.ts' : '**/queue-order.spec.ts',
  timeout: process.env.QUEUE_DEMO_ADAPTIVE ? 1_200_000 : 600_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: `${process.env.QUEUE_DEMO_DIR}/browser-results`,
  projects: [{ name: 'queue-demo', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
})
