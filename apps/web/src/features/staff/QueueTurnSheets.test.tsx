import '@testing-library/jest-dom/vitest'
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueueTurnSheets } from './QueueTurnSheets'
import type { QueueSummary, StaffEntry } from '@noqueue/contracts/staff'

afterEach(cleanup)
const entry: StaffEntry = { id: 'selected', code: 'A024', displayName: 'María García', partySize: 4, status: 'waiting', sequence: 3, version: 0, calledAt: null, space: { id: 'i', name: 'Interior', source: 'preferred' } }
const candidate: StaffEntry = { ...entry, id: 'earlier', code: 'A022', displayName: 'Jesús Fernández', partySize: 3, sequence: 1, waitingSince: Date.now() - 1200000 }
const queue = { id: 'q', config: { type: 'restaurant', automaticAssignmentEnabled: true, spaces: [{ id: 'i', name: 'Interior', tables: 2, tableTypes: [{ seats: 4, count: 1 }, { seats: 6, count: 1 }] }] } } as QueueSummary
function props(overrides: Partial<ComponentProps<typeof QueueTurnSheets>> = {}): ComponentProps<typeof QueueTurnSheets> {
  return { queue, automationSnapshot: null, managedOpen: false, managedActions: [], managedIsNext: false, pending: { queueId: 'q', entryId: entry.id, action: 'call', key: 'intent' }, pendingQueue: queue, pendingEntry: entry, busy: false, commandUncertain: false, commandStale: false, pendingActionUnavailable: false, validSeating: true, olderAssignmentWarning: true, olderCompatibleCandidates: [candidate], automaticConflict: null, commandError: '', restaurantAssignment: true, seatingOptions: [{ spaceId: 'i', name: 'Interior', seats: [4, 6] }], seating: { mode: 'confirmed', spaceId: 'i', seats: 4 }, arrivalMode: 'notify', returnFocus: () => null, onManagedOpenChange: vi.fn(), onPendingOpenChange: vi.fn(), onAction: vi.fn(), onConfirm: vi.fn(), onBack: vi.fn(), onDismissAutomaticConflict: vi.fn(), onSelectCandidate: vi.fn(), onSeatingChange: vi.fn(), onArrivalModeChange: vi.fn(), ...overrides }
}
describe('compact older assignment warning', () => {
  it('uses shadcn Alert, separates candidates and hides duplicated identity/options', () => {
    render(<QueueTurnSheets {...props()} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'alert')
    expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('Hay turnos de otras capacidades')
    expect(within(alert).queryByText('Jesús Fernández')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Turnos compatibles anteriores' })).toHaveTextContent('Jesús Fernández')
    expect(screen.queryByText('María García')).not.toBeInTheDocument()
    expect(screen.queryByText('A024')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Mesa para' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Cliente' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Si vence el plazo/)).not.toBeInTheDocument()
    expect(screen.getByText('4 personas')).toHaveClass('font-semibold')
  })
  it('preserves confirmation, candidate selection, back and close handlers without changing seating or arrival mode', () => {
    const p = props({ arrivalMode: 'present' })
    render(<QueueTurnSheets {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(p.onConfirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }))
    expect(p.onSelectCandidate).toHaveBeenCalledWith(candidate)
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(p.onBack).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onPendingOpenChange).toHaveBeenCalledWith(false, expect.anything())
    expect(p.onSeatingChange).not.toHaveBeenCalled()
    expect(p.onArrivalModeChange).not.toHaveBeenCalled()
  })
  it('keeps same-capacity copy distinct', () => {
    render(<QueueTurnSheets {...props({ olderCompatibleCandidates: [{ ...candidate, partySize: 4 }] })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Hay turnos compatibles')
  })
  it.each(['commandStale', 'pendingActionUnavailable', 'busy'] as const)('preserves %s confirmation guard', (guard) => {
    render(<QueueTurnSheets {...props({ [guard]: true })} />)
    expect(screen.getByRole('button', { name: guard === 'busy' ? 'Guardando…' : 'Confirmar' })).toBeDisabled()
    if (guard === 'busy') {
      expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Asignar' })).toBeDisabled()
    }
  })
  it('preserves invalid seating guard and a way back', () => {
    render(<QueueTurnSheets {...props({ validSeating: false })} />)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Volver' })).toBeEnabled()
  })
  it('keeps uncertain retries enabled and candidate changes disabled', () => {
    render(<QueueTurnSheets {...props({ commandUncertain: true, commandStale: true, commandError: 'Reintenta la misma acción.' })} />)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Asignar' })).toBeDisabled()
    expect(screen.getByText('Reintenta la misma acción.')).toBeVisible()
  })
  it('keeps ordinary assignment identity and selectors', () => {
    render(<QueueTurnSheets {...props({ olderAssignmentWarning: false })} />)
    expect(screen.getByText('María García')).toBeVisible()
    expect(screen.getByRole('group', { name: 'Cliente' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Mesa para' })).toBeVisible()
  })
  it('keeps automatic conflict authoritative instead of the warning', () => {
    render(<QueueTurnSheets {...props({ automaticConflict: 'processed' })} />)
    expect(screen.getByRole('heading', { name: 'Turno ya procesado' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeVisible()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
  })
})

describe('called turn sheets G03/G04', () => {
  afterEach(() => vi.restoreAllMocks())
  const called: StaffEntry = { ...entry, status: 'called', calledAt: 1000, arrivalDeadlineAt: 1_150_000, assignedSeating: { spaceId: 'i', spaceName: 'Interior', seats: 4 } }
  function managed(overrides: Partial<ComponentProps<typeof QueueTurnSheets>> = {}) {
    return props({ pending: null, managedOpen: true, managedEntry: called, managedActions: ['complete', 'pass', 'cancel'], ...overrides })
  }
  it.each([false, true])('uses compact called layout (automatic=%s), retaining all command callbacks', (automatic) => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const managedEntry = automatic ? { ...called, automationCycle: { id: 'cycle', state: 'active' as const, attempt: 2, capacity: 4, receptionService: null, reason: null } } : called
    const p = managed({ managedEntry })
    render(<QueueTurnSheets {...p} />)
    expect(screen.getByText('María García', { exact: true })).toBeVisible()
    expect(screen.getByText('Tiempo para confirmar llegada')).toBeVisible()
    expect(screen.getByText('2:30')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument()
    expect(screen.getByText('Mesa para 4')).toHaveClass('sr-only')
    if (automatic) expect(screen.getByText(/Ciclo automático/)).toHaveClass('sr-only')
    for (const [label, action] of [['Confirmar llegada', 'complete'], ['Pasar turno', 'pass'], ['Cancelar turno', 'cancel']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(p.onAction).toHaveBeenCalledWith(managedEntry, action)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onManagedOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })
  it('retains server clock correction and no-deadline fallback', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const p = managed({ automationSnapshot: { configured: true, effective: true, activeCycles: 1, serverNow: 1_030_000, observedAt: 1_000_000 } })
    const view = render(<QueueTurnSheets {...p} />)
    expect(screen.getByText('2:00')).toBeVisible()
    view.rerender(<QueueTurnSheets {...p} managedEntry={{ ...called, arrivalDeadlineAt: null }} />)
    expect(screen.queryByText('Tiempo para confirmar llegada')).not.toBeInTheDocument()
  })
  it('keeps busy and permission guards', () => {
    const p = managed({ busy: true })
    const view = render(<QueueTurnSheets {...p} />)
    for (const name of ['Confirmar llegada', 'Pasar turno', 'Cancelar turno']) expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument()
    view.rerender(<QueueTurnSheets {...p} busy={false} canOperate={false} />)
    expect(screen.getByRole('heading', { name: 'Detalle del turno' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Confirmar llegada' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver' })).toBeVisible()
  })
  it('does not hide paused-cycle detail', () => {
    render(<QueueTurnSheets {...managed({ managedEntry: { ...called, automationCycle: { id: 'cycle', state: 'stopped', reason: 'disabled', capacity: 4, receptionService: null } } })} />)
    expect(screen.getByText('Ciclo pausado')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Volver' })).toBeVisible()
  })
})
