import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verdict, render } from './report.mjs'
test('missing, skipped, flaky, failed and unexecuted evidence cannot pass', () => {
  for (const status of ['failed', 'skipped', 'flaky', 'not-run'])
    assert.equal(
      verdict(['Q-1'], [{ id: 'Q-1', status, steps: [{}] }]),
      false,
    )
  assert.equal(verdict(['Q-1'], []), false)
  assert.equal(
    verdict(['Q-1'], [{ id: 'Q-1', status: 'passed', steps: [] }]),
    false,
  )
  assert.equal(
    verdict(
      ['Q-1'],
      [
        {
          id: 'Q-1',
          status: 'passed',
          steps: [{ actual: 1, expected: 1 }],
        },
      ],
    ),
    true,
  )
})
test('malformed or contradictory evidence never passes despite a passed status', () => {
  for (const steps of [[{}], [{ actual: 1 }], [{ actual: 1, expected: 2 }]])
    assert.equal(
      verdict(['Q-1'], [{ id: 'Q-1', status: 'passed', steps }]),
      false,
    )
})
test('HTML escapes evidence and exposes incomplete status', () => {
  const html = render({
    passed: false,
    revision: 'abc',
    profile: 'standard',
    scenarios: [
      {
        id: 'Q-1',
        status: 'not-run',
        steps: [{ actual: '<script>', expected: 'ok' }],
      },
    ],
  })
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('not-run'))
})

test('command failures explain an otherwise passing scenario report', () => {
  const html = render({
    passed: false,
    revision: 'abc',
    profile: 'standard',
    commands: [{ label: 'harness', code: 1, durationMs: 100 }],
    scenarios: [],
  })
  assert.ok(html.includes('harness.log'))
  assert.ok(html.includes('Exit 1'))
})

test('HTML exposes escaped failure diagnostics and generated replay parameters', () => {
  const html = render({
    passed: false,
    revision: 'abc',
    profile: 'extended',
    scenarios: [
      {
        id: 'Q-SEQUENCES',
        status: 'failed',
        steps: [],
        errors: [
          'Property failed: seed=42 path="0:1" Counterexample: ["<skip>"]',
        ],
      },
    ],
  })
  assert.ok(html.includes('seed=42'))
  assert.ok(html.includes('path=&quot;0:1&quot;'))
  assert.ok(html.includes('&lt;skip&gt;'))
  assert.ok(!html.includes('<skip>'))
})

test('HTML distinguishes dirty revisions and includes the complete replay command', () => {
  const html = render({
    passed: false,
    dirty: true,
    revision: 'abc',
    profile: 'extended',
    scenarios: [
      {
        id: 'Q-SEQUENCES',
        status: 'failed',
        steps: [],
        replay: {
          command: 'QUEUE_SEQUENCE_LENGTH=100 QUEUE_PATH="0:1" pnpm test',
        },
      },
    ],
  })
  assert.ok(html.includes('working tree changes'))
  assert.ok(html.includes('QUEUE_SEQUENCE_LENGTH=100'))
  assert.ok(html.includes('QUEUE_PATH=&quot;0:1&quot;'))
})
