import { defineConfig } from '@playwright/test'
import demo from './demo.config.js'

export default defineConfig({
  ...demo,
  timeout: 180_000,
  testMatch: '**/ui-countdowns.spec.ts',
  outputDir: `${process.env.QUEUE_DEMO_DIR}/ui-browser-results`,
})
