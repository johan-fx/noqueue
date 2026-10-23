import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { requireSuccessfulJobs, requiredJobs } from './gate.mjs'

const bypass = /continue-on-error|(?:^|\s)(?:--grep(?:[=\s]|$)|-g(?:\s|$)|--retries(?:=|\s+)[1-9])|playwright install/
function validateWorkflow(workflow) {
  const expected = {
    checks: ['pnpm test:production && pnpm production:check', 'pnpm check-types', 'pnpm lint',
      "--filter '!@noqueue/api' --filter '!@noqueue/root' -r --if-present test", 'test:tools'],
    build: ['pnpm build', 'pnpm production:build', 'playwright test --list --reporter=json'],
    api: ['--all --phase=api'],
    browser: ['--all --phase=browser'],
    'production-browser': ['test:production', 'test:privacy', 'test:pwa'],
    android: ['git diff --exit-code -- apps/mobile', './gradlew assembleDebug'],
    verify: ['node scripts/ci/gate.mjs', 'node scripts/queue-verification/merge.mjs'],
  }
  for (const [name, commands] of Object.entries(expected)) {
    const job = workflow.jobs[name]
    assert.ok(job, `Missing job ${name}`)
    assert.equal(job.if, name === 'verify' ? 'always()' : undefined)
    for (const command of commands) {
      const step = job.steps.find((step) => step.run?.includes(command))
      assert.ok(step, `Missing coverage: ${command}`)
      assert.equal(step.if, undefined, `Conditional coverage: ${command}`)
    }
    assert.equal(job['continue-on-error'], undefined)
    for (const step of job.steps) {
      assert.equal(step['continue-on-error'], undefined)
      if (step.run) assert.doesNotMatch(step.run, bypass)
    }
  }
  assert.deepEqual(workflow.jobs.verify.needs, requiredJobs)
  assert.deepEqual(workflow.jobs.browser.strategy.matrix.browser, ['chromium', 'firefox', 'webkit'])
  assert.equal(workflow.jobs.browser.strategy['fail-fast'], false)
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}")
  assert.equal(workflow.concurrency.group,
    "ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}")
}

test('final CI gate requires every named job, including all browser matrix children', () => {
  const jobs = Object.fromEntries(requiredJobs.map((name) => [name, { result: 'success' }]))
  requireSuccessfulJobs(jobs)
  for (const name of requiredJobs) {
    for (const result of ['failure', 'cancelled', 'skipped', 'pending'])
      assert.throws(() => requireSuccessfulJobs({ ...jobs, [name]: { result } }), /Every CI job is required/)
    const missing = { ...jobs }; delete missing[name]
    assert.throws(() => requireSuccessfulJobs(missing), /Every CI job is required/)
  }
})

test('parsed workflow retains unconditional coverage, rejecting disabled steps and bypass flags', async () => {
  const source = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const workflow = parse(source)
  validateWorkflow(workflow)
  for (const mutate of [
    (w) => { w.jobs.api.if = false },
    (w) => { w.jobs.api.steps.find((s) => s.run).if = false },
    (w) => { w.jobs.api.steps = w.jobs.api.steps.filter((s) => !s.run) },
    (w) => { w.jobs.browser.steps.find((s) => s.run).run += ' --retries 2' },
    (w) => { w.jobs.browser.steps.find((s) => s.run).run += ' -g smoke' },
  ]) {
    const changed = structuredClone(workflow); mutate(changed)
    assert.throws(() => validateWorkflow(changed), assert.AssertionError)
  }
  const lock = parse(await readFile(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'))
  for (const name of ['browser', 'production-browser']) {
    const version = workflow.jobs[name].container.image.match(/playwright:v(.+)-noble$/)[1]
    assert.ok(lock.packages[`playwright@${version}`], 'Container and locked Playwright versions must match')
  }
  const setup = parse(await readFile(new URL('../../.github/actions/setup-ci/action.yml', import.meta.url), 'utf8'))
  const trust = setup.runs.steps.find((step) => step.run?.includes('safe.directory'))
  assert.equal(trust.run, 'git config --global --add safe.directory "$GITHUB_WORKSPACE"')
  assert.equal(trust.if, undefined)
  assert.match(setup.runs.steps.find((step) => step.uses?.startsWith('pnpm/action-setup')).uses,
    /^pnpm\/action-setup@[0-9a-f]{40}$/)
})

test('symlinked CI entrypoints execute validation instead of silently succeeding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'noqueue-ci-cli-'))
  try {
    for (const name of ['assets', 'gate']) {
      const link = join(directory, `${name}.mjs`)
      await symlink(fileURLToPath(new URL(`./${name}.mjs`, import.meta.url)), link)
      const result = spawnSync(process.execPath, [link], { encoding: 'utf8', env: { ...process.env, JOB_RESULTS: '{}' } })
      assert.equal(result.status, 1)
      assert.match(result.stderr, name === 'assets' ? /Use assets.mjs write\|verify/ : /Every CI job is required/)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
