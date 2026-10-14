import { expect, it } from 'vitest'
import { availabilityText, publicWaitText, visualWaitingTurns, waitingTurnsText } from './availability'
it('separates public service closure, direct access, pause, cutoff, capacity and unknown ETA', () => {
  const service = {
    serviceOpen: true,
    queueState: 'active' as const,
    canJoin: true,
    blockReason: null,
    waitingPeople: 0,
    waitingTurns: 0,
    initialWaitingMarker: true,
    open: 1,
  }
  expect(visualWaitingTurns(service)).toBe(1)
  expect(availabilityText(service, 'es', null)).toBe(
    'Lista activa · Sin estimación',
  )
  expect(visualWaitingTurns({ ...service, waitingPeople: 9, waitingTurns: 3 })).toBe(3)
  expect(
    availabilityText(
      { ...service, queueState: 'inactive', canJoin: false },
      'es',
      null,
    ),
  ).toBe('Acceso directo · Sin inscripción')
  expect(
    availabilityText(
      { ...service, queueState: 'inactive', waitingPeople: 3, canJoin: false },
      'es',
      null,
    ),
  ).toBe('Turnos pendientes · Sin nuevas inscripciones')
  expect(
    availabilityText(
      { ...service, queueState: 'paused', canJoin: false },
      'es',
      null,
    ),
  ).toBe('Lista pausada')
  expect(
    availabilityText(
      { ...service, blockReason: 'cutoff', canJoin: false },
      'es',
      null,
    ),
  ).toBe('Inscripciones finalizadas')
  expect(availabilityText({ ...service, serviceOpen: false }, 'es', null)).toBe(
    'Servicio cerrado',
  )
})

const active = { serviceOpen: true, queueState: 'active' as const, canJoin: true, blockReason: null }
const states = [
  { ...active, serviceOpen: false, blockReason: 'closed' as const },
  { ...active, queueState: 'inactive' as const, blockReason: 'inactive' as const },
  { ...active, queueState: 'paused' as const, blockReason: 'paused' as const },
  { ...active, blockReason: 'cutoff' as const },
  { ...active, blockReason: 'capacity' as const },
  { ...active, queueState: 'paused' as const, blockReason: 'cutoff' as const },
].map((state) => ({ ...state, canJoin: false }))

it.each(states)('hides zero but preserves real turns in blocked state %j', (state) => {
  expect(visualWaitingTurns({ ...state, waitingTurns: 0 })).toBeNull()
  expect(waitingTurnsText({ ...state, waitingTurns: 0 }, 'es')).toBeNull()
  for (const waitingTurns of [1, 2, 4]) {
    expect(visualWaitingTurns({ ...state, waitingTurns })).toBe(waitingTurns)
  }
})
it.each([[0, 1], [1, 1], [2, 2]])('floors %i real turns as %i only with explicit admission', (real, visible) => {
  expect(visualWaitingTurns({ ...active, waitingTurns: real, waitingPeople: 20 })).toBe(visible)
})
it('never infers turns from people or missing admission data', () => {
  expect(visualWaitingTurns({ ...active, waitingPeople: 4 })).toBeNull()
  expect(visualWaitingTurns({ waitingTurns: 0 })).toBeNull()
  expect(visualWaitingTurns({ ...active, canJoin: undefined, waitingTurns: 0 })).toBeNull()
  expect(visualWaitingTurns({ ...active, blockReason: undefined, waitingTurns: 0 })).toBeNull()
  expect(visualWaitingTurns({ waitingTurns: 2, waitingPeople: 8 })).toBe(2)
})
it.each(['es', 'en'] as const)('formats singular/plural in %s without counting group members', (locale) => {
  expect(waitingTurnsText({ ...active, waitingTurns: 1, waitingPeople: 4 }, locale)).toBe(
    locale === 'es' ? '1 turno en lista de espera' : '1 turn waiting',
  )
  expect(waitingTurnsText({ ...active, waitingTurns: 2, waitingPeople: 6 }, locale)).toBe(
    locale === 'es' ? '2 turnos en lista de espera' : '2 turns waiting',
  )
})
it('labels configured fallback as provisional on public surfaces', () => {
  expect(availabilityText({ serviceOpen: true, queueState: 'active', averageWaitQuality: 'provisional' }, 'es', 4)).toBe('Lista activa · 4 min · Estimación provisional')
})

it('formats navigation ETA without expanding the Figma row', () => {
  expect(publicWaitText(25, 'es', true)).toBe('25min')
  expect(publicWaitText(null, 'en', true)).toBe('—')
  expect(publicWaitText(30, 'es')).toBe('Ahora, media de espera 30 minutos')
  expect(publicWaitText(1, 'en')).toBe('Current average wait 1 minute')
})

it('rounds public estimates to the nearest minute before formatting', () => {
  expect(publicWaitText(5.223045783132531, 'es')).toBe(
    'Ahora, media de espera 5 minutos',
  )
  expect(publicWaitText(5.5, 'es')).toBe('Ahora, media de espera 6 minutos')
  expect(publicWaitText(5.223045783132531, 'en', true)).toBe('5min')
  expect(publicWaitText(5.5, 'en', true)).toBe('6min')
  expect(publicWaitText(0.5, 'es')).toBe('Ahora, media de espera 1 minuto')
  expect(publicWaitText(0.5, 'en')).toBe('Current average wait 1 minute')
})

it('uses the same rounded minute in active availability titles', () => {
  expect(availabilityText({ serviceOpen: true, queueState: 'active' }, 'es', 5.223045783132531)).toBe(
    'Lista activa · 5 min',
  )
  expect(availabilityText({ serviceOpen: true, queueState: 'active' }, 'en', 5.5)).toBe(
    'Waiting list active · 6 min',
  )
  expect(availabilityText({ serviceOpen: true, queueState: 'active' }, 'es', 0.5)).toBe(
    'Lista activa · 1 min',
  )
})
