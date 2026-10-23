import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { requireSuccessfulJobs, requiredJobs } from './gate.mjs'

test('final CI gate requires every named job, including all browser matrix children', () => {
  const jobs = Object.fromEntries(requiredJobs.map((name) => [name, { result: 'success' }]))
  requireSuccessfulJobs(jobs)
  for (const name of requiredJobs) {
    for (const result of ['failure', 'cancelled', 'skipped', 'pending'])
      assert.throws(() => requireSuccessfulJobs({ ...jobs, [name]: { result } }))
    const missing = { ...jobs }; delete missing[name]
    assert.throws(() => requireSuccessfulJobs(missing))
  }
})

test('workflow retains production, API, browser and native checks without retry/skip bypasses', async () => {
  const source = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  for (const command of ['pnpm test:production && pnpm production:check', 'pnpm check-types', 'pnpm lint',
    "--filter '!@noqueue/api' --filter '!@noqueue/root' -r --if-present test", 'pnpm build',
    'pnpm production:build', 'test:tools', 'test:production', 'test:privacy', 'test:pwa',
    'git diff --exit-code -- apps/mobile', './gradlew assembleDebug', '--all --phase=api',
    '--all --phase=browser', 'node scripts/queue-verification/merge.mjs',
    'browser: [chromium, firefox, webkit]', 'if: always()', "github.event_name == 'pull_request'"])
    assert.ok(source.includes(command), `Missing coverage: ${command}`)
  assert.doesNotMatch(source, /continue-on-error|--grep|--retries=[1-9]|playwright install/)
  const version = source.match(/mcr\.microsoft\.com\/playwright:v([^\s]+)-noble/)[1]
  const lock = await readFile(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.ok(lock.includes(`playwright@${version}:`), 'Container and locked Playwright versions must match')
})
