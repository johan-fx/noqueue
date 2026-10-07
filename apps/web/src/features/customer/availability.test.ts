import { expect, it } from 'vitest'
import { availabilityText, visualWaitingPeople } from './availability'
it('separates public service closure, direct access, pause, cutoff, capacity and unknown ETA', () => {
  const service = {
    serviceOpen: true,
    queueState: 'active' as const,
    canJoin: true,
    blockReason: null,
    waitingPeople: 0,
    initialWaitingMarker: true,
    open: 1,
  }
  expect(visualWaitingPeople(service)).toBe(1)
  expect(availabilityText(service, 'es', null)).toBe(
    'Lista activa · Sin estimación',
  )
  expect(visualWaitingPeople({ ...service, waitingPeople: 3 })).toBe(3)
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
