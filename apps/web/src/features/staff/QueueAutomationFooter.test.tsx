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
