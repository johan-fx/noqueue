import { createServer } from 'node:net'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

if (!process.env.NOQUEUE_PWA_PORT) {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  process.env.NOQUEUE_PWA_PORT = String(
    (server.address() as { port: number }).port,
  )
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

const origin = `http://127.0.0.1:${process.env.NOQUEUE_PWA_PORT}`
const reportRoot = process.env.QUEUE_REPORT_DIR

export default defineConfig({
  testDir: './pwa',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: reportRoot
    ? [
        ['html', { outputFolder: path.join(reportRoot, 'pwa-playwright'), open: 'never' }],
        ['json', { outputFile: path.join(reportRoot, 'pwa-playwright.json') }],
      ]
    : [['html', { outputFolder: 'playwright-report/pwa', open: 'never' }]],
  ...(reportRoot ? { outputDir: path.join(reportRoot, 'pwa-browser-results') } : {}),
  expect: { timeout: 15_000 },
  timeout: 60_000,
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel-7-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node ./pwa/server.mjs',
    url: `${origin}/__pwa_test__/version`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NOQUEUE_PWA_PORT: process.env.NOQUEUE_PWA_PORT },
  },
})
