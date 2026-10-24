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
  return { queue, automationSnapshot: null, managedOpen: false, managedActions: [], managedIsNext: false, pending: { queueId: 'q', entryId: entry.id, action: 'call', key: 'intent' }, pendingQueue: queue, pendingEntry: entry, busy: false, commandUncertain: false, commandStale: false, pendingActionUnavailable: false, validSeating: true, olderAssignmentWarning: true, olderCompatibleCandidates: [candidate], automaticConflict: null, commandError: '', restaurantAssignment: true, seatingOptions: [{ spaceId: 'i', name: 'Interior', seats: [4, 6] }], seating: { mode: 'confirmed', spaceId: 'i', seats: 4 }, returnFocus: () => null, onManagedOpenChange: vi.fn(), onPendingOpenChange: vi.fn(), onAction: vi.fn(), onConfirm: vi.fn(), onDismissAutomaticConflict: vi.fn(), onSelectCandidate: vi.fn(), onSeatingChange: vi.fn(), ...overrides }
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
  it('preserves confirmation, candidate selection, close handler without changing seating', () => {
    const p = props()
    render(<QueueTurnSheets {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(p.onConfirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }))
    expect(p.onSelectCandidate).toHaveBeenCalledWith(candidate)
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onPendingOpenChange).toHaveBeenCalledWith(false, expect.anything())
    expect(p.onSeatingChange).not.toHaveBeenCalled()
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
  it('preserves invalid seating guard and a way to close', () => {
    render(<QueueTurnSheets {...props({ validSeating: false })} />)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeEnabled()
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
    expect(screen.queryByRole('group', { name: 'Cliente' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeVisible()
  })
  it('does not hide paused-cycle detail', () => {
    render(<QueueTurnSheets {...managed({ managedEntry: { ...called, automationCycle: { id: 'cycle', state: 'stopped', reason: 'disabled', capacity: 4, receptionService: null } } })} />)
    expect(screen.getByText('Ciclo pausado')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeVisible()
  })
})

describe('shared manual and automatic sheet presentation', () => {
  const automationSnapshot = { configured: true, effective: true, activeCycles: 1, serverNow: 1000, observedAt: 1000 }
  const modeQueue = (automatic: boolean, type: 'restaurant' | 'reception' | 'pool' = 'restaurant') => ({
    ...queue, config: { ...queue.config, type, automaticAssignmentEnabled: automatic },
  }) as QueueSummary

  it.each(['restaurant', 'reception', 'pool'] as const)('shares frame, identity and controls in %s without leaking automatic copy', (type) => {
    const q = modeQueue(true, type)
    const p = props({ queue: q, pendingQueue: q, olderAssignmentWarning: false, automationSnapshot, restaurantAssignment: type === 'restaurant', pendingEntry: { ...entry, receptionService: 'check_in' } })
    const view = render(<QueueTurnSheets {...p} />)
    const presentation = () => ({
      frame: screen.getByRole('dialog').className,
      header: screen.getByRole('heading').className,
      identity: screen.getByText('María García').className,
      footer: screen.getByRole('button', { name: 'Asignar turno' }).closest('[data-slot="sheet-footer"]')?.className,
      controls: within(screen.getByRole('dialog')).getAllByRole('button').map(button => ({ text: button.textContent, className: button.className })),
    })
    const automaticPresentation = presentation()
    expect(screen.queryByText(/Si vence el plazo/)).not.toBeInTheDocument()
    const manualQueue = modeQueue(false, type)
    view.rerender(<QueueTurnSheets {...p} queue={manualQueue} pendingQueue={manualQueue} />)
    expect(presentation()).toEqual(automaticPresentation)
    expect(screen.queryByText(/Si vence el plazo/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Al asignar confirmas/)).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Cliente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Mesa para' }) !== null).toBe(type === 'restaurant')
    if (type === 'reception') expect(screen.queryByText('Check-in')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ya está presente' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Asignar turno' }))
    expect(p.onConfirm).toHaveBeenCalledOnce()
  })

  it.each([false, true])('preserves warning, selection and confirmation in automatic=%s', (automatic) => {
    const p = props({ pendingQueue: modeQueue(automatic), automationSnapshot })
    render(<QueueTurnSheets {...p} />)
    expect(screen.getByRole('dialog')).toHaveClass('rounded-t-2xl', 'overflow-hidden')
    expect(screen.queryByRole('group', { name: 'Cliente' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }))
    expect(p.onSelectCandidate).toHaveBeenCalledWith(candidate)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(p.onConfirm).toHaveBeenCalledOnce()
  })

  it.each(['ineffective', 'unconfirmed'] as const)('keeps the necessary %s assignment context', (context) => {
    render(<QueueTurnSheets {...props({ olderAssignmentWarning: false, automationSnapshot: { ...automationSnapshot, effective: context !== 'ineffective' }, seating: context === 'unconfirmed' ? { mode: 'unspecified' } : { mode: 'confirmed', spaceId: 'i', seats: 4 } })} />)
    expect(screen.queryByText(/Si vence el plazo/)).not.toBeInTheDocument()
    if (context === 'unconfirmed') expect(screen.queryByText(/Sin espacio y capacidad confirmados/)).not.toBeInTheDocument()
  })

  it.each(['commandStale', 'pendingActionUnavailable', 'busy', 'invalidSeating', 'unavailable'] as const)('retains ordinary assignment guard %s in both modes', (guard) => {
    for (const automatic of [true, false]) {
      render(<QueueTurnSheets {...props({ pendingQueue: modeQueue(automatic), olderAssignmentWarning: false, commandStale: guard === 'commandStale', pendingActionUnavailable: guard === 'pendingActionUnavailable', busy: guard === 'busy', validSeating: guard !== 'invalidSeating', pendingEntry: { ...entry, assignment: { available: guard !== 'unavailable', spaceName: 'Interior', priorityRequired: false, token: 'assignment-token' } } })} />)
      expect(screen.getByRole('button', { name: guard === 'busy' ? 'Guardando…' : 'Asignar turno' })).toBeDisabled()
      cleanup()
    }
  })

  it.each([false, true])('keeps uncertain retries frozen in automatic=%s', (automatic) => {
    render(<QueueTurnSheets {...props({ pendingQueue: modeQueue(automatic), olderAssignmentWarning: false, commandUncertain: true, commandStale: true, validSeating: false })} />)
    expect(screen.getByRole('button', { name: 'Asignar turno' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Ya está presente' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mesa para 6 personas' })).toBeDisabled()
  })

  it('retains cancellation consequences only for an active cycle', () => {
    const p = props({ olderAssignmentWarning: false, pending: { queueId: 'q', entryId: entry.id, action: 'cancel', key: 'cancel' } })
    const view = render(<QueueTurnSheets {...p} />)
    expect(screen.queryByText(/pausará únicamente/)).not.toBeInTheDocument()
    const manualFrame = screen.getByRole('dialog').className
    view.rerender(<QueueTurnSheets {...p} pendingEntry={{ ...entry, automationCycle: { id: 'c', state: 'active', capacity: 4, receptionService: null, reason: null } }} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('class', manualFrame)
    expect(screen.getByText(/pausará únicamente/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }))
    expect(p.onConfirm).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument()
  })
})

describe('minimal turn sheets', () => {
  it.each(['call', 'cancel', 'complete', 'pass', 'prioritize'] as const)('removes Back and audit copy from %s while retaining close', (action) => {
    const p = props({ olderAssignmentWarning: false, pending: { queueId: 'q', entryId: entry.id, action, key: 'intent' } })
    render(<QueueTurnSheets {...p} />)
    expect(screen.queryByRole('button', { name: /Volver/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Se registrará/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onPendingOpenChange).toHaveBeenCalledWith(false, expect.anything())
    expect(p.onConfirm).not.toHaveBeenCalled()
  })
  it('has no empty footer in a read-only detail', () => {
    render(<QueueTurnSheets {...props({ pending: null, managedOpen: true, managedEntry: entry, canOperate: false })} />)
    expect(screen.getByRole('dialog').querySelector('[data-slot="sheet-footer"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeVisible()
  })
})
