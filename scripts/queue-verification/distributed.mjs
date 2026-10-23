import { isDeepStrictEqual } from 'node:util'
import { verdict } from './report.mjs'
import { required } from './results.mjs'

export const browsers = ['chromium', 'firefox', 'webkit']

export function mergeEvidence(inventory, parts, revision) {
  if (inventory.format !== 'queue-inventory-v1' || inventory.revision !== revision)
    throw new Error('Inventory revision/format mismatch')
  if (parts.length !== browsers.length + 1) throw new Error('Missing or extra verification parts')
  const scenarios = [], commands = []
  const identities = new Set()
  for (const part of parts) {
    if (part.format !== 'queue-verification-v2' || part.revision !== revision ||
        part.dirty !== false || part.profile !== 'ci-all' || part.passed !== true)
      throw new Error('Invalid, dirty, stale or failed verification part')
    const identity = part.phase === 'api' && part.project === null ? 'api'
      : part.phase === 'browser' && browsers.includes(part.project) ? part.project : null
    if (!identity || identities.has(identity)) throw new Error('Unexpected or duplicate verification part')
    identities.add(identity)
    const labels = part.commands.map((command) => command.label).sort()
    if (!isDeepStrictEqual(labels, identity === 'api' ? ['api', 'harness'] : ['browser']) ||
        part.commands.some((command) => command.code !== 0))
      throw new Error('Missing or failed commands')
    if (part.scenarios.some((scenario) => identity === 'api' ? scenario.browser != null : scenario.browser !== identity))
      throw new Error('Part contains evidence from another browser')
    scenarios.push(...part.scenarios)
    commands.push(...part.commands.map((command) => ({ ...command, label: `${identity}/${command.label}` })))
  }
  const expected = inventory.tests.map((item) => item.testKey).sort()
  const actual = scenarios.filter((item) => item.browser).map((item) => item.testKey).sort()
  if (!expected.length || new Set(expected).size !== expected.length ||
      !isDeepStrictEqual(expected, actual) ||
      browsers.some((browser) => !inventory.tests.some((item) => item.browser === browser)))
    throw new Error('Browser inventory is incomplete, duplicated or differs from executed tests')
  const coverage = required.filter((id) => id.startsWith('Q-BROWSER-')).every((id) =>
    browsers.every((browser) => scenarios.some((s) => s.id === id && s.browser === browser && s.status === 'passed' && s.steps.length)))
  if (!coverage || !verdict(required, scenarios)) throw new Error('Missing, skipped, flaky or contradictory evidence')
  return { format: 'queue-verification-v2', profile: 'ci-all', revision, dirty: false,
    expectedBrowsers: browsers, required, commands, scenarios, passed: true,
    browserReports: browsers.map((browser) => ({ label: browser, href: `${browser}/playwright/index.html` })) }
}
