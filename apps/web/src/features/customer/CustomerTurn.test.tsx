import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Entry } from '@noqueue/contracts/queue'
import { CustomerTurn } from './CustomerTurn'

const resource = vi.hoisted(() => ({
  data: null as Entry | null,
  refresh: vi.fn(),
}))
vi.mock('./public-resource', async (original) => ({
  ...(await original<typeof import('./public-resource')>()),
  usePublicResource: () => ({ ...resource, updatedAt: 1000, error: false }),
}))
function fixture(size = 4): Entry {
  return {
    code: 'XP03',
    position: 6,
    etaMinutes: 30,
    estimateQuality: 'estimated',
    status: 'waiting',
    notification: 'disabled',
    customer: {
      service: {
        id: 'restaurant',
        name: 'Restaurante',
        venueId: 'venue',
        venueName: 'Hotel',
        type: 'restaurant',
        open: 1,
        receptionServices: [],
        spaces: [
          { id: 'terrace', name: 'Terraza', maxPartySize: 8 },
          { id: 'bar', name: 'Barra', maxPartySize: 2 },
          { id: 'large', name: 'Salón', maxPartySize: 20 },
        ],
      },
      displayName: 'María',
      partySize: size,
      preferredSpaceId: 'terrace',
      locale: 'es',
      version: 7,
      serverNow: 1000,
      createdAt: 100,
      calledAt: null,
      arrivalDeadlineAt: null,
      arrivedAt: null,
      phase: 'waiting',
      actions: ['update', 'cancel', 'yield'],
    },
  }
}
function mount(size = 4, lang = 'es') {
  resource.data = fixture(size)
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  const tree = (
    <MemoryRouter initialEntries={[`/t/token?lang=${lang}`]}>
      <Routes>
        <Route path="/t/:recoveryToken" element={<CustomerTurn />} />
      </Routes>
    </MemoryRouter>
  )
  const view = render(tree)
  return {
    fetcher,
    refresh: () =>
      view.rerender(
        <MemoryRouter initialEntries={[`/t/token?lang=${lang}`]}>
          <Routes>
            <Route path="/t/:recoveryToken" element={<CustomerTurn />} />
          </Routes>
        </MemoryRouter>,
      ),
  }
}
async function editGuests() {
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Modificar número de comensales',
    }),
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('keeps the turn behind one sheet and opens the modify menu without writing', async () => {
  const { fetcher } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByRole('heading', { name: '¿Qué quieres modificar?' }),
  ).toBeVisible()
  expect(
    within(dialog).getByRole('button', { name: 'Modificar sala' }),
  ).toBeVisible()
  expect(
    within(dialog).getByRole('button', { name: 'Pasar turno' }),
  ).toBeVisible()
  expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
  expect(screen.getByText('XP03')).toBeInTheDocument()
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'No modificar nada' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(fetcher).not.toHaveBeenCalled()
})
it('edits a delta, previews the total, and writes only on confirmation preserving the snapshot', async () => {
  const { fetcher } = mount()
  await editGuests()
  expect(screen.getByLabelText('Variación de comensales')).toHaveTextContent(
    '0',
  )
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(
    screen.getByRole('heading', { name: 'Vas a añadir comensales' }),
  ).toBeVisible()
  expect(screen.getByLabelText('Nuevo número de comensales')).toHaveTextContent(
    '6',
  )
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
    action: 'update',
    version: 7,
    displayName: 'María',
    partySize: 6,
    preferredSpaceId: 'terrace',
    locale: 'es',
  })
})
it('supports reductions, caps the total at one, and discards on cancel', async () => {
  const { fetcher } = mount(2)
  await editGuests()
  fireEvent.click(screen.getByRole('button', { name: 'Menos comensales' }))
  expect(
    screen.getByRole('button', { name: 'Menos comensales' }),
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(
    screen.getByRole('heading', { name: 'Vas a reducir comensales' }),
  ).toBeVisible()
  expect(screen.getByLabelText('Nuevo número de comensales')).toHaveTextContent(
    '1',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Anular' }))
  expect(fetcher).not.toHaveBeenCalled()
})
it('blocks incompatible additions without silently selecting fastest', async () => {
  const { fetcher } = mount(8)
  await editGuests()
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  expect(screen.getByText(/Modificar sala.*antes de continuar/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  expect(fetcher).not.toHaveBeenCalled()
})
it('changes only the selected space on explicit save and disables incompatible rooms', async () => {
  const { fetcher } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Modificar sala' }))
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  expect(screen.getByRole('radio', { name: 'Barra' })).toBeDisabled()
  fireEvent.click(screen.getByRole('radio', { name: 'Opción más rápida' }))
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
    action: 'update',
    version: 7,
    displayName: 'María',
    partySize: 4,
    preferredSpaceId: 'fastest',
    locale: 'es',
  })
})
it('blocks stale unsubmitted edits when polling changes version or staff calls', async () => {
  const { fetcher, refresh } = mount()
  await editGuests()
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  resource.data = {
    ...resource.data!,
    customer: {
      ...resource.data!.customer!,
      version: 8,
      phase: 'called',
      actions: [],
    },
  }
  refresh()
  expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  expect(screen.getByText(/Cierra esta ventana y revisa/)).toBeVisible()
  expect(fetcher).not.toHaveBeenCalled()
})
it('freezes body and key for retries after a lost response even after polling changes the turn', async () => {
  const { fetcher, refresh } = mount()
  fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await editGuests()
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  await screen.findByRole('alert')
  resource.data = {
    ...resource.data!,
    customer: { ...resource.data!.customer!, version: 8, partySize: 5 },
  }
  refresh()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(fetcher.mock.calls[1]).toEqual(fetcher.mock.calls[0])
})
it('refreshes on conflict and requires closing and reviewing instead of retrying the old edit', async () => {
  const { fetcher } = mount()
  fetcher.mockResolvedValue(
    Response.json({ error: 'version_conflict' }, { status: 409 }),
  )
  await editGuests()
  fireEvent.click(screen.getByRole('button', { name: 'Más comensales' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  await screen.findByRole('alert')
  expect(resource.refresh).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
})
it('provides English copy for the menu and guest editor', async () => {
  mount(4, 'en')
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Change number of guests' }),
  )
  expect(
    screen.getByRole('heading', { name: 'Change the number of guests?' }),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
})

it('matches the abandon confirmation and does not send when staying', async () => {
  const { fetcher } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Abandonar la lista' }))
  expect(
    await screen.findByRole('heading', {
      name: '¿Confirmas que quieres abandonar la lista de espera?',
    }),
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Sí, abandonar la lista de espera' }),
  ).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: 'Continuar en la lista de espera' }),
  )
  expect(fetcher).not.toHaveBeenCalled()
})
it('caps at twenty and does not expose name editing', async () => {
  mount(20)
  await editGuests()
  expect(screen.getByRole('button', { name: 'Más comensales' })).toBeDisabled()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
it('yields through the same dialog and locks double submissions', async () => {
  const { fetcher } = mount()
  let resolve!: (value: Response) => void
  fetcher.mockReturnValue(
    new Promise<Response>((done) => {
      resolve = done
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Pasar turno' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  const confirm = screen.getByRole('button', { name: 'Sí, pasar turno' })
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
    action: 'yield',
    version: 7,
  })
  resolve(Response.json({ ok: true }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
})

it('shows yield feedback only after confirmed success and a refreshed matching version', async () => {
  const { fetcher, refresh } = mount()
  let resolve!: (value: Response) => void
  fetcher.mockReturnValue(
    new Promise<Response>((done) => {
      resolve = done
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Pasar turno' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sí, pasar turno' }))
  expect(screen.queryByText('Has pasado turno')).not.toBeInTheDocument()
  resolve(Response.json({ ok: true }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(screen.queryByText('Has pasado turno')).not.toBeInTheDocument()
  resource.data = {
    ...resource.data!,
    position: 10,
    etaMinutes: 0,
    estimateQuality: 'unknown',
    customer: { ...resource.data!.customer!, version: 8 },
  }
  refresh()
  expect(screen.getByText('Has pasado turno')).toBeVisible()
  expect(
    screen.getByText('Consulta tu posición y tiempo de espera actualizados.'),
  ).toBeVisible()
  expect(screen.getByText('9 turnos')).toBeVisible()
  expect(screen.getByText('Sin estimación')).toBeVisible()
  expect(
    screen.queryByText(/tiempo de espera ha aumentado/),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  expect(screen.queryByText('Has pasado turno')).not.toBeInTheDocument()
})
it('does not show success after a rejected yield or a lost response until identical retry confirms it', async () => {
  const { fetcher, refresh } = mount()
  fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Pasar turno' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sí, pasar turno' }))
  await screen.findByRole('alert')
  resource.data = {
    ...resource.data!,
    customer: { ...resource.data!.customer!, version: 8 },
  }
  refresh()
  expect(screen.queryByText('Has pasado turno')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Sí, pasar turno' }))
  expect(await screen.findByText('Has pasado turno')).toBeVisible()
  expect(fetcher.mock.calls[1]).toEqual(fetcher.mock.calls[0])
})
it('does not turn an incompatible-successor error into a yield confirmation', async () => {
  const { fetcher } = mount()
  fetcher.mockResolvedValue(
    Response.json({ error: 'no_compatible_successor' }, { status: 409 }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Pasar turno' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sí, pasar turno' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No hay otro grupo compatible',
  )
  expect(screen.queryByText('Has pasado turno')).not.toBeInTheDocument()
})

it('clears confirmed yield feedback on phase changes without reappearing when the phase returns', async () => {
  const { refresh } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Modificar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Pasar turno' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sí, pasar turno' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  resource.data = {
    ...resource.data!,
    customer: { ...resource.data!.customer!, version: 8 },
  }
  refresh()
  expect(screen.getByText('Has pasado turno')).toBeVisible()
  resource.data = {
    ...resource.data!,
    customer: { ...resource.data!.customer!, phase: 'approaching' },
  }
  refresh()
  expect(screen.queryByText('Has pasado turno')).not.toBeInTheDocument()
  resource.data = {
    ...resource.data!,
    customer: { ...resource.data!.customer!, phase: 'waiting' },
  }
  refresh()
  expect(screen.queryByText('Has pasado turno')).not.toBeInTheDocument()
})
