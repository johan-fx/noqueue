import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { QueueEntryCard } from './QueueEntryCard'

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
      type: 'reception',
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
  onAction: vi.fn(),
}
it('keeps both trays mounted but inaccessible while closed', () => {
  const { container } = render(<QueueEntryCard {...props} />)
  expect(screen.getByText('Llamar').closest('[inert]')).not.toBeNull()
  expect(
    screen.getByText('Cancelar turno').closest('[inert]'),
  ).not.toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Llamar' }),
  ).not.toBeInTheDocument()
  expect(container.querySelector('li')).toHaveClass('select-none')
})
it('reveals a yellow call action on the right and closes before dispatch', () => {
  render(<QueueEntryCard {...props} revealed="right" />)
  const call = screen.getByRole('button', { name: 'Llamar' })
  expect(call).toHaveClass('bg-yellow-400', 'text-yellow-950')
  fireEvent.click(call)
  expect(props.onReveal).toHaveBeenCalledWith(null)
  expect(props.onAction).toHaveBeenCalledWith(props.entry, 'call')
})
it('keeps inventory restrictions on the swipe call action', () => {
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
  expect(screen.getByRole('button', { name: 'Llamar' })).toBeDisabled()
})
it('provides a green accessible arrival action for called entries', () => {
  render(
    <QueueEntryCard
      {...props}
      entry={{ ...props.entry, status: 'called' }}
      revealed="right"
    />,
  )
  expect(
    screen.getByRole('button', { name: 'Confirmar llegada' }),
  ).toHaveClass('bg-green-600')
  expect(
    screen.queryByRole('button', { name: 'Llamar' }),
  ).not.toBeInTheDocument()
})
it('does not expose lateral actions without permission or while busy', () => {
  const { rerender } = render(
    <QueueEntryCard {...props} revealed="right" canOperate={false} />,
  )
  expect(
    screen.queryByRole('button', { name: 'Llamar' }),
  ).not.toBeInTheDocument()
  rerender(<QueueEntryCard {...props} revealed="right" busy />)
  expect(
    screen.queryByRole('button', { name: 'Llamar' }),
  ).not.toBeInTheDocument()
})

it('keeps completed entries in the explicit menu without lateral trays', () => {
  render(
    <QueueEntryCard
      {...props}
      entry={{ ...props.entry, status: 'completed' }}
      revealed="all"
    />,
  )
  expect(
    screen.getByRole('button', { name: 'Liberar recurso' }),
  ).toBeVisible()
  expect(screen.queryByText('Llamar')).not.toBeInTheDocument()
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
  expect(
    screen.getByRole('button', { name: 'Cancelar turno' }),
  ).toBeVisible()
  expect(screen.queryByText('Pasar turno')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Confirmar llegada' }),
  ).not.toBeInTheDocument()
})
