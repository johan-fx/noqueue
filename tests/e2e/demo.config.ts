import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'

if (!process.env.QUEUE_DEMO_DIR) throw new Error('Use pnpm demo:queue:order; demo output directory is required')
export default defineConfig({
  ...base,
  testDir: './demo',
  timeout: 150_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: `${process.env.QUEUE_DEMO_DIR}/browser-results`,
  projects: [{ name: 'queue-demo', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
})
