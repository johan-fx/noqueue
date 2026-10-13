import { expect, it } from 'vitest'
import { admissionFields, isActivePublicList, visibleWaitingCount } from './queue'
import { z } from 'zod'

it.each([[0, 1], [1, 1], [2, 2], [9, 9]])('presents %i real turns as %i without adding a turn', (real, visible) => {
  expect(visibleWaitingCount(real)).toBe(visible)
})

it('accepts legacy responses without a turn count and preserves both units', () => {
  const schema = z.object(admissionFields)
  expect(schema.parse({ waitingPeople: 4 })).toEqual({ waitingPeople: 4 })
  expect(schema.parse({ waitingPeople: 4, waitingTurns: 1 })).toEqual({ waitingPeople: 4, waitingTurns: 1 })
  expect(schema.parse({ waitingPeople: 0, waitingTurns: 0 }).waitingTurns).toBe(0)
  for (const waitingTurns of [-1, 1.5, null, '2']) {
    expect(schema.safeParse({ waitingTurns }).success).toBe(false)
  }
})

it('exposes only active lists in physically open services without conflating admission blocks', () => {
  expect(isActivePublicList({ serviceOpen: true, queueState: 'active' })).toBe(true)
  for (const queueState of ['active', 'paused', 'inactive'] as const) {
    expect(isActivePublicList({ serviceOpen: false, queueState })).toBe(false)
  }
  expect(isActivePublicList({ serviceOpen: true, queueState: 'paused' })).toBe(false)
  expect(isActivePublicList({ serviceOpen: true, queueState: 'inactive' })).toBe(false)
  expect(isActivePublicList({ serviceOpen: true })).toBe(false)
  expect(isActivePublicList({ queueState: 'active' })).toBe(false)
})

it('limits scheduled-closed visibility to venue selection and accepts older responses', async () => {
  const { isVisibleVenueService, publicServiceSchema } = await import('./queue')
  const service = publicServiceSchema.parse({ id: 'q', name: 'Restaurant', venueName: 'Venue', type: 'restaurant', open: 0, receptionServices: [], spaces: [], serviceOpen: false, queueState: 'inactive' })
  expect(isVisibleVenueService(service)).toBe(false)
  const closed = { ...service, nextOpening: { at: 2000, serverNow: 1000, localTime: '12:00' } }
  expect(publicServiceSchema.parse(closed).nextOpening).toEqual(closed.nextOpening)
  expect(isVisibleVenueService(closed)).toBe(true)
  expect(isActivePublicList(closed)).toBe(false)
  for (const queueState of ['paused', 'inactive'] as const)
    expect(isVisibleVenueService({ ...closed, serviceOpen: true, queueState })).toBe(false)
})
