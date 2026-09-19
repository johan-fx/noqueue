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
    screen.queryByRole('button', { name: /Acciones del turno/ }),
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
  fireEvent.click(screen.getByRole('button', { name: 'Acciones del turno T0' }))
  fireEvent.click(screen.getByRole('button', { name: 'Llamar' }))
  expect(action).toHaveBeenCalledWith(entries[0], 'call')
})
it('keeps the viewer read-only', () => {
  render(<Harness canOperate={false} />)
  expect(
    screen.queryByRole('button', { name: /Acciones del turno/ }),
  ).not.toBeInTheDocument()
})
