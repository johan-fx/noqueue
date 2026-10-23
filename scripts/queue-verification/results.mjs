export const required = [
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

export function browserScenarios(results) {
  const scenarios = []
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (typeof spec.id !== 'string' || !spec.id || typeof test.projectName !== 'string' || !test.projectName)
          throw new Error('Browser test identity is missing')
        const id = spec.title.match(/\bQ-[A-Z-]+\b/)?.[0] ?? spec.title
        const status = test.status === 'expected' && test.results?.length > 0 &&
          test.results.every((result) => result.status === 'passed')
          ? 'passed' : test.status === 'flaky' ? 'flaky'
          : test.status === 'skipped' ? 'skipped' : 'failed'
        const steps = []
        for (const result of test.results ?? [])
          for (const attachment of result.attachments ?? [])
            if (attachment.name === 'queue-evidence' && attachment.body)
              steps.push(...JSON.parse(Buffer.from(attachment.body, 'base64').toString()))
        scenarios.push({
          id, testKey: `${test.projectName}:${spec.id}`, browser: test.projectName, status,
          steps: steps.length ? steps : id.startsWith('Q-') ? []
            : [{ step: 'Playwright assertions', expected: 'passed', actual: status }],
        })
      }
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of results.suites ?? []) visit(suite)
  return scenarios
}

export function browserInventory(results) {
  if (results.errors?.length) throw new Error('Browser inventory has collection errors')
  const items = browserScenarios(results).map(({ testKey, browser }) => ({ testKey, browser }))
  if (!items.length || new Set(items.map((item) => item.testKey)).size !== items.length)
    throw new Error('Empty or duplicated browser inventory')
  return items
}
