import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Members } from './Members'
afterEach(cleanup)
const name = 'Alejandra María Rodríguez Fernández Con Nombre Extenso'
function renderList() {
  render(
    <Members
      name="Hotel"
      members={[
        {
          id: 'staff',
          name,
          username: 'long.staff.username.withoutspace',
          role: 'venue_manager',
          active: 1,
          canEditDetails: true,
        },
        {
          id: 'owner',
          name: 'Administradora del establecimiento',
          username: 'administrator.longusername',
          role: 'owner',
          active: 1,
          canEditDetails: false,
        },
      ]}
      busy={false}
      loading={false}
      actionOpen={false}
      trigger={{ current: null }}
      onAction={vi.fn()}
      onToggle={vi.fn()}
    />,
  )
}
it('uses native compact dropdown label and item spacing while retaining target geometry', async () => {
  renderList()
  fireEvent.click(screen.getByRole('button', { name: `Acciones de ${name}` }))
  const menu = await screen.findByRole('menu')
  const label = within(menu).getByText('Acciones')
  expect(label).toHaveClass(
    'text-xs',
    'text-muted-foreground',
    'px-1.5',
    'py-1',
  )
  expect(label).not.toHaveClass('h-9', 'text-sm', 'px-2', 'py-2')
  for (const item of within(menu).getAllByRole('menuitem')) {
    expect(item).toHaveClass('h-9', 'gap-1.5', 'px-1.5')
    expect(item).not.toHaveClass('gap-2', 'px-2')
  }
  expect(menu).toHaveClass('w-56', 'rounded-[10px]', 'p-1')
})
it('keeps semantic action columns within the narrow fixed table and wraps long identity/role content only on mobile', () => {
  renderList()
  const table = screen.getByRole('table')
  expect(table).toHaveClass('table-fixed', 'sm:table-auto')
  expect(screen.getByRole('columnheader', { name: 'Acciones' })).toHaveClass(
    'w-18',
    'sm:w-auto',
  )
  expect(screen.getByRole('columnheader', { name: 'Rol' })).toHaveClass(
    'w-[38%]',
    'sm:w-auto',
  )
  for (const row of within(table).getAllByRole('row').slice(1)) {
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(3)
    const [identityCell, roleCell, actionCell] = cells
    if (!identityCell || !roleCell || !actionCell)
      throw new Error('Expected three semantic member cells')
    expect(identityCell).toHaveClass(
      'whitespace-normal',
      '[overflow-wrap:anywhere]',
      'sm:whitespace-nowrap',
    )
    expect(roleCell).toHaveClass('whitespace-normal', 'sm:whitespace-nowrap')
    expect(roleCell.querySelector('[data-slot="badge"]')).toHaveClass(
      'h-auto',
      'max-w-full',
      'whitespace-normal',
      'sm:h-5',
      'sm:whitespace-nowrap',
    )
    expect(within(actionCell).getByRole('button')).toHaveClass('size-10')
  }
  expect(screen.getByText(name)).toBeVisible()
  expect(screen.getByText('Administrador')).toBeVisible()
})

it('keeps badges and separate owner/staff help controls, without invoking member actions', async () => {
  const onAction = vi.fn(),
    onToggle = vi.fn()
  const owner = {
    id: 'owner',
    name: 'Owner',
    username: 'owner',
    role: 'owner' as const,
    active: 0,
    canEditDetails: false,
  }
  const { rerender } = render(
    <Members
      name="Hotel"
      members={[owner]}
      busy={false}
      loading={false}
      actionOpen={false}
      trigger={{ current: null }}
      onAction={onAction}
      onToggle={onToggle}
    />,
  )
  expect(screen.getByText('Administrador')).toHaveAttribute(
    'data-slot',
    'badge',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Ver permisos de Owner' }))
  expect(
    await screen.findByRole('dialog', { name: 'Permisos · Administrador' }),
  ).toHaveTextContent('Acceso revocado')
  expect(onAction).not.toHaveBeenCalled()
  expect(onToggle).not.toHaveBeenCalled()
  rerender(
    <Members
      name="Hotel"
      members={[owner]}
      busy
      loading={false}
      actionOpen
      trigger={{ current: null }}
      onAction={onAction}
      onToggle={onToggle}
    />,
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Ver permisos de Owner' }),
  ).toBeDisabled()
})
