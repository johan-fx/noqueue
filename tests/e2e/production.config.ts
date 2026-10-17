import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './production', timeout: 30000, workers: 3, forbidOnly: Boolean(process.env.CI),
  outputDir: './test-results-production', reporter: 'list',
  use: { serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ],
})
