import { afterEach, expect, it } from 'vitest'
import {
  qrDestination,
  recentServiceIds,
  visitService,
} from './discovery-state'
afterEach(() => localStorage.clear())
it('only accepts same-origin queue/venue QR links, rejecting tokens, credentials and external links', () => {
  const origin = 'https://noqueue.test'
  for (const value of [
    '/q/demo-queue',
    origin + '/q/service-id',
    origin + '/v/venue-id',
  ])
    expect(qrDestination(value, origin)).not.toBeNull()
  for (const value of [
    'https://foreign.test/q/id',
    '/staff',
    '/t/secret',
    'javascript:alert(1)',
    '//foreign.test/q/id',
    origin + '/q/id/extra',
    'https://user:password@noqueue.test/q/id',
    origin + '/q/id?token=secret',
  ])
    expect(qrDestination(value, origin)).toBeNull()
})
it('persists only the three most recent service identities and tolerates corrupt storage', () => {
  for (const id of ['a', 'b', 'c', 'd', 'b']) visitService(id)
  expect(recentServiceIds()).toEqual(['b', 'd', 'c'])
  expect(JSON.parse(localStorage.getItem('noqueue.recent-services')!)).toEqual([
    'b',
    'd',
    'c',
  ])
  localStorage.setItem('noqueue.recent-services', 'not json')
  expect(recentServiceIds()).toEqual([])
})
