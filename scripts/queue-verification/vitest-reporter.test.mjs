import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import EvidenceReporter from './vitest-reporter.mjs'

test('final module inventory wins over duplicate or missing streaming callbacks', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'queue-reporter-'))
  const previous = process.env.QUEUE_REPORT_DIR
  process.env.QUEUE_REPORT_DIR = directory
  const testCase = (fullName) => ({
    fullName,
    result: () => ({ state: 'passed' }),
    meta: () => ({}),
  })
  const first = testCase('first'),
    second = testCase('second')
  try {
    const reporter = new EvidenceReporter()
    reporter.onTestCaseResult?.(first)
    reporter.onTestCaseResult?.(first)
    reporter.onTestRunEnd([
      { children: { allTests: () => [first, second] } },
    ])
    const evidence = JSON.parse(
      readFileSync(path.join(directory, 'api-evidence.json'), 'utf8'),
    )
    assert.deepEqual(
      evidence.map((item) => item.id),
      ['first', 'second'],
    )
  } finally {
    if (previous === undefined) delete process.env.QUEUE_REPORT_DIR
    else process.env.QUEUE_REPORT_DIR = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
