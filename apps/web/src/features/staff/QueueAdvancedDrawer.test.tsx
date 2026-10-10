import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueueAdvancedDrawer } from './QueueAdvancedDrawer'
import { api } from './api'
import { toGroupedService, type QueueSummary, type ServiceInput } from '@noqueue/contracts/staff'
vi.mock('./ServiceConfigDrawer', () => ({
  ServiceConfigDrawer: ({
    open,
    initial,
    onSave,
  }: {
    open: boolean
    initial: ServiceInput
    onSave: (config: ServiceInput) => Promise<void>
  }) =>
    open ? (
      <>
        <button
          type="button"
          onClick={() =>
            void onSave({ ...initial, etaChangeThresholdMinutes: 8 })
          }
        >
          Save test settings
        </button>
        <button
          type="button"
          onClick={() => void onSave({ ...initial, approachTurns: 8 })}
        >
          Save legacy turn threshold
        </button>
      </>
    ) : null,
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
const queue: QueueSummary = {
  id: 'q',
  venueId: 'v',
  name: 'Restaurant',
  capacity: 10,
  averageMinutes: 20,
  version: 1,
  open: 0,
  serviceOpen: true,
  queueState: 'inactive',
  config: {
    name: 'Restaurant',
    type: 'restaurant',
    capacity: 10,
    averageMinutes: 20,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [
      {
        id: 'main',
        name: 'Main',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1 }],
      },
    ],
    receptionServices: [],
  },
}
it('keeps reminder settings in a nested draft and protects navigation while saving', async () => {
  let complete!: () => void
  vi.mocked(api).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  const close = vi.fn(),
    saved = vi.fn()
  render(
    <QueueAdvancedDrawer
      queue={queue}
      canOperate
      canConfigure
      returnFocus={null}
      onClose={close}
      onSaved={saved}
    />,
  )
  expect(screen.queryByLabelText('Hora diaria')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Recordatorio de llenado habitual' }),
  )
  fireEvent.click(screen.getByRole('switch', { name: 'Activar recordatorio' }))
  fireEvent.change(screen.getByLabelText('Hora diaria'), {
    target: { value: '13:00' },
  })
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar recordatorio' }))
  expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Volver', hidden: false }),
  ).toBeDisabled()
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  complete()
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(close).not.toHaveBeenCalled()
})

it('loads delivery evidence only inside advanced settings and labels the retention', async () => {
  vi.mocked(api).mockResolvedValue({
    summary: [
      {
        kind: 'ready',
        accepted: 4,
        delivered: 3,
        read: 1,
        failed: 1,
        unknown: 1,
        openings: 2,
      },
    ],
    events: [
      {
        id: 'trace',
        code: 'T1',
        kind: 'ready',
        event: 'delivered',
        recordedAt: Date.now(),
      },
    ],
  })
  render(
    <QueueAdvancedDrawer
      queue={queue}
      canOperate
      canConfigure
      returnFocus={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Trazabilidad de avisos (7 días)' }),
  )
  expect(await screen.findByText(/T1/)).toHaveTextContent('Entregado')
  expect(screen.getByText(/Aceptados: 4/)).toBeVisible()
  expect(screen.getByText(/Entregados: 3/)).toBeVisible()
  expect(screen.getByText(/Aperturas del enlace: 2/)).toBeVisible()
  expect(api).toHaveBeenCalledWith('/queues/q/delivery-trace')
})

it('requires confirmation before changing notice policy with waiting entries', async () => {
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  render(
    <QueueAdvancedDrawer
      queue={queue}
      activeWaitingCount={1}
      canOperate
      canConfigure
      returnFocus={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Recursos y ajustes de estimación' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save test settings' }))
  expect(confirm).toHaveBeenCalledWith(
    'La política de avisos se actualizará para los turnos en espera. El plazo de llegada solo cambiará en futuras asignaciones. ¿Quieres continuar?',
  )
  expect(api).not.toHaveBeenCalled()
})

it('applies a confirmed notice policy update to current waiting entries', async () => {
  const confirm = vi.fn(() => true)
  vi.stubGlobal('confirm', confirm)
  vi.mocked(api).mockResolvedValue(undefined)
  render(
    <QueueAdvancedDrawer
      queue={queue}
      activeWaitingCount={1}
      canOperate
      canConfigure
      returnFocus={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Recursos y ajustes de estimación' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save test settings' }))
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  expect(confirm).toHaveBeenCalledOnce()
  expect(api).toHaveBeenCalledWith(
    '/queues/q',
    'PATCH',
    expect.objectContaining({
      etaChangeThresholdMinutes: 8,
      version: 1,
      open: false,
      applyApproachToActive: true,
    }),
  )
})

it('does not request policy confirmation for a legacy turn-count-only change', async () => {
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  vi.mocked(api).mockResolvedValue(undefined)
  render(
    <QueueAdvancedDrawer
      queue={queue}
      activeWaitingCount={1}
      canOperate
      canConfigure
      returnFocus={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Recursos y ajustes de estimación' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save legacy turn threshold' }))

  await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  expect(confirm).not.toHaveBeenCalled()
  expect(api).toHaveBeenCalledWith(
    '/queues/q',
    'PATCH',
    expect.objectContaining({
      approachTurns: 8,
      applyApproachToActive: false,
    }),
  )
})

it('offers daily and timed reminders together for a mixed grouped calendar and saves groups only', async () => {
  const config: ServiceInput = { ...toGroupedService(queue.config), scheduleGroups: [{ days: [1], twentyFourHours: true, ranges: [] }, { days: [2], twentyFourHours: false, ranges: [{ from: '12:00', to: '15:00' }] }] }
  vi.mocked(api).mockResolvedValue({ ok: true })
  render(<QueueAdvancedDrawer queue={{ ...queue, config }} canOperate canConfigure returnFocus={null} onClose={vi.fn()} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Recordatorio de llenado habitual' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Activar recordatorio' }))
  expect(screen.getByLabelText('Hora diaria')).toBeVisible()
  expect(screen.getByLabelText('Martes · 12:00–15:00')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Hora diaria'), { target: { value: '11:00' } })
  fireEvent.change(screen.getByLabelText('Martes · 12:00–15:00'), { target: { value: '13:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar recordatorio' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/queues/q', 'PATCH', expect.objectContaining({ scheduleGroups: config.scheduleGroups, reminder: { enabled: true, dailyAt: '11:00', intervals: [{ day: 2, from: '12:00', to: '15:00', at: '13:00' }] } })))
})
