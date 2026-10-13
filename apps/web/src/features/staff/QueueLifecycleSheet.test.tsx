import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { QueueLifecycleCommand, QueueOpeningContext } from '@noqueue/contracts/staff'
import { QueueLifecycleSheet } from './QueueLifecycleSheet'
import { ApiError, api } from './api'

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
  readiness: { state: 'active', reasons: [] },
  // Legacy snapshots may still contain inventory; lifecycle UI must ignore it.
  groups: [
    { spaceId: 'terrace', spaceName: 'Terraza', seats: 4, count: 3, allocated: 3, occupied: 3 },
  ],
}

it('opens a restaurant queue without asking for or applying occupancy answers', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('opening-context') ? context : { ok: true },
  )
  const close = vi.fn()
  const saved = vi.fn()
  render(
    <QueueLifecycleSheet queueId="q" name="Restaurante" action="open" onClose={close} onSaved={saved} />,
  )

  expect(await screen.findByRole('button', { name: 'Abrir lista' })).toBeEnabled()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/ocupad/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(screen.queryByText(/inventario|mesas ocupadas/i)).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  const write = vi.mocked(api).mock.calls.find(([, method]) => method === 'POST')
  expect(write?.[0]).toBe('/queues/q/lifecycle')
  expect(write?.[2]).toMatchObject({ action: 'open', contextToken: 'token' })
  // Empty groups are a backwards-compatible wire alias, never a physical assertion.
  expect((write?.[2] as QueueLifecycleCommand & { groups?: unknown[] }).groups ?? []).toEqual([])
  expect(close).toHaveBeenCalledOnce()
})

it('keeps close as a queue operation and explains existing turn deadlines are preserved', async () => {
  vi.mocked(api).mockResolvedValue({ ...context, open: true })
  const close = vi.fn()
  render(
    <QueueLifecycleSheet queueId="q" name="Restaurante" action="close" onClose={close} onSaved={vi.fn()} />,
  )

  await screen.findByRole('button', { name: 'Cerrar lista' })
  expect(screen.getByText(/conservan su plazo de llegada/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
  expect(close).toHaveBeenCalledOnce()
  expect(vi.mocked(api).mock.calls.every(([, method]) => !method || method === 'GET')).toBe(true)
})

it('keeps the same idempotency key after an unknown outcome, then refreshes context after a conflict', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(context)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockRejectedValueOnce(new ApiError(409, 'Conflict'))
    .mockResolvedValueOnce({ ...context, contextToken: 'refreshed' })
  render(
    <QueueLifecycleSheet queueId="q" name="Restaurante" action="open" onClose={vi.fn()} onSaved={vi.fn()} />,
  )

  const open = await screen.findByRole('button', { name: 'Abrir lista' })
  fireEvent.click(open)
  await screen.findByText('Unavailable')
  fireEvent.click(open)
  await screen.findByText(/Revisa los datos actualizados/)
  const writes = vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST')
  expect(writes).toHaveLength(2)
  expect(writes[0]?.[3]).toBe(writes[1]?.[3])
  expect(screen.getByRole('button', { name: 'Abrir lista' })).toBeEnabled()
})

it('does not submit retired occupancy operations', async () => {
  vi.mocked(api).mockResolvedValue(context)
  render(
    <QueueLifecycleSheet
      queueId="q"
      name="Restaurante"
      action={'release_unit' as QueueLifecycleCommand['action']}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  )
  expect(await screen.findByRole('button', { name: 'Operación retirada' })).toBeDisabled()
  expect(screen.queryByText(/liberar recurso/i)).not.toBeInTheDocument()
  expect(vi.mocked(api).mock.calls.every(([, method]) => !method || method === 'GET')).toBe(true)
})
