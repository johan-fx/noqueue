import { beforeEach, expect } from 'vitest'
type Step = {
  scenarioId: string
  step: string
  simulatedAt: number
  actual: unknown
  expected: unknown
}
let steps: Step[]
beforeEach(({ task }) => {
  steps = []
  ;(task.meta as { queueEvidence?: Step[] }).queueEvidence = steps
})
export function record(
  scenarioId: string,
  step: string,
  simulatedAt: number,
  actual: unknown,
  expected: unknown,
) {
  steps.push(
    structuredClone({ scenarioId, step, simulatedAt, actual, expected }),
  )
  expect(actual).toEqual(expected)
}
