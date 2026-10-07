import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  QueueOpeningContext,
  QueueSummary,
} from '@noqueue/contracts/staff'
import { ServiceCard } from './ServiceCard'
import { api, ApiError } from './api'
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const service: QueueSummary = {
  id: 'r',
  name: 'Restaurante',
  venueId: 'v',
  open: 0,
  capacity: 20,
  averageMinutes: 60,
  version: 1,
  serviceOpen: true,
  queueState: 'inactive',
  canJoin: false,
  waitingPeople: 0,
  initialWaitingMarker: true,
  config: {
    name: 'Restaurante',
    type: 'restaurant',
    capacity: 20,
    averageMinutes: 60,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [],
    receptionServices: [],
  },
}
const context: QueueOpeningContext = {
  open: false,
  serviceOpen: true,
  queueState: 'inactive',
  contextToken: 'one',
  version: 1,
  pendingCount: 0,
  untrackedCount: 0,
  readiness: { state: 'pending', reasons: [] },
  groups: [],
}
function props(current = service) {
  return {
    service: current,
    permissions: ['queue.read', 'queue.operate', 'queue.configure'] as const,
    waitingCount: 0,
    disabled: false,
    onBusyChange: vi.fn(),
    onSaved: vi.fn(async () => {}),
    onView: vi.fn(),
    onConfigure: vi.fn(),
    onAdvanced: vi.fn(),
    onFree: vi.fn(),
  }
}
function mock() {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('opening-context') ? context : { ok: true },
  )
}
const mutations = () =>
  vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST')
it('activates directly without quantities, remains controlled and prevents repeated clicks during submission', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(api).mockImplementation(async (_path, method) =>
    method === 'POST'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : context,
  )
  const p = props(),
    view = render(<ServiceCard {...p} />)
  const control = screen.getByRole('switch', { name: 'Activar lista' })
  fireEvent.click(control)
  fireEvent.click(control)
  await waitFor(() => expect(mutations()).toHaveLength(1))
  expect(mutations()[0]?.[2]).toEqual({
    action: 'declare_full',
    contextToken: 'one',
  })
  expect(control).not.toBeChecked()
  expect(control).toBeDisabled()
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  finish({ ok: true })
  await waitFor(() => expect(p.onSaved).toHaveBeenCalledTimes(1))
  expect(control).not.toBeChecked()
  view.rerender(
    <ServiceCard {...p} service={{ ...service, queueState: 'active' }} />,
  )
  expect(screen.getByRole('switch', { name: 'Cerrar lista' })).toBeChecked()
})
it.each(['restaurant', 'reception', 'pool'] as const)(
  'resumes %s through the existing resume command without a full declaration',
  async (type) => {
    mock()
    render(
      <ServiceCard
        {...props({
          ...service,
          queueState: 'paused',
          config: { ...service.config, type },
        })}
      />,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Reanudar lista' }))
    await waitFor(() => expect(mutations()).toHaveLength(1))
    expect(mutations()[0]?.[2]).toEqual({
      action: 'resume',
      contextToken: 'one',
    })
  },
)
it('retains the same body and key after a network failure rather than silently repeating a new operation', async () => {
  let calls = 0
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method !== 'POST') return context
    if (++calls === 1) throw new Error('offline')
    return { ok: true }
  })
  render(<ServiceCard {...props()} />)
  fireEvent.click(screen.getByRole('switch', { name: 'Activar lista' }))
  await screen.findByText('offline')
  fireEvent.click(screen.getByRole('switch', { name: 'Activar lista' }))
  await waitFor(() => expect(mutations()).toHaveLength(2))
  expect(mutations()[0]?.slice(2)).toEqual(mutations()[1]?.slice(2))
})
it('refreshes a 409 and requires a new explicit closing confirmation with the current context', async () => {
  let calls = 0,
    reads = 0
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === 'POST') {
      if (++calls === 1) throw new ApiError(409, 'changed')
      return { ok: true }
    }
    return {
      ...context,
      queueState: 'active',
      contextToken: ++reads === 1 ? 'one' : 'two',
    }
  })
  const p = props({ ...service, queueState: 'active' })
  render(<ServiceCard {...p} />)
  fireEvent.click(screen.getByRole('switch', { name: 'Cerrar lista' }))
  let dialog = screen.getByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar lista' }))
  await screen.findByText(/Datos actualizados/)
  expect(mutations()).toHaveLength(1)
  dialog = screen.getByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar lista' }))
  await waitFor(() => expect(mutations()).toHaveLength(2))
  expect(mutations()[1]?.[2]).toEqual({ action: 'pause', contextToken: 'two' })
  expect(mutations()[0]?.[3]).not.toBe(mutations()[1]?.[3])
})
it('offers only a read refresh after a committed close whose refresh failed', async () => {
  mock()
  const p = props({ ...service, queueState: 'active' })
  p.onSaved.mockRejectedValueOnce(new Error('refresh unavailable'))
  render(<ServiceCard {...p} />)
  fireEvent.click(screen.getByRole('switch', { name: 'Cerrar lista' }))
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cerrar lista',
    }),
  )
  await screen.findByText(/La operación está guardada/)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('switch')).toBeDisabled()
  fireEvent.click(screen.getByRole('switch'))
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos' }))
  await waitFor(() => expect(p.onSaved).toHaveBeenCalledTimes(2))
  expect(mutations()).toHaveLength(1)
  expect(mutations()[0]?.[2]).toEqual({ action: 'pause', contextToken: 'one' })
})
it('guards closing, escape and double submission while saving and returns cancellation to the switch', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(api).mockImplementation(async (_path, method) =>
    method === 'POST'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : context,
  )
  render(<ServiceCard {...props({ ...service, queueState: 'active' })} />)
  const control = screen.getByRole('switch', { name: 'Cerrar lista' })
  fireEvent.click(control)
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(control).toHaveFocus())
  expect(mutations()).toHaveLength(0)
  fireEvent.click(control)
  const dialog = screen.getByRole('alertdialog'),
    submit = within(dialog).getByRole('button', { name: 'Cerrar lista' })
  fireEvent.click(submit)
  fireEvent.click(submit)
  await waitFor(() => expect(mutations()).toHaveLength(1))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.getByRole('alertdialog')).toBeVisible()
  expect(
    within(dialog).getByRole('button', { name: 'Cancelar' }),
  ).toBeDisabled()
  finish({ ok: true })
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
  )
})
it.each([
  { serviceOpen: false, blockReason: 'closed' as const },
  { serviceOpen: true, blockReason: 'cutoff' as const },
])('disables new activation outside admission hours %j', (state) => {
  mock()
  render(<ServiceCard {...props({ ...service, ...state })} />)
  expect(screen.getByRole('switch')).toBeDisabled()
  fireEvent.click(screen.getByRole('switch'))
  expect(mutations()).toHaveLength(0)
})
it('keeps a capacity-blocked active list checked and lets staff close admission', () => {
  render(
    <ServiceCard
      {...props({
        ...service,
        queueState: 'active',
        canJoin: false,
        blockReason: 'capacity',
      })}
    />,
  )
  expect(screen.getByRole('switch')).toBeChecked()
  expect(screen.getByRole('switch')).toBeEnabled()
  fireEvent.click(screen.getByRole('switch'))
  expect(screen.getByRole('alertdialog')).toBeVisible()
})
it('opens missing configuration from activation and secondary actions return to the persistent Gear', async () => {
  const p = props({
    ...service,
    readiness: { state: 'pending', reasons: ['configuration_missing'] },
  })
  render(<ServiceCard {...p} />)
  const gear = screen.getByRole('button', { name: 'Opciones del servicio' })
  fireEvent.click(screen.getByRole('switch'))
  expect(p.onAdvanced).toHaveBeenCalledWith(gear)
  expect(mutations()).toHaveLength(0)
  fireEvent.click(gear)
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Configurar servicio' }),
  )
  expect(p.onConfigure).toHaveBeenCalledWith(gear)
  expect(gear).toBeInTheDocument()
})
it('shows only configured restaurant release and respects commercial and read-only capabilities', async () => {
  const p = props({ ...service, inventoryConfirmed: true })
  const view = render(<ServiceCard {...p} />)
  const gear = screen.getByRole('button', { name: 'Opciones del servicio' })
  fireEvent.click(gear)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Mesa libre' }))
  expect(p.onFree).toHaveBeenCalledWith(gear)
  view.rerender(
    <ServiceCard {...p} permissions={['queue.read', 'queue.configure']} />,
  )
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  fireEvent.click(gear)
  expect(
    screen.queryByRole('menuitem', { name: 'Mesa libre' }),
  ).not.toBeInTheDocument()
  expect(
    await screen.findByRole('menuitem', { name: 'Configurar servicio' }),
  ).toBeVisible()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  view.rerender(<ServiceCard {...p} permissions={['queue.read']} />)
  expect(
    screen.queryByRole('button', { name: 'Opciones del servicio' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ver lista' })).toBeVisible()
})
it('uses neutral inactive badges and real counts independently from the public marker', () => {
  render(
    <ServiceCard
      {...props({
        ...service,
        serviceOpen: false,
        queueState: 'paused',
        waitingPeople: 99,
        initialWaitingMarker: true,
      })}
      waitingCount={3}
    />,
  )
  expect(screen.getByText('Servicio cerrado')).not.toHaveClass('bg-green-100')
  expect(screen.getByText('Lista pausada')).not.toHaveClass('bg-green-100')
  expect(
    screen.getByText('Turnos en lista de espera').nextElementSibling,
  ).toHaveTextContent('3')
})

it('restores the switch after a committed close with a delayed refresh', async () => {
  mock()
  let finish!: () => void
  const p = props({ ...service, queueState: 'active' })
  p.onSaved.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  render(<ServiceCard {...p} />)
  const control = screen.getByRole('switch', { name: 'Cerrar lista' })
  fireEvent.click(control)
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cerrar lista',
    }),
  )
  await waitFor(() => expect(p.onSaved).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
  )
  expect(control).toBeDisabled()
  finish()
  await waitFor(() => expect(control).toBeEnabled())
  await waitFor(() => expect(control).toHaveFocus())
})

it('uses the Figma confirmation button foreground instead of inherited black text', () => {
  render(<ServiceCard {...props({ ...service, queueState: 'active' })} />)
  fireEvent.click(screen.getByRole('switch', { name: 'Cerrar lista' }))
  expect(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cerrar lista',
    }),
  ).toHaveClass('bg-red-600', 'text-white')
})
