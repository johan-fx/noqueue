import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemberActionDrawer } from './MemberActionDrawer'
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('associates validation errors with their controls and clears associations after valid submission', async () => {
  const onSubmit = vi.fn(async () => undefined)
  render(
    <MemberActionDrawer
      queueCatalog={{
        queues: [{ id: 'q1', name: 'Restaurante' }],
        loading: false,
        error: '',
        onRetry: vi.fn(),
      }}
      action={{ kind: 'create' }}
      busy={false}
      error=""
      finalFocus={{ current: null }}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  )
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
  for (const label of [
    'Nombre',
    'Usuario',
    'Contraseña inicial (mínimo 15 caracteres)',
  ]) {
    const input = screen.getByLabelText(label)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const id = input.getAttribute('aria-describedby')!
    expect(document.getElementById(id)).toHaveAttribute('role', 'alert')
  }
  expect(
    screen.getByRole('button', { name: 'Volver' }).querySelector('svg'),
  ).toHaveClass('lucide-chevron-left')
  fireEvent.change(screen.getByLabelText('Nombre'), {
    target: { value: 'Valid Name' },
  })
  fireEvent.change(screen.getByLabelText('Usuario'), {
    target: { value: 'valid.user' },
  })
  fireEvent.change(
    screen.getByLabelText('Contraseña inicial (mínimo 15 caracteres)'),
    { target: { value: 'valid-password-123456' } },
  )
  fireEvent.click(
    screen.getByRole('combobox', { name: 'Servicios a gestionar' }),
  )
  fireEvent.click(
    await screen.findByRole('option', { name: 'Restaurante' }),
  )
  fireEvent.keyDown(
    screen.getByRole('combobox', { name: 'Buscar servicios' }),
    { key: 'Escape' },
  )
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
  for (const label of [
    'Nombre',
    'Usuario',
    'Contraseña inicial (mínimo 15 caracteres)',
  ]) {
    const input = screen.getByLabelText(label)
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(input).not.toHaveAttribute('aria-describedby')
  }
})

it('associates role validation errors and initializes nullable usernames as an empty controlled value', () => {
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)
  render(
    <MemberActionDrawer
      queueCatalog={{
        queues: [{ id: 'q1', name: 'Restaurante' }],
        loading: false,
        error: '',
        onRetry: vi.fn(),
      }}
      action={{
        kind: 'edit',
        member: {
          id: 'legacy',
          name: 'Legacy User',
          username: null as unknown as string,
          role: 'legacy' as 'viewer',
          active: 1,
          queueIds: [],
          canEditDetails: true,
        },
      }}
      busy={false}
      error=""
      finalFocus={{ current: null }}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />,
  )
  expect(screen.getByLabelText('Usuario')).toHaveValue('')
  expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(
    /value.*null|controlled.*uncontrolled/i,
  )
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
  const role = screen.getByRole('combobox', { name: 'Rol' })
  expect(role).toHaveAttribute('aria-invalid', 'true')
  expect(
    document.getElementById(
      role
        .getAttribute('aria-describedby')!
        .split(' ')
        .find((id) => id === 'member-role-error')!,
    ),
  ).toHaveAttribute('role', 'alert')
})

it('updates selected role summary, excludes owner and keeps help separate from form submission', async () => {
  const onSubmit = vi.fn(),
    onClose = vi.fn()
  const { rerender } = render(
    <MemberActionDrawer
      queueCatalog={{
        queues: [{ id: 'q1', name: 'Restaurante' }],
        loading: false,
        error: '',
        onRetry: vi.fn(),
      }}
      action={{ kind: 'create' }}
      busy={false}
      error=""
      finalFocus={{ current: null }}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  )
  const child = screen.getByRole('dialog', { name: 'Crear usuario' })
  const role = screen.getByRole('combobox', { name: 'Rol' })
  const summaryId = role.getAttribute('aria-describedby')!
  expect(document.getElementById(summaryId)).toHaveTextContent(
    'Consulta y gestiona solo los servicios asignados',
  )
  fireEvent.click(role)
  expect(
    screen.queryByRole('option', { name: 'Administrador' }),
  ).not.toBeInTheDocument()
  const option = await screen.findByRole('option', { name: 'Solo lectura' })
  fireEvent.pointerDown(option, { pointerType: 'mouse' })
  fireEvent.click(option)
  expect(document.getElementById(summaryId)).toHaveTextContent(
    'Consulta los servicios y las listas',
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Ver permisos de Solo lectura' }),
  )
  const help = await screen.findByRole('dialog', {
    name: 'Permisos · Solo lectura',
  })
  fireEvent.keyDown(help, { key: 'Escape' })
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Permisos · Solo lectura' }),
    ).not.toBeInTheDocument(),
  )
  expect(child).toBeVisible()
  expect(onClose).not.toHaveBeenCalled()
  expect(onSubmit).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Ver permisos de Solo lectura' }),
  )
  rerender(
    <MemberActionDrawer
      queueCatalog={{
        queues: [{ id: 'q1', name: 'Restaurante' }],
        loading: false,
        error: '',
        onRetry: vi.fn(),
      }}
      action={{ kind: 'create' }}
      busy
      error=""
      finalFocus={{ current: null }}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  )
  expect(
    screen.queryByRole('dialog', { name: 'Permisos · Solo lectura' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Ver permisos de Solo lectura' }),
  ).toBeDisabled()
})

it('does not show role help in password mode', () => {
  render(
    <MemberActionDrawer
      queueCatalog={{
        queues: [{ id: 'q1', name: 'Restaurante' }],
        loading: false,
        error: '',
        onRetry: vi.fn(),
      }}
      action={{
        kind: 'password',
        member: {
          id: 'staff',
          name: 'Ana',
          username: 'ana',
          role: 'viewer',
          active: 1,
          queueIds: [],
          canEditDetails: true,
        },
      }}
      busy={false}
      error=""
      finalFocus={{ current: null }}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />,
  )
  expect(
    screen.queryByRole('button', { name: /Ver permisos/ }),
  ).not.toBeInTheDocument()
})

it('preloads assignments in edit, removes chips and submits only explicit selected IDs', async () => {
  const onSubmit = vi.fn(async () => undefined)
  render(
    <MemberActionDrawer
      action={{
        kind: 'edit',
        member: {
          id: 'm',
          name: 'Ana',
          username: 'ana.staff',
          role: 'queue_staff',
          queueIds: ['q1', 'q2'],
          active: 1,
          canEditDetails: true,
        },
      }}
      queueCatalog={{
        queues: [
          { id: 'q1', name: 'Recepción' },
          { id: 'q2', name: 'Bar' },
        ],
        loading: false,
        error: '',
        onRetry: vi.fn(),
      }}
      busy={false}
      error=""
      finalFocus={{ current: null }}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Quitar Bar' }))
  expect(
    screen.queryByRole('button', { name: 'Quitar Bar' }),
  ).not.toBeInTheDocument()
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Ana',
      username: 'ana.staff',
      role: 'queue_staff',
      queueIds: ['q1'],
    }),
  )
})

it.each([
  { loading: true, error: '', text: 'Cargando servicios…' },
  {
    loading: false,
    error: 'No se pudieron cargar',
    text: 'No se pudieron cargar',
  },
  {
    loading: false,
    error: '',
    text: 'No hay servicios disponibles. Crea un servicio antes de asignar personal.',
  },
])(
  'blocks saving staff when the catalogue is unavailable: $text',
  ({ loading, error, text }) => {
    const onRetry = vi.fn()
    render(
      <MemberActionDrawer
        action={{ kind: 'create' }}
        queueCatalog={{ queues: [], loading, error, onRetry }}
        busy={false}
        error=""
        finalFocus={{ current: null }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(text)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Crear acceso' })).toBeDisabled()
    if (!loading) {
      fireEvent.click(
        screen.getByRole('button', { name: 'Actualizar servicios' }),
      )
      expect(onRetry).toHaveBeenCalledOnce()
    }
  },
)
