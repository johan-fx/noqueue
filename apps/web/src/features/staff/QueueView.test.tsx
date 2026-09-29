import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { QueueSummary, StaffEntry } from '@noqueue/contracts/staff'
import { QueueView } from './QueueView'
afterEach(cleanup)
const queue: QueueSummary = {
  id: 'q',
  name: 'Recepción',
  venueId: 'v',
  capacity: 20,
  averageMinutes: 10,
  open: 1,
  version: 1,
  config: {
    name: 'Recepción',
    type: 'reception',
    capacity: 20,
    averageMinutes: 10,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [],
    receptionServices: ['check_in'],
  },
}
const entries: StaffEntry[] = [
  'waiting',
  'called',
  'completed',
  'served',
  'cancelled',
  'no_show',
  'expired',
].map((status, index) => ({
  id: 'e' + index,
  code: 'T' + index,
  partySize: 2,
  status,
  sequence: index,
  version: 0,
  calledAt: status === 'called' ? Date.now() - 120000 : null,
}))
function Harness({ canOperate = true, action = vi.fn() }) {
  const [tab, setTab] = useState('active')
  return (
    <QueueView
      queue={queue}
      entries={entries}
      tab={tab}
      onTabChange={setTab}
      canOperate={canOperate}
      busy={false}
      lastSync="12:00"
      error=""
      onRefresh={() => {}}
      onAction={action}
    />
  )
}
it('separates active, completed and cancelled histories using accessible tabs', () => {
  render(<Harness />)
  // The drawer header already shows the service name; the queue body starts at tabs.
  expect(screen.queryByText('Recepción')).not.toBeInTheDocument()
  expect(
    screen.getByRole('tablist', { name: 'Vistas de la cola' }),
  ).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Lista' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const activePanel = screen.getByRole('tabpanel')
  expect(
    within(activePanel).getByRole('heading', {
      level: 3,
      name: 'Lista de espera',
    }),
  ).toBeVisible()
  expect(within(activePanel).getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('2 min')).toHaveAttribute(
    'title',
    'Tiempo desde la llamada',
  )
  fireEvent.click(screen.getByRole('tab', { name: 'Completados' }))
  expect(screen.getByRole('tab', { name: 'Completados' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const completedPanel = screen.getByRole('tabpanel')
  expect(
    within(completedPanel).getByRole('heading', {
      level: 3,
      name: 'Completados',
    }),
  ).toBeVisible()
  expect(within(completedPanel).getAllByRole('listitem')).toHaveLength(2)
  expect(
    screen.getByRole('button', { name: 'Acciones del turno T2' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Acciones del turno T3' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Cancelados' }))
  const cancelledPanel = screen.getByRole('tabpanel')
  expect(
    within(cancelledPanel).getByRole('heading', {
      level: 3,
      name: 'Cancelados',
    }),
  ).toBeVisible()
  expect(within(cancelledPanel).getAllByRole('listitem')).toHaveLength(3)
  expect(screen.getByText('No presentado')).toBeVisible()
  expect(screen.getByText('Caducado')).toBeVisible()
})
it('expands permitted turn actions without making historical cards actionable', () => {
  const action = vi.fn()
  render(<Harness action={action} />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Acciones del turno T0' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Llamar' }))
  expect(action).toHaveBeenCalledWith(entries[0], 'call')
})
it('keeps the viewer read-only', () => {
  render(<Harness canOperate={false} />)
  expect(
    screen.queryByRole('button', { name: /Acciones del turno/ }),
  ).not.toBeInTheDocument()
})
it('offers an explicit release after arrival', () => {
  render(
    <QueueView
      queue={queue}
      entries={[{ ...entries[2]!, resourceId: 'reception:100:0' }]}
      tab="completed"
      onTabChange={() => {}}
      canOperate
      busy={false}
      lastSync=""
      error=""
      onRefresh={() => {}}
      onAction={vi.fn()}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Acciones del turno T2' }),
  )
  expect(
    screen.getByRole('button', { name: 'Liberar recurso' }),
  ).toBeVisible()
})
it('disables explicit calls while managed inventory needs a fresh survey', () => {
  render(
    <QueueView
      queue={{
        ...queue,
        readiness: {
          state: 'pending',
          reasons: ['inventory_refresh_required'],
        },
      }}
      entries={[entries[0]!]}
      tab="active"
      onTabChange={vi.fn()}
      canOperate
      busy={false}
      lastSync=""
      error=""
      onRefresh={vi.fn()}
      onAction={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Acciones/ }))
  expect(screen.getByRole('button', { name: 'Llamar' })).toBeDisabled()
})

it('numbers the whole active list including called turns, preserves ordinals when filtered and resets for another service', () => {
  const rows = [
    {
      ...entries[1]!,
      displayName: 'Daniel',
      receptionService: 'check_out' as const,
    },
    {
      ...entries[0]!,
      displayName: 'María',
      receptionService: 'check_in' as const,
      position: 1,
    },
  ]
  const props = {
    entries: rows,
    tab: 'active',
    onTabChange: vi.fn(),
    canOperate: true,
    busy: false,
    lastSync: '',
    error: '',
    onRefresh: vi.fn(),
    onAction: vi.fn(),
    onAdd: vi.fn(),
  }
  const { rerender } = render(
    <QueueView
      {...props}
      queue={{
        ...queue,
        config: {
          ...queue.config,
          receptionServices: ['check_in', 'check_out'],
        },
      }}
    />,
  )
  expect(screen.getByLabelText('Posición 1')).toHaveTextContent('1')
  expect(screen.getByLabelText('Posición 2')).toHaveTextContent('2')
  fireEvent.click(screen.getByRole('button', { name: 'Filtrar Check-in' }))
  expect(screen.getByText('María')).toBeVisible()
  expect(screen.queryByText('Daniel')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Posición 2')).toHaveTextContent('2')
  rerender(
    <QueueView
      {...props}
      queue={{
        ...queue,
        id: 'pool',
        config: { ...queue.config, type: 'pool' },
      }}
    />,
  )
  expect(
    screen.queryByRole('group', { name: 'Filtros de la cola' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('Daniel')).toBeVisible()
})
it('shows restaurant size filters and distinguishes predicted and preferred spaces', () => {
  render(
    <QueueView
      queue={{ ...queue, config: { ...queue.config, type: 'restaurant' } }}
      entries={[
        {
          ...entries[0]!,
          displayName: 'María',
          partySize: 4,
          space: { id: 'a', name: 'Interior', source: 'predicted' },
        },
        {
          ...entries[1]!,
          partySize: 2,
          space: { id: 'b', name: 'Terraza', source: 'preferred' },
        },
      ]}
      tab="active"
      onTabChange={vi.fn()}
      canOperate={false}
      busy={false}
      lastSync=""
      error=""
      onRefresh={vi.fn()}
      onAction={vi.fn()}
    />,
  )
  expect(screen.getByText('Interior · Previsto')).toBeVisible()
  expect(screen.getByText('Terraza · Preferido')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Filtrar 4 personas' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(
    screen.queryByRole('button', { name: 'Añadir' }),
  ).not.toBeInTheDocument()
})

it('closes row actions when externally changing views or queues', () => {
  const props = {
    entries,
    onTabChange: vi.fn(),
    canOperate: true,
    busy: false,
    lastSync: '',
    error: '',
    onRefresh: vi.fn(),
    onAction: vi.fn(),
  }
  const { rerender } = render(
    <QueueView {...props} queue={queue} tab="active" />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Acciones del turno T0' }),
  )
  expect(screen.getByRole('button', { name: 'Llamar' })).toBeVisible()
  rerender(<QueueView {...props} queue={queue} tab="completed" />)
  rerender(<QueueView {...props} queue={queue} tab="active" />)
  expect(
    screen.queryByRole('button', { name: 'Llamar' }),
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Acciones del turno T0' }),
  )
  rerender(
    <QueueView
      {...props}
      queue={{ ...queue, id: 'another' }}
      tab="active"
    />,
  )
  rerender(<QueueView {...props} queue={queue} tab="active" />)
  expect(
    screen.queryByRole('button', { name: 'Llamar' }),
  ).not.toBeInTheDocument()
})
