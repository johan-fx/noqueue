import { defineConfig } from '@playwright/test'
import demo from './demo.config.js'
export default defineConfig({ ...demo, outputDir: `${process.env.QUEUE_DEMO_DIR}/baseline-browser-results`, testMatch: '**/baseline.spec.ts' })
