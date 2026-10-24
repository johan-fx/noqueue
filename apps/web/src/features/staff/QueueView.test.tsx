import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import {
  act,
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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
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
  arrivalDeadlineAt: status === 'called' ? Date.now() + 120000 : null,
}))
function Harness({ canOperate = true, action = vi.fn(), manage = vi.fn() }) {
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
      onManage={manage}
    />
  )
}

it('ticks all rows every second and resyncs absolute deadlines on visibility and connection changes', () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const intervals = vi.spyOn(globalThis, 'setInterval')
  const clear = vi.spyOn(globalThis, 'clearInterval')
  const onRefresh = vi.fn()
  const { unmount } = render(<QueueView queue={queue} entries={[
    { ...entries[0]!, waitEstimate: { predictedAt: 60000, estimateQuality: 'estimated' } },
    { ...entries[1]!, arrivalDeadlineAt: 45000 },
  ]} tab="active" onTabChange={vi.fn()} canOperate={false} busy={false}
    lastSync="" error="" onRefresh={onRefresh} onAction={vi.fn()} />)
  expect(screen.getByText('1:00')).toBeVisible()
  expect(screen.getByText('0:45')).toBeVisible()
  act(() => { vi.advanceTimersByTime(1000) })
  expect(screen.getByText('0:59')).toBeVisible()
  expect(screen.getByText('0:44')).toBeVisible()
  vi.setSystemTime(59999)
  fireEvent(document, new Event('visibilitychange'))
  expect(screen.getByText('0:01')).toBeVisible()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  vi.setSystemTime(60000)
  fireEvent(window, new Event('offline'))
  expect(screen.getByText('Sin conexión')).toBeVisible()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  fireEvent(window, new Event('online'))
  expect(screen.getByText('Actualizando…')).toBeVisible()
  expect(onRefresh).not.toHaveBeenCalled()
  const tickIndex = intervals.mock.calls.findIndex((args) => args[1] === 1000)
  expect(tickIndex).toBeGreaterThanOrEqual(0)
  const tick = intervals.mock.results[tickIndex]!.value
  unmount()
  expect(clear).toHaveBeenCalledWith(tick)
})
it('separates active, completed and cancelled histories using accessible tabs', () => {
  render(<Harness />)
  // The drawer header already shows the service name; the queue body starts at tabs.
  expect(screen.queryByText('Recepción')).not.toBeInTheDocument()
  expect(
    screen.getByRole('tablist', { name: 'Vistas de la lista' }),
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
  expect(screen.getByTitle('Tiempo restante para llegar')).toHaveAttribute(
    'title',
    'Tiempo restante para llegar',
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
    screen.queryByRole('button', { name: 'Acciones del turno T2' }),
  ).not.toBeInTheDocument()
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
it('opens turn management from the active card rather than exposing inline actions', () => {
  const manage = vi.fn()
  render(<Harness manage={manage} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar turno T0' }))
  expect(manage).toHaveBeenCalledWith(entries[0])
  expect(screen.queryByRole('button', { name: 'Acciones del turno T0' })).not.toBeInTheDocument()
})
it('keeps the viewer read-only', () => {
  render(<Harness canOperate={false} />)
  expect(screen.getAllByRole('button', { name: /Gestionar turno/ }).every(
    (button) => (button as HTMLButtonElement).disabled,
  )).toBe(true)
})
it('keeps completed turns final with no resource-release action', () => {
  render(
    <QueueView
      queue={{ ...queue, config: { ...queue.config, type: 'restaurant' } }}
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
  expect(screen.getByText('Completado')).toBeVisible()
  expect(screen.queryByRole('button', { name: /Acciones del turno/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Liberar recurso' })).not.toBeInTheDocument()
})
it('does not gate assignment on a legacy inventory-readiness flag', () => {
  const manage = vi.fn()
  render(
    <QueueView
      queue={{
        ...queue,
        config: { ...queue.config, type: 'restaurant' },
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
      onManage={manage}
    />,
  )
  const manageButton = screen.getByRole('button', { name: 'Gestionar turno T0' })
  expect(manageButton).toBeEnabled()
  fireEvent.click(manageButton)
  expect(manage).toHaveBeenCalledWith(entries[0])
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
    screen.queryByRole('group', { name: 'Filtros de la lista' }),
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

it('keeps the card-to-manage action scoped to the selected view and queue', () => {
  const manage = vi.fn()
  const props = {
    entries,
    onTabChange: vi.fn(),
    canOperate: true,
    busy: false,
    lastSync: '',
    error: '',
    onRefresh: vi.fn(),
    onAction: vi.fn(),
    onManage: manage,
  }
  const { rerender } = render(
    <QueueView {...props} queue={queue} tab="active" />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar turno T0' }))
  expect(manage).toHaveBeenCalledWith(entries[0])
  rerender(<QueueView {...props} queue={queue} tab="completed" />)
  rerender(<QueueView {...props} queue={queue} tab="active" />)
  expect(screen.getByRole('button', { name: 'Gestionar turno T0' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar turno T0' }))
  rerender(
    <QueueView {...props} queue={{ ...queue, id: 'another' }} tab="active" />,
  )
  rerender(<QueueView {...props} queue={queue} tab="active" />)
  expect(screen.getByRole('button', { name: 'Gestionar turno T0' })).toBeEnabled()
  expect(manage).toHaveBeenCalledTimes(2)
})
it('keeps automatic service closure in cancelled history with a truthful reason', () => {
  const closed: StaffEntry = { ...entries[4]!, cancellationReason: 'service_ended' }
  render(<QueueView queue={queue} entries={[closed]} tab="cancelled" onTabChange={vi.fn()} canOperate={false} busy={false} lastSync="12:00" error="" onRefresh={vi.fn()} onAction={vi.fn()} />)
  expect(screen.getByText('Cancelado por cierre de servicio')).toBeVisible()
  expect(screen.queryByText('No presentado')).not.toBeInTheDocument()
})
it('disables adding turns and explains why when the list is deactivated', async () => {
  const onAdd = vi.fn()
  const { rerender } = render(
    <QueueView
      queue={{ ...queue, queueState: 'inactive' }}
      entries={entries}
      tab="active"
      onTabChange={vi.fn()}
      canOperate
      busy={false}
      lastSync=""
      error=""
      onRefresh={vi.fn()}
      onAdd={onAdd}
      onAction={vi.fn()}
    />,
  )
  const button = screen.getByRole('button', { name: 'Añadir' })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(onAdd).not.toHaveBeenCalled()
  fireEvent.focus(button.parentElement!)
  expect(
    await screen.findByText(
      'No se pueden añadir turnos ya que la lista está desactivada.',
    ),
  ).toBeVisible()

  rerender(
    <QueueView
      queue={{ ...queue, queueState: 'paused' }}
      entries={entries}
      tab="active"
      onTabChange={vi.fn()}
      canOperate
      busy={false}
      lastSync=""
      error=""
      onRefresh={vi.fn()}
      onAdd={onAdd}
      onAction={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: 'Añadir' })).toBeDisabled()

  rerender(
    <QueueView
      queue={{ ...queue, queueState: 'active' }}
      entries={entries}
      tab="active"
      onTabChange={vi.fn()}
      canOperate
      busy={false}
      lastSync=""
      error=""
      onRefresh={vi.fn()}
      onAdd={onAdd}
      onAction={vi.fn()}
    />,
  )
  const enabled = screen.getByRole('button', { name: 'Añadir' })
  expect(enabled).toBeEnabled()
  fireEvent.click(enabled)
  expect(onAdd).toHaveBeenCalledTimes(1)
})

it('keeps public links visible for read-only staff', () => {
  render(<Harness canOperate={false} />)
  expect(screen.getByRole('button', { name: 'Abrir enlace público' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Abrir enlace público' })).toBeNull()
})
it('places public links at the right of the last-read footer row instead of refresh', async () => {
  render(<Harness canOperate={false} />)
  const lastRead = screen.getByText(
    (_, element) =>
      element?.tagName === 'P' &&
      element.textContent?.replace(/\s+/g, ' ').trim() ===
        'Última lectura: 12:00 · Cada 5 s',
  )
  const row = lastRead.parentElement!
  expect(within(row).getByRole('button', { name: 'Abrir enlace público' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Actualizar' })).not.toBeInTheDocument()
  expect(row).toHaveClass('flex', 'flex-nowrap', 'items-center', 'justify-between')
  expect(lastRead).toHaveClass('min-w-0')
  const trigger = within(row).getByRole('button', { name: 'Abrir enlace público' })
  fireEvent.click(trigger)
  expect(await screen.findByRole('menuitem', { name: 'Inscripción' })).toBeVisible()
  expect(screen.getByRole('menuitem', { name: 'QR' })).toBeVisible()
})
