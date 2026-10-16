import { createServer } from 'node:net'
import { defineConfig, devices } from '@playwright/test'
if (!process.env.NOQUEUE_PRIVACY_PORT) {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.NOQUEUE_PRIVACY_PORT = String((server.address() as { port: number }).port)
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
const origin = `http://127.0.0.1:${process.env.NOQUEUE_PRIVACY_PORT}`
export default defineConfig({
  testDir: './privacy', testMatch: '**/*.spec.ts', timeout: 30000, workers: 3, forbidOnly: Boolean(process.env.CI),
  outputDir: './test-results-privacy', reporter: 'list', use: { trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }, { name: 'firefox', use: devices['Desktop Firefox'] }, { name: 'webkit', use: devices['Desktop Safari'] }],
  webServer: { command: 'node privacy/server.mjs', url: origin + '/production/fixture.js', timeout: 60000, env: { NOQUEUE_PRIVACY_PORT: process.env.NOQUEUE_PRIVACY_PORT } },
})
