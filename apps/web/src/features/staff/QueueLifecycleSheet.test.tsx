import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueueLifecycleSheet } from './QueueLifecycleSheet'
import { api } from './api'
import type { QueueOpeningContext } from '@noqueue/contracts/staff'
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const context: QueueOpeningContext = {
  open: false,
  version: 1,
  contextToken: 'token',
  pendingCount: 3,
  untrackedCount: 0,
  readiness: { state: 'pending', reasons: ['inventory_required'] },
  groups: [
    {
      spaceId: 'terrace',
      spaceName: 'Terraza',
      seats: 4,
      count: 3,
      allocated: 1,
      occupied: 0,
    },
    {
      spaceId: 'salon',
      spaceName: 'Salón',
      seats: 4,
      count: 2,
      allocated: 0,
      occupied: 0,
    },
  ],
}
it('requires explicit counts in every tab and submits only after confirmation', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('opening-context') ? context : { ok: true },
  )
  const done = vi.fn()
  render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurante"
      action="open"
      onClose={vi.fn()}
      onSaved={done}
    />,
  )
  await screen.findByRole('tab', { name: 'Terraza' })
  expect(screen.getByRole('button', { name: 'Abrir lista' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Mesas de 4/ }))
  expect(
    screen.getByLabelText('Terraza · 4 plazas ocupadas fuera de la lista'),
  ).toHaveValue(null)
  fireEvent.change(
    screen.getByLabelText('Terraza · 4 plazas ocupadas fuera de la lista'),
    { target: { value: '1' } },
  )
  fireEvent.click(screen.getByRole('tab', { name: 'Salón' }))
  fireEvent.click(screen.getByRole('button', { name: /Mesas de 4/ }))
  fireEvent.change(
    screen.getByLabelText('Salón · 4 plazas ocupadas fuera de la lista'),
    { target: { value: '0' } },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
  expect(api).toHaveBeenCalledWith(
    '/queues/q/lifecycle',
    'POST',
    {
      action: 'open',
      contextToken: 'token',
      groups: [
        { spaceId: 'terrace', seats: 4, occupied: 1 },
        { spaceId: 'salon', seats: 4, occupied: 0 },
      ],
    },
    expect.any(String),
  )
})
it('shows pending turns on close and cancellation makes no mutation', async () => {
  vi.mocked(api).mockResolvedValue({ ...context, open: true })
  const close = vi.fn()
  render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurante"
      action="close"
      onClose={close}
      onSaved={vi.fn()}
    />,
  )
  expect(await screen.findByText(/3 turnos pendientes/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(close).toHaveBeenCalled()
  expect(
    vi
      .mocked(api)
      .mock.calls.every(([, method]) => !method || method === 'GET'),
  ).toBe(true)
})
it.each(['open', 'confirm_inventory'] as const)(
  'retains the idempotency key and resets confirmations after a conflict (%s)',
  async (action) => {
    const label = action === 'open' ? 'Abrir lista' : 'Confirmar ocupación'
    const { ApiError } = await import('./api')
    const latest = { ...context, open: action === 'confirm_inventory' }
    const empty = { ...latest, groups: [] }
    vi.mocked(api)
      .mockResolvedValueOnce(empty)
      .mockRejectedValueOnce(new ApiError(503, 'Unavailable'))
      .mockRejectedValueOnce(new ApiError(409, 'Conflict'))
      .mockResolvedValueOnce(latest)
    render(
      <QueueLifecycleSheet
        queueId="q"
        name="Restaurante"
        action={action}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: label }))
    await screen.findByText('Unavailable')
    fireEvent.click(screen.getByRole('button', { name: label }))
    await screen.findByText(/Revisa los datos actualizados/)
    const writes = vi
      .mocked(api)
      .mock.calls.filter(([, method]) => method === 'POST')
    expect(writes).toHaveLength(2)
    expect(writes[0]?.[3]).toBe(writes[1]?.[3])
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
  },
)
it('confirms an already-open inventory explicitly with an all-free shortcut, not implicit zero or a correction reason', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('opening-context')
      ? { ...context, open: true }
      : { ok: true },
  )
  render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurante"
      action="confirm_inventory"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  await screen.findByRole('tab', { name: 'Terraza' })
  const confirm = screen.getByRole('button', { name: 'Confirmar ocupación' })
  expect(confirm).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Mesas de 4/ }))
  expect(
    screen.getByLabelText('Terraza · 4 plazas ocupadas fuera de la lista'),
  ).toHaveValue(null)
  expect(
    screen.queryByLabelText('Motivo de la corrección o liberación'),
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Todas las mesas restantes están libres',
    }),
  )
  expect(confirm).toBeEnabled()
  expect(vi.mocked(api).mock.calls).toHaveLength(1)
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/queues/q/lifecycle',
      'POST',
      {
        action: 'confirm_inventory',
        contextToken: 'token',
        groups: [
          { spaceId: 'terrace', seats: 4, occupied: 0 },
          { spaceId: 'salon', seats: 4, occupied: 0 },
        ],
      },
      expect.any(String),
    ),
  )
})
it('shows recorded holds without treating unconfirmed empty groups as known zero during closed corrections', async () => {
  vi.mocked(api).mockResolvedValue({
    ...context,
    inventoryConfirmed: false,
    readiness: { state: 'pending', reasons: ['inventory_refresh_required'] },
    groups: context.groups.map((g, i) => ({
      ...g,
      occupied: i === 0 ? 1 : 0,
    })),
  })
  render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurante"
      action="occupancy"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  await screen.findByRole('tab', { name: 'Terraza' })
  fireEvent.click(screen.getByRole('button', { name: /Mesas de 4/ }))
  expect(
    screen.getByLabelText('Terraza · 4 plazas ocupadas fuera de la lista'),
  ).toHaveValue(1)
  expect(screen.getByRole('button', { name: 'Guardar cambio' })).toBeDisabled()
  fireEvent.click(screen.getByRole('tab', { name: 'Salón' }))
  fireEvent.click(screen.getByRole('button', { name: /Mesas de 4/ }))
  expect(
    screen.getByLabelText('Salón · 4 plazas ocupadas fuera de la lista'),
  ).toHaveValue(null)
})
it.each(['disable_intelligence', 'enable_intelligence'] as const)(
  'confirms policy changes in a bottom sheet without changing occupancy (%s)',
  async (action) => {
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('opening-context') ? context : { ok: true },
    )
    const done = vi.fn(),
      close = vi.fn()
    const rendered = render(
      <QueueLifecycleSheet
        queueId="q"
        name="Restaurante"
        action={action}
        onClose={close}
        onSaved={done}
      />,
    )
    await screen.findByText(/Los turnos y la ocupación se mantienen/)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(api).toHaveBeenCalledTimes(1)
    rendered.unmount()
    render(
      <QueueLifecycleSheet
        queueId="q"
        name="Restaurante"
        action={action}
        onClose={close}
        onSaved={done}
      />,
    )
    const button = await screen.findByRole('button', {
      name:
        action === 'disable_intelligence'
          ? 'Desactivar gestión inteligente'
          : 'Volver a gestión automática',
    })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(api).toHaveBeenCalledWith(
      '/queues/q/lifecycle',
      'POST',
      { action, contextToken: 'token' },
      expect.any(String),
    )
  },
)
it('declares full without any occupancy inputs and releases a single configured group', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('opening-context')
      ? {
          ...context,
          serviceOpen: true,
          queueState: 'inactive',
          groups: [{ ...context.groups[0]!, occupied: 1 }],
        }
      : { ok: true },
  )
  const done = vi.fn()
  const view = render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurant"
      action="declare_full"
      onClose={vi.fn()}
      onSaved={done}
    />,
  )
  const activate = await screen.findByRole('button', { name: 'Activar lista' })
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  fireEvent.click(activate)
  await waitFor(() => expect(done).toHaveBeenCalled())
  expect(api).toHaveBeenCalledWith(
    '/queues/q/lifecycle',
    'POST',
    { action: 'declare_full', contextToken: 'token' },
    expect.any(String),
  )
  view.unmount()
  render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurant"
      action="release_unit"
      onClose={vi.fn()}
      onSaved={done}
    />,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Liberar una mesa' }),
  )
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/queues/q/lifecycle',
      'POST',
      {
        action: 'release_unit',
        contextToken: 'token',
        spaceId: 'terrace',
        seats: 4,
      },
      expect.any(String),
    ),
  )
  expect(screen.queryByLabelText('Grupo de mesas')).not.toBeInTheDocument()
})

it('allows confirming inventory in advanced settings without activating an inactive list', async () => {
  vi.mocked(api).mockResolvedValue(context)
  render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurant"
      action="confirm_inventory"
      onClose={() => {}}
      onSaved={() => {}}
    />,
  )
  await screen.findByRole('tab', { name: 'Terraza' })
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Todas las mesas restantes están libres',
    }),
  )
  expect(
    screen.getByRole('button', { name: 'Confirmar ocupación' }),
  ).toBeEnabled()
})

it('selects a second release group without closing its sheet and sends the group tuple', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('opening-context')
      ? {
          ...context,
          groups: context.groups.map((g) => ({ ...g, occupied: 1 })),
        }
      : { ok: true },
  )
  const close = vi.fn()
  render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurant"
      action="release_unit"
      onClose={close}
      onSaved={vi.fn()}
    />,
  )
  const trigger = await screen.findByRole('combobox', {
    name: 'Grupo de mesas',
  })
  expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
  expect(trigger).toHaveTextContent('Terraza · 4 plazas')
  fireEvent.click(trigger)
  {
    const option = await screen.findByRole('option', {
      name: 'Salón · 4 plazas',
    })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option, { detail: 1 })
  }
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Liberar una mesa' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/queues/q/lifecycle',
      'POST',
      {
        action: 'release_unit',
        contextToken: 'token',
        spaceId: 'salon',
        seats: 4,
      },
      expect.any(String),
    ),
  )
})
