import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReplacementDecision } from '@noqueue/contracts/staff'
import { ReplacementDecisions } from './ReplacementDecisions'
import { api, ApiError } from './api'
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}))
const initial: ReplacementDecision = {
  id: 'decision',
  entryId: 'original',
  version: 0,
  originalPartySize: 4,
  createdAt: 1,
  reason: 'no_candidate',
  unavailable: null,
  seating: { spaceId: 'inside', spaceName: 'Interior', seats: 4 },
  candidates: [
    { id: 'three', version: 0, code: 'T3', displayName: 'Ana', partySize: 3 },
    { id: 'two', version: 0, code: 'T2', displayName: 'Luis', partySize: 2 },
  ],
}
let rows: ReplacementDecision[]
const onBusy = vi.fn(),
  onResolved = vi.fn(async () => {})
function mount(blocked = false) {
  return render(
    <ReplacementDecisions
      queueId="queue"
      blocked={blocked}
      onBusy={onBusy}
      onResolved={onResolved}
    />,
  )
}
beforeEach(() => {
  sessionStorage.clear()
  rows = structuredClone([initial])
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === 'POST') {
      rows = []
      return { ok: true }
    }
    return rows
  })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
it('opens automatically only when not blocked, shows the suggested group and assigns directly', async () => {
  const v = mount(true)
  await waitFor(() => expect(api).toHaveBeenCalled())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  v.rerender(
    <ReplacementDecisions
      queueId="queue"
      blocked={false}
      onBusy={onBusy}
      onResolved={onResolved}
    />,
  )
  expect(
    await screen.findByRole('dialog', { name: 'Elige otro turno' }),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Asignar grupo de 3' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/queues/queue/commands',
      'POST',
      {
        action: 'resolve_replacement',
        decisionId: 'decision',
        decisionVersion: 0,
        entryId: 'three',
        version: 0,
      },
      expect.any(String),
    ),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(onResolved).toHaveBeenCalledOnce()
})
it('suppresses refreshes without adding list controls and recovers pending notices on list re-entry', async () => {
  const v = mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  v.unmount()
  mount()
  expect(await screen.findByRole('dialog')).toBeVisible()
  expect(vi.mocked(api).mock.calls.filter((c) => c[1] === 'POST')).toHaveLength(
    0,
  )
})
it('offers all alternatives inside the same sheet and can discard for everyone', async () => {
  mount()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Elegir otro turno' }),
  )
  expect(
    screen.getByRole('group', { name: 'Turnos compatibles' }),
  ).toBeVisible()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Descartar aviso' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/queues/queue/commands',
      'POST',
      {
        action: 'dismiss_replacement',
        decisionId: 'decision',
        decisionVersion: 0,
      },
      expect.any(String),
    ),
  )
})
it('shows no assign button with no candidates or invalid context', async () => {
  rows[0]!.candidates = []
  const v = mount()
  expect(
    await screen.findByText('No hay turnos compatibles disponibles.'),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /Asignar grupo/ }),
  ).not.toBeInTheDocument()
  v.unmount()
  rows[0]!.unavailable = 'context'
  mount()
  expect(
    await screen.findByText(/No podemos confirmar el espacio/),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /Asignar grupo/ }),
  ).not.toBeInTheDocument()
})
it('refreshes a conflict without calling another candidate or retrying', async () => {
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === 'POST') {
      rows[0]!.candidates = rows[0]!.candidates.slice(1)
      throw new ApiError(409, 'conflict', 0, 'replacement_changed')
    }
    return rows
  })
  mount()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Asignar grupo de 3' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('conflict')
  expect(
    screen.getByRole('button', { name: 'Asignar grupo de 2' }),
  ).toBeVisible()
  expect(vi.mocked(api).mock.calls.filter((c) => c[1] === 'POST')).toHaveLength(
    1,
  )
})
it('reuses the identical idempotency key after uncertain delivery', async () => {
  let first = true
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === 'POST') {
      if (first) {
        first = false
        throw new ApiError(503, 'temporarily_unavailable')
      }
      rows = []
      return { ok: true }
    }
    return rows
  })
  mount()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Asignar grupo de 3' }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Comprobar asignación' }),
  )
  await waitFor(() =>
    expect(
      vi.mocked(api).mock.calls.filter((c) => c[1] === 'POST'),
    ).toHaveLength(2),
  )
  const calls = vi.mocked(api).mock.calls.filter((c) => c[1] === 'POST')
  expect(calls[1]).toEqual(calls[0])
})
it('handles several decisions oldest first and removes a remotely resolved one', async () => {
  rows.push({ ...structuredClone(initial), id: 'second', createdAt: 2 })
  mount()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Descartar aviso' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  rows = [{ ...structuredClone(initial), id: 'remote', createdAt: 3 }]
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(await screen.findByRole('dialog')).toBeVisible()
  rows = []
  await act(async () => window.dispatchEvent(new Event('focus')))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
})

it('queues notices oldest first without repeatedly reopening a postponed notice', async () => {
  rows.push({
    ...structuredClone(initial),
    id: 'second',
    originalPartySize: 6,
    createdAt: 2,
  })
  mount()
  expect(
    await screen.findByText('No hay otro grupo de 4 compatible con esta mesa.'),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
  expect(
    await screen.findByText('No hay otro grupo de 6 compatible con esta mesa.'),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps read failures out of the list layout and retries on focus', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('offline'))
  mount()
  await waitFor(() => expect(api).toHaveBeenCalledOnce())
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(await screen.findByRole('dialog')).toBeVisible()
})
