import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { replayMetadata } from './replay.mjs'
const require = createRequire(
  new URL('../../apps/api/package.json', import.meta.url),
)
const fc = require('fast-check')
const property = (length) =>
  fc.property(
    fc.array(fc.constantFrom('skip', 'cancel', 'serve', 'no_show'), {
      minLength: length,
      maxLength: length,
    }),
    (actions) => !actions.includes('no_show'),
  )

test('extended shrink replay retains the original generator shape and run counts', () => {
  const result = fc.check(property(100), { seed: 20260929, numRuns: 100 })
  assert.equal(result.failed, true)
  let error
  try {
    fc.assert(property(100), { seed: 20260929, numRuns: 100 })
  } catch (caught) {
    error = caught.message
  }
  const replay = replayMetadata(
    'Q-SEQUENCES',
    {
      QUEUE_PROPERTY_RUNS: '2000',
      QUEUE_SEQUENCE_RUNS: '100',
      QUEUE_SEQUENCE_LENGTH: '100',
    },
    [error],
  )
  assert.equal(replay.profile, 'extended')
  assert.equal(replay.sequenceLength, 100)
  assert.equal(replay.sequenceRuns, 100)
  assert.equal(replay.propertyRuns, 2000)
  assert.ok(replay.command.includes('QUEUE_SEQUENCE_LENGTH=100'))
  const repeated = fc.check(property(replay.sequenceLength), {
    seed: replay.seed,
    path: replay.path,
    numRuns: replay.sequenceRuns,
  })
  assert.deepEqual(repeated.counterexample, result.counterexample)
  assert.throws(
    () =>
      fc.check(property(25), {
        seed: replay.seed,
        path: replay.path,
        numRuns: 100,
      }),
    /Unable to replay/,
  )
})
