import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { StaffEntry } from '@noqueue/contracts/staff'
import { QueueCycleDetails } from './QueueCycleDetails'

afterEach(cleanup)
const entry: StaffEntry = { id: 'e', code: 'T1', status: 'completed', sequence: 1, version: 1, calledAt: null, partySize: 2,
  automationCycle: { id: 'c', state: 'stopped', reason: 'arrived', capacity: 4, receptionService: null } }
it.each([
  ['arrived', 'Se confirmó la llegada de este turno.'],
  ['cancelled', 'El personal canceló una asignación de este ciclo.'],
  ['no_candidate', 'No se encontraron candidatos compatibles.'],
  ['no_show', 'No se encontró una alternativa compatible.'],
  ['missing_context', 'Falta información para encontrar una alternativa compatible.'],
  ['context_changed', 'Cambió el contexto de compatibilidad de la asignación.'],
  ['service_ended', 'Se cerró el servicio.'],
  ['disabled', 'Se desactivó la gestión automática.'],
  ['legacy', 'Este turno no tiene un ciclo automático activo.'],
  [null, 'Este ciclo ya no tiene una asignación automática activa.'],
])('preserves %s context in paused-cycle details', (reason, text) => {
  render(<QueueCycleDetails entry={{ ...entry, automationCycle: { ...entry.automationCycle!, reason } }} />)
  expect(screen.getByText('Ciclo pausado')).toBeVisible()
  expect(screen.getByText(text!)).toBeVisible()
  expect(screen.queryByText(/finalizado|detenido/)).not.toBeInTheDocument()
})
it('does not attribute another customer arrival to a waiting entry', () => {
  render(<QueueCycleDetails entry={{ ...entry, status: 'waiting' }} canOperate={false} />)
  expect(screen.getByText(/Este turno sigue en espera/)).toBeVisible()
  expect(screen.getByText(/El personal con permisos puede iniciar un nuevo ciclo/)).toBeVisible()
})
it('does not render paused explanations for active cycles', () => {
  const { container } = render(<QueueCycleDetails entry={{ ...entry, automationCycle: { ...entry.automationCycle!, state: 'active' } }} />)
  expect(container).toBeEmptyDOMElement()
})
