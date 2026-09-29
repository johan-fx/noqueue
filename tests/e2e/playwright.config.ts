import { defineConfig, devices } from '@playwright/test'

import { createServer } from 'node:net'
import path from 'node:path'

if (!process.env.NOQUEUE_E2E_PORT) {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  process.env.NOQUEUE_E2E_PORT = String(
    (server.address() as { port: number }).port,
  )
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
const reportRoot = process.env.QUEUE_REPORT_DIR
const origin = `http://127.0.0.1:${process.env.NOQUEUE_E2E_PORT ?? '8787'}`

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: reportRoot
    ? [
        [
          'html',
          { outputFolder: path.join(reportRoot, 'playwright'), open: 'never' },
        ],
        ['json', { outputFile: path.join(reportRoot, 'playwright.json') }],
      ]
    : [['html', { open: 'never' }]],
  ...(reportRoot
    ? { outputDir: path.join(reportRoot, 'browser-results') }
    : {}),
  expect: { timeout: 12_000 },
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      testIgnore: [
        '**/queue-services.spec.ts',
        '**/queue-swipe.spec.ts',
        '**/real-experiment.spec.ts',
      ],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: [
        '**/queue-services.spec.ts',
        '**/queue-swipe.spec.ts',
        '**/real-experiment.spec.ts',
      ],
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command:
      'pnpm --dir ../.. --filter @noqueue/web build && pnpm --dir ../.. --filter @noqueue/api dev:e2e',
    url: `${origin}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
