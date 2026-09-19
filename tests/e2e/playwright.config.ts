import { defineConfig, devices } from '@playwright/test'

const origin = `http://127.0.0.1:${process.env.NOQUEUE_E2E_PORT ?? '8787'}`

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: 'html',
  use: {
    baseURL: origin,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command:
      'pnpm --dir ../.. --filter @noqueue/web build && pnpm --dir ../.. --filter @noqueue/api dev:e2e',
    url: `${origin}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
