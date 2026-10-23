import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, verdict } from './report.mjs'
import { verificationEnvironment } from './environment.mjs'
import { required as allRequired, browserScenarios } from './results.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const extended = process.argv.includes('--extended'),
  all = process.argv.includes('--all')
const phase = process.argv.find((arg) => arg.startsWith('--phase='))?.slice(8) ?? 'all'
const project = process.argv.find((arg) => arg.startsWith('--project='))?.slice(10)
if (!['all', 'api', 'browser'].includes(phase) ||
    (phase !== 'all' && !all) ||
    (phase === 'browser' && !['chromium', 'firefox', 'webkit'].includes(project)) ||
    (phase !== 'browser' && project)) throw new Error('Invalid verification phase/project')
const required = phase === 'all' ? allRequired : allRequired.filter((id) =>
  id.startsWith('Q-BROWSER-') === (phase === 'browser'))
const directory = path.resolve(root, process.env.QUEUE_PART_DIR ??
  `queue-reports/${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`)
await mkdir(directory, { recursive: true })
console.log(`Queue report: ${directory}/index.html`)
const environment = verificationEnvironment(process.env, directory, { all, extended })
// Local verification can use bounded parallelism; CI retains its single-worker default.
const browserWorkers = process.env.QUEUE_BROWSER_WORKERS ?? '1'
if (!/^[1-8]$/.test(browserWorkers)) throw new Error('QUEUE_BROWSER_WORKERS must be 1–8')
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
if (phase !== 'browser') {
  await run('harness', [
    'exec',
    'node',
    '--test',
    'scripts/queue-verification/report.test.mjs',
    'scripts/queue-verification/isolation.test.mjs',
    'scripts/queue-verification/vitest-reporter.test.mjs',
    'scripts/queue-verification/replay.test.mjs',
    'scripts/queue-verification/progress-migration.test.mjs',
    'scripts/queue-verification/distributed.test.mjs',
    'scripts/ci/assets.test.mjs',
    'scripts/ci/workflow.test.mjs',
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
}
if (phase !== 'api') await run('browser', [
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
  ...(project ? [`--project=${project}`] : extended || all ? [] : ['--project=chromium']),
  `--workers=${browserWorkers}`,
  '--retries=0',
])
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
  scenarios.push(...browserScenarios(results))
} catch {
  /* Missing output never passes. */
}
for (const id of required)
  if (!scenarios.some((s) => s.id === id))
    scenarios.push({ id, status: 'not-run', steps: [] })
const browsers = phase === 'api' ? [] : project ? [project] :
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
  format: 'queue-verification-v2',
  phase,
  project: project ?? null,
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
