import { expect, it } from 'vitest'
import { record } from './queue-evidence'
it('Q-EVIDENCE snapshots mutable model state at the assertion instant', ({
  task,
}) => {
  const model = ['first']
  record('Q-EVIDENCE', 'immutable timeline snapshot', 0, ['first'], model)
  model.push('later')
  const meta = task.meta as { queueEvidence: { expected: unknown }[] }
  expect(meta.queueEvidence[0]!.expected).toEqual(['first'])
})
