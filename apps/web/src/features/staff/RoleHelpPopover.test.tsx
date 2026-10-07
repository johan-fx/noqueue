import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  capabilities,
  roleCapabilities,
  type StaffRole,
} from '@noqueue/contracts/staff'
import { RoleHelpPopover } from './RoleHelpPopover'
import { roleInformation, capabilityLabels } from './member-model'
afterEach(cleanup)
it.each(['owner', 'venue_manager', 'queue_staff', 'viewer'] as StaffRole[])(
  'shows contract-derived permissions for %s without submitting',
  async (role) => {
    const submit = vi.fn()
    render(
      <form onSubmit={submit}>
        <RoleHelpPopover role={role} />
      </form>,
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: `Ver permisos de ${roleInformation[role].label}`,
      }),
    )
    const popup = await screen.findByRole('dialog', {
      name: `Permisos · ${roleInformation[role].label}`,
    })
    const allowed = within(popup).getByRole('list', { name: 'Puede hacer' })
    for (const capability of capabilities)
      expect(
        within(allowed).queryByText(capabilityLabels[capability]) !== null,
      ).toBe(roleCapabilities[role].includes(capability))
    const missing = capabilities.filter(
      (capability) => !roleCapabilities[role].includes(capability),
    )
    if (missing.length)
      for (const capability of missing)
        expect(
          within(popup).getByRole('list', { name: 'No incluye' }),
        ).toHaveTextContent(capabilityLabels[capability])
    expect(submit).not.toHaveBeenCalled()
  },
)
it('closes and stays closed after becoming disabled, and shows revoked context', async () => {
  const { rerender } = render(
    <RoleHelpPopover role="viewer" revoked trigger="icon" />,
  )
  const trigger = screen.getByRole('button', {
    name: 'Ver permisos de Solo lectura',
  })
  expect(trigger).toHaveClass('size-10')
  fireEvent.click(trigger)
  expect(
    await screen.findByText(
      'Acceso revocado: este usuario no puede acceder hasta que se restaure su acceso.',
    ),
  ).toBeVisible()
  rerender(<RoleHelpPopover role="viewer" disabled trigger="icon" />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<RoleHelpPopover role="viewer" trigger="icon" />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
