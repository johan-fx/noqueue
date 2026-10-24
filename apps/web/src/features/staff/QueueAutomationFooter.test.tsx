import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { QueueAutomation } from '@noqueue/contracts/staff'
import { QueueAutomationFooter } from './QueueAutomationFooter'

afterEach(cleanup)

const idle: QueueAutomation = {
  configured: true,
  effective: true,
  activeCycles: 0,
  serverNow: 1,
}

it('shows the paused restaurant state without a footer CTA', () => {
  render(
    <QueueAutomationFooter
      type="restaurant"
      configured
      automation={idle}
      busy={false}
      canAssignNext
      onAssignNext={vi.fn()}
    />,
  )
  expect(screen.getByText('Gestión automática pausada')).toBeVisible()
  expect(screen.getByText(/Asigna próximo turno de forma manual/)).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Asignar próximo turno' }),
  ).not.toBeInTheDocument()
})

it.each(['reception', 'pool'] as const)(
  'keeps the manual CTA for %s while showing the authoritative active-cycle count',
  (type) => {
    const onAssignNext = vi.fn()
    render(
      <QueueAutomationFooter
        type={type}
        configured
        automation={{ ...idle, activeCycles: 3 }}
        busy={false}
        canAssignNext
        onAssignNext={onAssignNext}
      />,
    )
    expect(screen.getByText('Gestión automática activa')).toBeVisible()
    expect(screen.getByText('3 asignaciones activas.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Asignar próximo turno' }))
    expect(onAssignNext).toHaveBeenCalledOnce()
  },
)

it('keeps a manual assignment CTA when the service opt-in is off', () => {
  render(
    <QueueAutomationFooter
      type="pool"
      configured={false}
      automation={null}
      busy={false}
      canAssignNext
      onAssignNext={vi.fn()}
    />,
  )
  expect(screen.queryByText('Gestión automática pausada')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Asignar próximo turno' })).toBeEnabled()
})

it('does not instruct a read-only viewer to perform an unauthorized assignment', () => {
  render(<QueueAutomationFooter type="reception" configured automation={idle}
    canOperate={false} busy={false} canAssignNext onAssignNext={vi.fn()} />)
  expect(screen.queryByText('Asigna próximo turno de forma manual.')).not.toBeInTheDocument()
  expect(screen.getByText('El personal con permisos puede iniciar una asignación manual.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Asignar próximo turno' })).not.toBeInTheDocument()
})

it.each([
  ['unknown', null, 'Estado automático sin confirmar'],
  ['unavailable', { ...idle, effective: false, activeCycles: 3 }, 'Gestión automática no disponible'],
  ['invalid count', { ...idle, activeCycles: -1 }, 'Estado automático sin confirmar'],
] as const)('does not present %s as a lack of active references', (_state, automation, label) => {
  render(<QueueAutomationFooter type="restaurant" configured automation={automation}
    busy={false} canAssignNext onAssignNext={vi.fn()} />)
  expect(screen.getByText(label)).toBeVisible()
  expect(screen.queryByText(/No hay asignaciones de referencia/)).not.toBeInTheDocument()
  expect(screen.queryByText('Gestión automática pausada')).not.toBeInTheDocument()
})

it('keeps the global state active until the last cycle stops', () => {
  const props = { type: 'restaurant' as const, configured: true, busy: false, canAssignNext: true, onAssignNext: vi.fn() }
  const { rerender } = render(<QueueAutomationFooter {...props} automation={{ ...idle, activeCycles: 2 }} />)
  expect(screen.getByText('2 asignaciones activas.')).toBeVisible()
  rerender(<QueueAutomationFooter {...props} automation={{ ...idle, activeCycles: 1 }} />)
  expect(screen.getByText('Gestión automática activa')).toBeVisible()
  expect(screen.getByText('1 asignación activa.')).toBeVisible()
  rerender(<QueueAutomationFooter {...props} automation={idle} />)
  expect(screen.getByText('Gestión automática pausada')).toBeVisible()
})

it('does not claim a cached active snapshot is confirmed while offline', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  try {
    render(<QueueAutomationFooter type="restaurant" configured automation={{ ...idle, activeCycles: 2 }}
      busy={false} canAssignNext onAssignNext={vi.fn()} />)
    expect(screen.getByText('Estado automático sin confirmar')).toBeVisible()
    expect(screen.queryByText('Gestión automática activa')).not.toBeInTheDocument()
  } finally { online.mockRestore() }
})


it.each([null, { ...idle, configured: false }])('renders no restaurant footer when automatic management is off (%j)', automation => {
  const { container } = render(<QueueAutomationFooter type="restaurant" configured={false} automation={automation}
    busy={false} canAssignNext onAssignNext={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})

it.each(['pool', 'reception'] as const)('shows only the manual assignment button for %s with automatic management off', type => {
  const onAssignNext = vi.fn()
  const props = { type, configured: false, automation: { ...idle, configured: false }, busy: false, canAssignNext: true, onAssignNext }
  const { rerender, container } = render(<QueueAutomationFooter {...props} />)
  const button = screen.getByRole('button', { name: 'Asignar próximo turno' })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(container.textContent).toBe('Asignar próximo turno ')
  expect(button).toHaveClass('h-12', 'text-base', 'rounded-lg')
  fireEvent.click(button)
  expect(onAssignNext).toHaveBeenCalledOnce()
  rerender(<QueueAutomationFooter {...props} busy />)
  expect(button).toBeDisabled()
  rerender(<QueueAutomationFooter {...props} canAssignNext={false} />)
  expect(button).toBeDisabled()
  rerender(<QueueAutomationFooter {...props} canOperate={false} />)
  expect(container).toBeEmptyDOMElement()
})

it('hides the restaurant footer when the authoritative snapshot disables a stale local opt-in', () => {
  const { container } = render(<QueueAutomationFooter type="restaurant" configured
    automation={{ ...idle, configured: false }} busy={false} canAssignNext onAssignNext={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})
