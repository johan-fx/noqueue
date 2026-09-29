import { expect, it } from 'vitest'
import { queueLifecycleSchema } from './staff'
it('requires explicit counts and rejects duplicate group answers', () => {
  const input = {
    action: 'open',
    contextToken: 'token',
    groups: [{ spaceId: 'terrace', seats: 4, occupied: 0 }],
  }
  expect(queueLifecycleSchema.safeParse(input).success).toBe(true)
  expect(
    queueLifecycleSchema.safeParse({
      ...input,
      groups: [{ spaceId: 'terrace', seats: 4 }],
    }).success,
  ).toBe(false)
  expect(
    queueLifecycleSchema.safeParse({
      ...input,
      groups: [...input.groups, ...input.groups],
    }).success,
  ).toBe(false)
})
it('accepts initial in-place confirmation without a correction reason', () => {
  expect(
    queueLifecycleSchema.safeParse({
      action: 'confirm_inventory',
      contextToken: 'token',
      groups: [{ spaceId: 'terrace', seats: 4, occupied: 0 }],
    }).success,
  ).toBe(true)
})
it('accepts explicit operational intelligence policy commands', () => {
  for (const action of ['disable_intelligence', 'enable_intelligence'])
    expect(
      queueLifecycleSchema.safeParse({ action, contextToken: 'token' })
        .success,
    ).toBe(true)
})
