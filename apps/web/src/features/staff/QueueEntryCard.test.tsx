import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { QueueEntryCard } from './QueueEntryCard'
import assignmentCheck from '@/assets/queue-actions/queue-assignment-check.svg'

afterEach(cleanup)
const props: ComponentProps<typeof QueueEntryCard> = {
  entry: {
    id: 'e',
    code: 'T1',
    status: 'waiting',
    partySize: 2,
    sequence: 1,
    version: 0,
    calledAt: null,
  },
  queue: {
    id: 'q',
    name: 'Queue',
    venueId: 'v',
    capacity: 20,
    averageMinutes: 10,
    open: 1,
    version: 1,
    config: {
      name: 'Queue',
      type: 'restaurant',
      capacity: 20,
      averageMinutes: 10,
      graceMinutes: 5,
      cutoffMinutes: 0,
      twentyFourHours: true,
      schedules: [],
      spaces: [],
      receptionServices: [],
    },
  },
  now: 0,
  position: 1,
  canOperate: true,
  busy: false,
  revealed: null,
  onReveal: vi.fn(),
  onManage: vi.fn(),
  onAction: vi.fn(),
}

it('keeps the manual arrival action available for a legacy automatic replacement', () => {
  render(<QueueEntryCard {...props} revealed="all" entry={{ ...props.entry, status: 'called',
    automaticReplacement: { origin: 'arrival_expiry', eligible: true, result: 'pending', successor: null },
  }} />)
  expect(screen.getAllByRole('button', { name: 'Confirmar llegada' }).length).toBeGreaterThan(0)
})

it('keeps replacement details out of the operational card', () => {
  render(<QueueEntryCard {...props} entry={{ ...props.entry,status:'expired',
    automaticReplacement:{origin:'staff',eligible:true,result:'missing_context',successor:{id:'next',code:'T2'}},
  }} />)
  expect(screen.queryByText(/Falta confirmar/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:/Ver turno sucesor/})).not.toBeInTheDocument()
  expect(screen.getByText('Caducado')).toBeVisible()
})

it('counts down the public wait, not zero operational availability, and accepts revisions', () => {
  const entry = { ...props.entry, etaMinutes: 0, predictedAt: 0,
    waitEstimate: { predictedAt: 60000, estimateQuality: 'provisional' as const } }
  const { rerender } = render(<QueueEntryCard {...props} entry={entry} />)
  expect(screen.getByLabelText('Espera provisional: 1:00')).toBeVisible()
  rerender(<QueueEntryCard {...props} entry={entry} now={1000} />)
  expect(screen.getByText('0:59')).toBeVisible()
  rerender(<QueueEntryCard {...props} entry={entry} now={59999} />)
  expect(screen.getByText('0:01')).toBeVisible()
  rerender(<QueueEntryCard {...props} entry={entry} now={60000} />)
  expect(screen.getByText('Actualizando…')).toBeVisible()
  rerender(<QueueEntryCard {...props} entry={entry} now={60000} online={false} />)
  expect(screen.getByText('Sin conexión')).toBeVisible()
  entry.waitEstimate.predictedAt = 180000
  rerender(<QueueEntryCard {...props} entry={entry} now={60000} />)
  expect(screen.getByText('2:00')).toBeVisible()
  expect(screen.queryByText('0:00')).not.toBeInTheDocument()
})

it('does not manufacture seconds from legacy minutes or unknown estimates', () => {
  const entry = { ...props.entry, etaMinutes: 4, predictedAt: 240000,
    estimateQuality: 'estimated' as const }
  const { rerender } = render(<QueueEntryCard {...props} entry={entry} />)
  expect(screen.getByText('Espera pendiente de datos')).toBeVisible()
  rerender(<QueueEntryCard {...props} entry={{ ...entry,
    waitEstimate: { predictedAt: 240000, estimateQuality: 'unknown' } }} />)
  expect(screen.getByText('Espera pendiente de datos')).toBeVisible()
})

it('uses the arrival deadline once assigned and leaves expiration to the server', () => {
  const entry = { ...props.entry, status: 'called', arrivalDeadlineAt: 45000,
    waitEstimate: { predictedAt: 240000, estimateQuality: 'provisional' as const } }
  const { rerender } = render(<QueueEntryCard {...props} entry={entry} />)
  expect(screen.getByLabelText('Tiempo restante para llegar: 0:45')).toBeVisible()
  rerender(<QueueEntryCard {...props} entry={entry} now={1000} />)
  expect(screen.getByText('0:44')).toBeVisible()
  rerender(<QueueEntryCard {...props} entry={entry} now={46000} />)
  expect(screen.getByText('0:00')).toBeVisible()
  expect(screen.getByText('Pendiente de llegada')).toBeVisible()
  rerender(<QueueEntryCard {...props} entry={{ ...entry, status: 'expired' }} />)
  expect(screen.queryByTitle('Tiempo restante para llegar')).not.toBeInTheDocument()
})
it('keeps both trays mounted but inaccessible while closed', () => {
  const { container } = render(<QueueEntryCard {...props} />)
  expect(screen.getByText('Asignar turno').closest('[inert]')).not.toBeNull()
  expect(screen.getByText('Cancelar turno').closest('[inert]')).not.toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Asignar turno' }),
  ).not.toBeInTheDocument()
  expect(container.querySelector('li')).toHaveClass('select-none')
})
it('opens the manage-turn flow from the whole active customer card', () => {
  render(<QueueEntryCard {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar turno T1' }))
  expect(props.onManage).toHaveBeenCalledWith(props.entry)
  expect(props.onReveal).toHaveBeenCalledWith(null)
})
it('reveals the Figma green assignment action with a check and closes before dispatch', () => {
  render(<QueueEntryCard {...props} revealed="right" />)
  const call = screen.getByRole('button', { name: 'Asignar turno' })
  expect(call).toHaveClass('bg-[#26ad61]', 'text-white')
  const check = call.querySelector('img')
  expect(check).toHaveAttribute('src', assignmentCheck)
  expect(check).toHaveAttribute('alt', '')
  expect(check).toHaveAttribute('aria-hidden', 'true')
  expect(check).toHaveAttribute('width', '19.9984')
  expect(check).toHaveAttribute('height', '19.9984')
  fireEvent.click(call)
  expect(props.onReveal).toHaveBeenCalledWith(null)
  expect(props.onAction).toHaveBeenCalledWith(props.entry, 'call')
})
it('does not disable assignment because of a legacy inventory-readiness flag', () => {
  render(
    <QueueEntryCard
      {...props}
      revealed="right"
      queue={{
        ...props.queue,
        readiness: {
          state: 'pending',
          reasons: ['inventory_refresh_required'],
        },
      }}
    />,
  )
  expect(screen.getByRole('button', { name: 'Asignar turno' })).toBeEnabled()
})
it('provides a green accessible arrival action for called entries', () => {
  render(
    <QueueEntryCard
      {...props}
      entry={{ ...props.entry, status: 'called' }}
      revealed="right"
    />,
  )
  expect(screen.getByRole('button', { name: 'Confirmar llegada' })).toHaveClass(
    'bg-green-600',
  )
  expect(
    screen.queryByRole('button', { name: 'Asignar turno' }),
  ).not.toBeInTheDocument()
})
it('does not expose lateral actions without permission or while busy', () => {
  const { rerender } = render(
    <QueueEntryCard {...props} revealed="right" canOperate={false} />,
  )
  expect(
    screen.queryByRole('button', { name: 'Asignar turno' }),
  ).not.toBeInTheDocument()
  rerender(<QueueEntryCard {...props} revealed="right" busy />)
  expect(
    screen.queryByRole('button', { name: 'Asignar turno' }),
  ).not.toBeInTheDocument()
})

it('keeps completed entries final and does not expose resource-release actions', () => {
  render(
    <QueueEntryCard
      {...props}
      entry={{ ...props.entry, status: 'completed' }}
      revealed="all"
    />,
  )
  expect(screen.getByText('Completado')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Liberar recurso' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Acciones del turno/ })).not.toBeInTheDocument()
  expect(screen.queryByText('Asignar turno')).not.toBeInTheDocument()
  expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument()
})
it('retains only cancellation on the left for called entries', () => {
  render(
    <QueueEntryCard
      {...props}
      entry={{ ...props.entry, status: 'called' }}
      revealed="left"
    />,
  )
  expect(screen.getByRole('button', { name: 'Cancelar turno' })).toBeVisible()
  expect(screen.queryByText('Pasar turno')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Confirmar llegada' }),
  ).not.toBeInTheDocument()
})

it.each(['reception', 'pool'] as const)(
  'offers %s manual assignment, pass and cancellation for the next customer',
  (type) => {
    render(
      <QueueEntryCard
        {...props}
        queue={{ ...props.queue, config: { ...props.queue.config, type } }}
        revealed="all"
      />,
    )
    expect(screen.getByRole('button', { name: 'Asignar turno' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Pasar turno' })).toBeVisible()
    expect(
      screen.getAllByRole('button', { name: 'Cancelar turno' }),
    ).toHaveLength(1)
  },
)

it('hides the ETA and explains that retained waiting entries need manual assignment', () => {
  render(
    <QueueEntryCard
      {...props}
      entry={{
        ...props.entry,
        manualOnly: true,
        waitEstimate: { predictedAt: 60_000, estimateQuality: 'estimated' },
      }}
    />,
  )
  expect(screen.getByText('Pendiente de asignación manual')).toBeVisible()
  expect(screen.queryByText('1:00')).not.toBeInTheDocument()
})

it('keeps a retained called entry countdown while keeping the card cycle summary compact', () => {
  render(
    <QueueEntryCard
      {...props}
      entry={{
        ...props.entry,
        status: 'called',
        manualOnly: true,
        arrivalDeadlineAt: 45_000,
        automationCycle: {
          id: 'cycle-1',
          capacity: 4,
          receptionService: null,
          state: 'active',
          reason: null,
        },
      }}
    />,
  )
  expect(screen.getByLabelText('Tiempo restante para llegar: 0:45')).toBeVisible()
  expect(screen.getByText('Automático')).toBeVisible()
  expect(screen.getByText('Intento 1')).toBeVisible()
  expect(screen.queryByText(/Confirmar o cancelar detiene/)).not.toBeInTheDocument()
  const border = screen.getByRole('listitem').querySelector('[data-automatic-border]')
  expect(border).toHaveClass('border-l-2', 'border-black', 'absolute', 'pointer-events-none')
  expect(border).toHaveAttribute('aria-hidden', 'true')
})

it.each(['restaurant', 'pool', 'reception'] as const)('marks only the actively managed called card in %s', (type) => {
  const queue = { ...props.queue, config: { ...props.queue.config, type, automaticAssignmentEnabled: true } }
  const cycle = { id: 'cycle', state: 'active' as const, reason: null, capacity: 4, receptionService: null }
  const entry = { ...props.entry, status: 'called', automationCycle: cycle }
  const { container, rerender } = render(<QueueEntryCard {...props} queue={queue} entry={entry} />)
  const border = () => container.querySelector('[data-automatic-border]')
  expect(border()).toBeInTheDocument()
  expect(border()?.parentElement).toBe(screen.getByRole('listitem'))
  expect(container.querySelector('[data-swipe-surface]')).not.toContainElement(border() as HTMLElement)
  for (const status of ['waiting', 'completed', 'served', 'cancelled', 'expired', 'no_show']) {
    rerender(<QueueEntryCard {...props} queue={queue} entry={{ ...entry, status }} />)
    expect(border()).not.toBeInTheDocument()
  }
  rerender(<QueueEntryCard {...props} queue={queue} entry={{ ...entry, automationCycle: { ...cycle, state: 'stopped', reason: 'disabled' } }} />)
  expect(border()).not.toBeInTheDocument()
  rerender(<QueueEntryCard {...props} queue={queue} entry={{ ...entry, automationCycle: null }} />)
  expect(border()).not.toBeInTheDocument()
  rerender(<QueueEntryCard {...props} queue={queue} entry={entry} revealed="right" />)
  expect(border()).toBeInTheDocument()
})

it('labels revealed pass and priority actions and never executes them merely on reveal', () => {
  const onAction = vi.fn()
  const { rerender } = render(<QueueEntryCard {...props} onAction={onAction} revealed="all" isNext />)
  expect(screen.getByRole('button', { name: 'Pasar turno' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Priorizar para siguiente turno' })).not.toBeInTheDocument()
  expect(onAction).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Pasar turno' }))
  expect(onAction).toHaveBeenCalledWith(props.entry, 'pass')
  rerender(<QueueEntryCard {...props} onAction={onAction} revealed="all" isNext={false} />)
  expect(screen.queryByRole('button', { name: 'Pasar turno' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Priorizar para siguiente turno' })).toBeVisible()
})


it('distinguishes a previous cycle arrival from the waiting client who passed', () => {
  render(<QueueEntryCard {...props} entry={{ ...props.entry,
    automationCycle: { id: 'previous', state: 'stopped', reason: 'arrived', capacity: 4, receptionService: null },
  }} />)
  expect(screen.queryByText(/Ciclo anterior|Ciclo pausado|Ciclo detenido/)).not.toBeInTheDocument()
  expect(screen.queryByText('Llegada confirmada; ciclo automático finalizado.')).not.toBeInTheDocument()
})

it('exposes call status and cycle attempt to assistive technology without hiding card text', () => {
  render(<QueueEntryCard {...props} entry={{ ...props.entry, status: 'called',
    arrivalDeadlineAt: 60000,
    automationCycle: { id: 'c', state: 'active', capacity: 2, receptionService: null, reason: null, attempt: 2 },
  }} />)
  const manage = screen.getByRole('button', { name: 'Gestionar turno T1' })
  expect(manage).toHaveAccessibleDescription(/Pendiente de llegada.*1:00.*Automático · Intento 2/)
  expect(manage).not.toContainElement(screen.getByText('Pendiente de llegada'))
})


it('keeps confirmed seating capacity out of the card and groups the arrival deadline with its status', () => {
  render(<QueueEntryCard {...props} entry={{ ...props.entry, status: 'called',
    space: { id: 'old', name: 'Preferencia anterior', source: 'preferred' },
    assignedSeating: { spaceId: 'inside', spaceName: 'Interior', seats: 4 },
    arrivalDeadlineAt: 60_000,
    automationCycle: { id: 'c', state: 'active', capacity: 2, receptionService: null, reason: null, attempt: 2 },
  }} />)
  expect(screen.getByText('Interior')).toBeVisible()
  expect(screen.queryByText(/Mesa para/)).not.toBeInTheDocument()
  expect(screen.queryByText('Preferencia anterior')).not.toBeInTheDocument()
  const status = screen.getByText('Pendiente de llegada')
  const badge = screen.getByLabelText('Tiempo restante para llegar: 1:00')
  expect(status.parentElement).toContainElement(badge)
  expect(status.parentElement).toHaveClass('shrink-0')
  expect(badge).toHaveClass('bg-[#fef2f2]', 'text-[#dc2626]')
})

it.each(['arrived', 'cancelled', 'no_candidate', 'missing_context', 'context_changed', 'disabled', 'service_ended', 'legacy', 'no_show'])(
  'keeps %s cycle explanations out of the card and opens historical details without actions', (reason) => {
    const onManage = vi.fn()
    const entry = { ...props.entry, status: 'cancelled', automationCycle: {
      id: 'c', state: 'stopped' as const, reason, capacity: 4, receptionService: null,
    } }
    render(<QueueEntryCard {...props} entry={entry} onManage={onManage} />)
    expect(screen.queryByText(/Ciclo|ciclo|candidatos compatibles/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle del turno T1' }))
    expect(onManage).toHaveBeenCalledWith(entry)
    expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument()
  },
)

it.each([
  ['completed', 'Completado', 'text-[#84cc16]'],
  ['served', 'Completado', 'text-[#84cc16]'],
  ['cancelled', 'Cancelado', 'text-[#b91c1c]'],
])('places %s only in the identity header with its Figma status icon', (status, label, color) => {
  render(<QueueEntryCard {...props} entry={{ ...props.entry, status, displayName: 'María García' }} />)
  const text = screen.getByText(label!)
  const indicator = text.closest('[data-entry-status]')!
  expect(indicator).toHaveClass(color!, 'gap-1', 'text-xs', 'font-normal', 'leading-4')
  expect(indicator.parentElement).toContainElement(screen.getByText('María García'))
  expect(indicator.querySelector('img')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getAllByText(label!)).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Ver detalle del turno T1' })).toHaveAccessibleDescription(new RegExp(label!))
})

it('preserves the service-closure explanation in the cancelled status', () => {
  render(<QueueEntryCard {...props} entry={{ ...props.entry, status: 'cancelled', cancellationReason: 'service_ended' }} />)
  expect(screen.getByText('Cancelado por cierre de servicio').closest('[data-entry-status]')).not.toBeNull()
})

it.each(['waiting', 'called', 'expired', 'no_show'])('does not move or restyle the %s status', status => {
  const { container } = render(<QueueEntryCard {...props} entry={{ ...props.entry, status }} />)
  expect(container.querySelector('[data-entry-status]')).toBeNull()
})
