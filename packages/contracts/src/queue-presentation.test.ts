import { expect, it } from 'vitest'
import { visibleWaitingCount } from './queue'

it.each([[0, 1], [1, 1], [2, 2], [9, 9]])('presents %i real turns as %i without adding a turn', (real, visible) => {
  expect(visibleWaitingCount(real)).toBe(visible)
})
