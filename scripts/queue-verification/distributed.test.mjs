import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeEvidence, browsers } from './distributed.mjs'
import { required, browserInventory, browserScenarios } from './results.mjs'
import { render } from './report.mjs'

function fixture() {
  const scenario = (id, browser) => ({ id, ...(browser ? { browser, testKey: `${browser}:${id}` } : {}),
    status: 'passed', steps: [{ actual: 1, expected: 1 }] })
  const parts = ['api', ...browsers].map((name) => ({
    format: 'queue-verification-v2', revision: 'commit', dirty: false, profile: 'ci-all', passed: true,
    phase: name === 'api' ? 'api' : 'browser', project: name === 'api' ? null : name,
    commands: (name === 'api' ? ['harness', 'api'] : ['browser']).map((label) => ({ label, code: 0 })),
    scenarios: required.filter((id) => id.startsWith('Q-BROWSER-') === (name !== 'api'))
      .map((id) => scenario(id, name === 'api' ? null : name)),
  }))
  // Ordinary tests must be inventoried too, not only Q-* sentinel scenarios.
  parts[1].scenarios.push(scenario('ordinary regression', 'chromium'))
  return { parts, inventory: { format: 'queue-inventory-v1', revision: 'commit',
    tests: parts.flatMap((part) => part.scenarios.filter((s) => s.browser).map(({ testKey, browser }) => ({ testKey, browser }))) } }
}
test('merges all browser/API evidence and retains every ordinary regression', () => {
  const { parts, inventory } = fixture()
  const report = mergeEvidence(inventory, parts, 'commit')
  assert.equal(report.passed, true)
  const html = render(report)
  for (const browser of browsers) assert.ok(html.includes(`${browser}/playwright/index.html`))
  assert.equal(report.scenarios.length, parts.flatMap((p) => p.scenarios).length)
})
for (const [label, mutate] of Object.entries({
  'missing part': ({ parts }) => parts.pop(),
  'duplicate part': ({ parts }) => { parts[3] = parts[2] },
  'stale part': ({ parts }) => { parts[1].revision = 'previous' },
  'stale inventory': ({ inventory }) => { inventory.revision = 'previous' },
  'dirty checkout': ({ parts }) => { parts[0].dirty = true },
  'partial profile': ({ parts }) => { parts[0].profile = 'standard' },
  'failed command': ({ parts }) => { parts[0].commands[0].code = 1 },
  'missing command': ({ parts }) => { parts[0].commands = [] },
  'missing ordinary test': ({ parts }) => parts[1].scenarios.pop(),
  'duplicate ordinary test': ({ parts }) => parts[1].scenarios.push(parts[1].scenarios.at(-1)),
  'wrong browser': ({ parts }) => { parts[1].scenarios[0].browser = 'webkit' },
  'skipped test': ({ parts }) => { parts[1].scenarios[0].status = 'skipped' },
  'flaky test': ({ parts }) => { parts[1].scenarios[0].status = 'flaky' },
  'missing evidence': ({ parts }) => { parts[0].scenarios[0].steps = [] },
  'contradictory evidence': ({ parts }) => { parts[0].scenarios[0].steps[0].actual = 2 },
})) test(`rejects ${label} even when a part claims it passed`, () => {
  const value = fixture(); mutate(value)
  assert.throws(() => mergeEvidence(value.inventory, value.parts, 'commit'))
})

test('parser does not treat an empty result as a pass and preserves attachment evidence', () => {
  const json = { suites: [{ specs: [{ id: 'one', title: 'Q-BROWSER-ORDER', tests: [{ projectName: 'chromium', status: 'expected', results: [] }] }] }] }
  assert.equal(browserScenarios(json)[0].status, 'failed')
  const test = json.suites[0].specs[0].tests[0]
  test.results = [{ status: 'passed', attachments: [{ name: 'queue-evidence', body: Buffer.from(JSON.stringify([{ actual: 1, expected: 1 }])).toString('base64') }] }]
  assert.deepEqual(browserScenarios(json)[0].steps, [{ actual: 1, expected: 1 }])
  assert.deepEqual(browserInventory(json), [{ testKey: 'chromium:one', browser: 'chromium' }])
  assert.throws(() => browserInventory({ suites: [] }))
  assert.throws(() => browserInventory({ ...json, errors: [{}] }))
  assert.throws(() => browserInventory({ suites: [...json.suites, ...json.suites] }))
})
