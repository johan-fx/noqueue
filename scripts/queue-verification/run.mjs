import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, verdict } from './report.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const extended = process.argv.includes('--extended'),
  all = process.argv.includes('--all')
const directory = path.resolve(
  root,
  'queue-reports',
  `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`,
)
await mkdir(directory, { recursive: true })
console.log(`Queue report: ${directory}/index.html`)
const environment = {
  ...process.env,
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  QUEUE_REPORT_DIR: directory,
  QUEUE_PROPERTY_RUNS: extended ? '2000' : '200',
  QUEUE_SEQUENCE_RUNS: extended ? '100' : '20',
  QUEUE_SEQUENCE_LENGTH: extended ? '100' : '25',
}
const commands = []
async function run(label, args) {
  const start = Date.now()
  let log = ''
  const code = await new Promise((resolve) => {
    const child = spawn('pnpm', args, {
      cwd: root,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stop = () => child.kill('SIGTERM')
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    for (const output of [child.stdout, child.stderr])
      output.on('data', (chunk) => {
        log += chunk
        process.stdout.write(chunk)
      })
    child.once('error', (error) => {
      log += String(error)
      resolve(1)
    })
    child.once('close', (code) => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve(code ?? 1)
    })
  })
  await writeFile(path.join(directory, `${label}.log`), log)
  commands.push({ label, args, code, durationMs: Date.now() - start })
}
await run('harness', [
  'exec',
  'node',
  '--test',
  'scripts/queue-verification/report.test.mjs',
  'scripts/queue-verification/isolation.test.mjs',
  'scripts/queue-verification/vitest-reporter.test.mjs',
  'scripts/queue-verification/replay.test.mjs',
  'scripts/queue-verification/progress-migration.test.mjs',
])
await run('api', [
  '--filter',
  '@noqueue/api',
  'exec',
  'vitest',
  'run',
  ...(all
    ? []
    : [
        'test/queue-history.test.ts',
        'test/queue-evidence.test.ts',
        'src/features/queue',
        'src/features/staff/opening.test.ts',
        'src/staff.test.ts',
        'src/vertical.test.ts',
      ]),
  '--reporter=default',
  '--reporter=../../scripts/queue-verification/vitest-reporter.mjs',
])
await run('browser', [
  '--filter',
  '@noqueue/e2e',
  'exec',
  'playwright',
  'test',
  ...(all
    ? []
    : [
        'specs/queue-verification.spec.ts',
        'specs/queue-opening.spec.ts',
        'specs/queue-services.spec.ts',
      ]),
  ...(extended || all ? [] : ['--project=chromium']),
  '--workers=1',
  '--retries=0',
])
const required = [
  'Q-EVIDENCE',
  'Q-PRODUCTION',
  'Q-ANCHOR',
  'Q-BOUNDARIES',
  'Q-CLOCK',
  'Q-COMMAND-LEARNING',
  'Q-SEQUENCES',
  'Q-PARALLEL',
  'Q-LEARNING',
  'Q-EXPIRY',
  'Q-PREFERENCES',
  'Q-PROPERTY',
  'Q-BROWSER-ORDER',
  'Q-BROWSER-RESOURCE',
  'Q-BROWSER-CLOSE',
  'Q-BROWSER-MEAN',
  'Q-BROWSER-LEARNING',
  'Q-BROWSER-PROGRESS',
]
let scenarios = []
try {
  scenarios = JSON.parse(
    await readFile(path.join(directory, 'api-evidence.json'), 'utf8'),
  ).map((s) => ({
    ...s,
    steps: s.steps.length
      ? s.steps
      : s.id.startsWith('Q-')
      ? []
      : [{ step: 'Vitest assertions', expected: 'passed', actual: s.status }],
  }))
} catch {
  /* Missing output becomes not-run below. */
}
try {
  const results = JSON.parse(
    await readFile(path.join(directory, 'playwright.json'), 'utf8'),
  )
  function visit(suite) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        const id = spec.title.match(/\bQ-[A-Z-]+\b/)?.[0] ?? spec.title
        const status =
          test.status === 'expected' &&
          test.results.every((r) => r.status === 'passed')
            ? 'passed'
            : test.status === 'flaky'
            ? 'flaky'
            : test.status === 'skipped'
            ? 'skipped'
            : 'failed'
        const steps = []
        for (const result of test.results)
          for (const a of result.attachments ?? [])
            if (a.name === 'queue-evidence' && a.body)
              steps.push(
                ...JSON.parse(Buffer.from(a.body, 'base64').toString()),
              )
        scenarios.push({
          id,
          browser: test.projectName,
          status,
          steps: steps.length
            ? steps
            : id.startsWith('Q-')
            ? []
            : [
                {
                  step: 'Playwright assertions',
                  expected: 'passed',
                  actual: status,
                },
              ],
        })
      }
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of results.suites) visit(suite)
} catch {
  /* Missing output never passes. */
}
for (const id of required)
  if (!scenarios.some((s) => s.id === id))
    scenarios.push({ id, status: 'not-run', steps: [] })
const browsers =
  extended || all ? ['chromium', 'firefox', 'webkit'] : ['chromium']
const browserCoverage = required
  .filter((id) => id.startsWith('Q-BROWSER-'))
  .every((id) =>
    browsers.every((browser) =>
      scenarios.some(
        (s) =>
          s.id === id &&
          s.browser === browser &&
          s.status === 'passed' &&
          s.steps.length,
      ),
    ),
  )
const report = {
  required,
  expectedBrowsers: browsers,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  profile: extended ? 'extended' : all ? 'ci-all' : 'standard',
  commands,
  scenarios,
  passed:
    browserCoverage &&
    commands.every((c) => c.code === 0) &&
    verdict(required, scenarios),
}
await writeFile(
  path.join(directory, 'evidence.json'),
  JSON.stringify(report, null, 2),
)
await writeFile(path.join(directory, 'index.html'), render(report))
const summary = `## Queue verification: ${
  report.passed ? 'passed' : 'needs attention'
}\n\nRevision: ${report.revision} (${
  report.dirty ? 'working tree changes' : 'clean'
})\n\n| Scenario | Browser | Result |\n|---|---|---|\n${scenarios
  .map(
    (s) =>
      `| ${s.id.replaceAll('|', '/')} | ${s.browser ?? 'Worker/D1'} | ${
        s.status
      } |`,
  )
  .join(
    '\n',
  )}\n\nDownload the queue-verification artifact and open index.html for expected/observed timelines. Synthetic data only; no live provider delivery is verified.\n`
await writeFile(path.join(directory, 'summary.md'), summary)
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
console.log(
  `\n${report.passed ? 'PASSED' : 'NEEDS ATTENTION'}: ${directory}/index.html`,
)
process.exitCode = report.passed ? 0 : 1
