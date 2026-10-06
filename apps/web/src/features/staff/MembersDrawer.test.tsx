import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MembersDrawer } from './MembersDrawer'
import { api } from './api'
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const member = {
  id: 'staff',
  name: 'Ana',
  username: 'ana.staff',
  role: 'queue_staff',
  active: 1,
  canEditDetails: true,
}
function setup(open = true) {
  vi.mocked(api).mockResolvedValue({ members: [member] })
  const onClose = vi.fn()
  const result = render(
    <MembersDrawer
      open={open}
      venueId="hotel"
      name="Hotel"
      onClose={onClose}
    />,
  )
  return { ...result, onClose }
}
describe('nested member management', () => {
  it('loads only when open and moves creation out of the listing', async () => {
    const { rerender, onClose } = setup(false)
    expect(api).not.toHaveBeenCalled()
    rerender(
      <MembersDrawer open venueId="hotel" name="Hotel" onClose={onClose} />,
    )
    expect(await screen.findByText('Ana')).toBeVisible()
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Añadir usuario' }))
    expect(
      await screen.findByRole('dialog', { name: 'Crear usuario' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Crear usuario' }),
      ).not.toBeInTheDocument(),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
  it('edits all details in one request, keeps failed drafts and locks dismiss while saving', async () => {
    const { onClose } = setup()
    await screen.findByText('Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Editar usuario' }),
    )
    const drawer = await screen.findByRole('dialog', { name: 'Editar usuario' })
    fireEvent.change(within(drawer).getByLabelText('Nombre'), {
      target: { value: 'Ana Nueva' },
    })
    let reject!: (error: Error) => void
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((_resolve, r) => {
          reject = r
        }),
    )
    fireEvent.click(
      within(drawer).getByRole('button', { name: 'Guardar cambios' }),
    )
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/venues/hotel/members/staff/details',
        'PATCH',
        { name: 'Ana Nueva', username: 'ana.staff', role: 'queue_staff' },
      ),
    )
    expect(
      within(drawer).getByRole('button', { name: 'Cancelar' }),
    ).toBeDisabled()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    reject(new Error('No disponible'))
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'No disponible',
    )
    expect(within(drawer).getByLabelText('Nombre')).toHaveValue('Ana Nueva')
  })
})

describe('member action lifecycle', () => {
  it('creates once, closes the child only after success and restores CTA focus', async () => {
    setup()
    await screen.findByText('Ana')
    const add = screen.getByRole('button', { name: 'Añadir usuario' })
    fireEvent.click(add)
    const drawer = await screen.findByRole('dialog', { name: 'Crear usuario' })
    fireEvent.change(within(drawer).getByLabelText('Nombre'), {
      target: { value: 'Nueva Persona' },
    })
    fireEvent.change(within(drawer).getByLabelText('Usuario'), {
      target: { value: ' Nuevo.Staff ' },
    })
    fireEvent.change(
      within(drawer).getByLabelText(
        'Contraseña inicial (mínimo 15 caracteres)',
      ),
      { target: { value: 'secure-password-123456' } },
    )
    let resolve!: (result: unknown) => void
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const form = drawer.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() =>
      expect(
        vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST'),
      ).toHaveLength(1),
    )
    expect(drawer).toBeVisible()
    resolve({ ok: true })
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Crear usuario' }),
      ).not.toBeInTheDocument(),
    )
    expect(api).toHaveBeenCalledWith('/venues/hotel/members', 'POST', {
      name: 'Nueva Persona',
      username: 'nuevo.staff',
      password: 'secure-password-123456',
      role: 'queue_staff',
    })
    await waitFor(() => expect(add).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('Operación guardada')
  })
  it('validates locally and distinguishes committed saves from refresh errors', async () => {
    setup()
    await screen.findByText('Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Añadir usuario' }))
    const drawer = await screen.findByRole('dialog', { name: 'Crear usuario' })
    fireEvent.submit(drawer.querySelector('form')!)
    expect(
      vi.mocked(api).mock.calls.filter(([, method]) => method === 'POST'),
    ).toHaveLength(0)
    fireEvent.change(within(drawer).getByLabelText('Nombre'), {
      target: { value: 'Nueva Persona' },
    })
    fireEvent.change(within(drawer).getByLabelText('Usuario'), {
      target: { value: 'new.staff' },
    })
    fireEvent.change(
      within(drawer).getByLabelText(
        'Contraseña inicial (mínimo 15 caracteres)',
      ),
      { target: { value: 'secure-password-123456' } },
    )
    vi.mocked(api)
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('Error de lectura'))
    fireEvent.submit(drawer.querySelector('form')!)
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Crear usuario' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'La operación se ha guardado, pero no se pudo actualizar el listado',
    )
    expect(screen.getByRole('status')).toHaveTextContent('Operación guardada')
  })
  it('uses the password child and retains the existing membership endpoint for revoke/restore', async () => {
    setup()
    await screen.findByText('Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Restablecer contraseña' }),
    )
    const drawer = await screen.findByRole('dialog', {
      name: 'Restablecer contraseña',
    })
    expect(within(drawer).queryByLabelText('Nombre')).not.toBeInTheDocument()
    fireEvent.change(
      within(drawer).getByLabelText('Nueva contraseña (mínimo 15 caracteres)'),
      { target: { value: 'new-password-123456' } },
    )
    fireEvent.submit(drawer.querySelector('form')!)
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Restablecer contraseña' }),
      ).not.toBeInTheDocument(),
    )
    expect(api).toHaveBeenCalledWith(
      '/venues/hotel/members/staff/password',
      'POST',
      { password: 'new-password-123456' },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana' }))
    vi.mocked(api)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ members: [{ ...member, active: 0 }] })
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Revocar acceso' }),
    )
    await screen.findByText('Acceso revocado')
    expect(api).toHaveBeenCalledWith('/venues/hotel/members/staff', 'PATCH', {
      role: 'queue_staff',
      active: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Restaurar acceso' }),
    )
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/venues/hotel/members/staff', 'PATCH', {
        role: 'queue_staff',
        active: true,
      }),
    )
  })
  it('guards protected editing and revocation, dismisses only the nested drawer with Escape', async () => {
    vi.mocked(api).mockResolvedValue({
      members: [{ ...member, role: 'owner', canEditDetails: false }],
    })
    const onClose = vi.fn()
    render(
      <MembersDrawer open venueId="hotel" name="Hotel" onClose={onClose} />,
    )
    await screen.findByText('Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Editar usuario' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('menuitem', { name: 'Revocar acceso' }),
    ).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir usuario' }))
    const child = await screen.findByRole('dialog', { name: 'Crear usuario' })
    fireEvent.keyDown(child, { key: 'Escape' })
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Crear usuario' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('dialog', { name: 'Gestionar accesos' }),
    ).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('drops late results on venue changes and reopens with a clean draft and fresh list', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const onClose = vi.fn(),
      { rerender } = render(
        <MembersDrawer open venueId="old" name="Old" onClose={onClose} />,
      )
    vi.mocked(api).mockResolvedValue({ members: [member] })
    rerender(
      <MembersDrawer open venueId="hotel" name="Hotel" onClose={onClose} />,
    )
    await screen.findByText('Ana')
    resolve({ members: [{ ...member, name: 'Stale' }] })
    await waitFor(() =>
      expect(screen.queryByText('Stale')).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Añadir usuario' }))
    const child = await screen.findByRole('dialog', { name: 'Crear usuario' })
    fireEvent.change(within(child).getByLabelText('Nombre'), {
      target: { value: 'Draft' },
    })
    rerender(
      <MembersDrawer
        open={false}
        venueId="hotel"
        name="Hotel"
        onClose={onClose}
      />,
    )
    rerender(
      <MembersDrawer open venueId="hotel" name="Hotel" onClose={onClose} />,
    )
    await screen.findByText('Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Añadir usuario' }))
    expect(
      within(
        await screen.findByRole('dialog', { name: 'Crear usuario' }),
      ).getByLabelText('Nombre'),
    ).toHaveValue('')
  })
})

it('restores row action focus after cancelling an edit and the original parent trigger on close', async () => {
  vi.mocked(api).mockResolvedValue({ members: [member] })
  const finalFocus = { current: null as HTMLElement | null },
    onClose = vi.fn()
  const view = render(
    <>
      <button
        ref={(element) => {
          finalFocus.current = element
        }}
      >
        Gestionar
      </button>
      <MembersDrawer
        open
        venueId="hotel"
        name="Hotel"
        onClose={onClose}
        finalFocus={finalFocus}
      />
    </>,
  )
  await screen.findByText('Ana')
  const rowTrigger = screen.getByRole('button', { name: 'Acciones de Ana' })
  fireEvent.click(rowTrigger)
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Editar usuario' }),
  )
  const child = await screen.findByRole('dialog', { name: 'Editar usuario' })
  fireEvent.click(within(child).getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(rowTrigger).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
  expect(onClose).toHaveBeenCalledOnce()
  view.rerender(
    <>
      <button
        ref={(element) => {
          finalFocus.current = element
        }}
      >
        Gestionar
      </button>
      <MembersDrawer
        open={false}
        venueId="hotel"
        name="Hotel"
        onClose={onClose}
        finalFocus={finalFocus}
      />
    </>,
  )
  await waitFor(() => expect(finalFocus.current).toHaveFocus())
})

it('uses the 40px action trigger and reconciles committed access state when refreshing fails', async () => {
  setup()
  await screen.findByText('Ana')
  fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana' }))
  vi.mocked(api)
    .mockResolvedValueOnce({ ok: true })
    .mockRejectedValueOnce(new Error('Refresh failed'))
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Revocar acceso' }),
  )
  await screen.findByRole('alert')
  expect(screen.getByText('Acceso revocado')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana' }))
  expect(
    screen.queryByRole('menuitem', { name: 'Revocar acceso' }),
  ).not.toBeInTheDocument()
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Restaurar acceso' }),
  )
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/venues/hotel/members/staff', 'PATCH', {
      role: 'queue_staff',
      active: true,
    }),
  )
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(
        ([, method, body]) =>
          method === 'PATCH' && (body as { active?: boolean }).active === false,
      ),
  ).toHaveLength(1)
})

it('never opens a stale edit after a committed edit with failed refresh', async () => {
  setup()
  await screen.findByText('Ana')
  fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana' }))
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Editar usuario' }),
  )
  const drawer = await screen.findByRole('dialog', { name: 'Editar usuario' })
  fireEvent.change(within(drawer).getByLabelText('Nombre'), {
    target: { value: ' Nueva Ana ' },
  })
  fireEvent.change(within(drawer).getByLabelText('Usuario'), {
    target: { value: ' NUEVA.ANA ' },
  })
  fireEvent.click(within(drawer).getByRole('combobox', { name: 'Rol' }))
  const roleOption = await screen.findByRole('option', { name: 'Solo lectura' })
  fireEvent.pointerDown(roleOption, { pointerType: 'mouse' })
  fireEvent.click(roleOption)
  vi.mocked(api)
    .mockResolvedValueOnce({ ok: true })
    .mockRejectedValueOnce(new Error('Refresh failed'))
  fireEvent.submit(drawer.querySelector('form')!)
  await screen.findByRole('alert')
  expect(api).toHaveBeenCalledWith(
    '/venues/hotel/members/staff/details',
    'PATCH',
    { name: 'Nueva Ana', username: 'nueva.ana', role: 'viewer' },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Acciones de Nueva Ana' }))
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Editar usuario' }),
  )
  expect(
    within(
      await screen.findByRole('dialog', { name: 'Editar usuario' }),
    ).getByLabelText('Nombre'),
  ).toHaveValue('Nueva Ana')
  const reopened = screen.getByRole('dialog', { name: 'Editar usuario' })
  expect(within(reopened).getByLabelText('Usuario')).toHaveValue('nueva.ana')
  expect(
    within(reopened).getByRole('combobox', { name: 'Rol' }),
  ).toHaveTextContent('Solo lectura')
})

it('uses a 40px action trigger', async () => {
  setup()
  await screen.findByText('Ana')
  expect(screen.getByRole('button', { name: 'Acciones de Ana' })).toHaveClass(
    'size-10',
  )
})

it('makes creation refresh failures recoverable without actionable stale rows and focuses retry', async () => {
  setup()
  await screen.findByText('Ana')
  fireEvent.click(screen.getByRole('button', { name: 'Añadir usuario' }))
  const drawer = await screen.findByRole('dialog', { name: 'Crear usuario' })
  fireEvent.change(within(drawer).getByLabelText('Nombre'), {
    target: { value: 'Nueva Persona' },
  })
  fireEvent.change(within(drawer).getByLabelText('Usuario'), {
    target: { value: 'new.staff' },
  })
  fireEvent.change(
    within(drawer).getByLabelText('Contraseña inicial (mínimo 15 caracteres)'),
    { target: { value: 'secure-password-123456' } },
  )
  vi.mocked(api)
    .mockResolvedValueOnce({ id: 'new-staff', username: 'new.staff' })
    .mockRejectedValueOnce(new Error('Refresh failed'))
  fireEvent.submit(drawer.querySelector('form')!)
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Acciones de Ana' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Añadir usuario' })).toBeDisabled()
  const retry = screen.getByRole('button', { name: 'Actualizar listado' })
  await waitFor(() => expect(retry).toHaveFocus())
  vi.mocked(api).mockResolvedValueOnce({
    members: [
      member,
      {
        ...member,
        id: 'new-staff',
        name: 'Nueva Persona',
        username: 'new.staff',
      },
    ],
  })
  fireEvent.click(retry)
  await screen.findByText('Nueva Persona')
  expect(screen.getByRole('button', { name: 'Acciones de Ana' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Añadir usuario' })).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: 'Actualizar listado' }),
  ).not.toBeInTheDocument()
})
