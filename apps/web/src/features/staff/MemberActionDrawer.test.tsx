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
      action={{
        kind: 'edit',
        member: {
          id: 'legacy',
          name: 'Legacy User',
          username: null as unknown as string,
          role: 'legacy' as 'viewer',
          active: 1,
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
    document.getElementById(role.getAttribute('aria-describedby')!),
  ).toHaveAttribute('role', 'alert')
})
