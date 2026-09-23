import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateEstablishmentDrawer } from './CreateEstablishmentDrawer'

afterEach(cleanup)

function fillClient() {
  const values: Record<string, string> = {
    'Empresa / organización': 'Hotel Sol',
    'Hotel / establecimiento': 'Sol Centro',
    'Nombre del administrador': 'Ana Ruiz',
    'Usuario del administrador': 'ana.ruiz',
    'Contraseña inicial (mínimo 15 caracteres)': 'clave-segura-15',
    'Confirmar contraseña': 'clave-segura-15',
  }
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
}

describe('create establishment drawer', () => {
  it('opens the service wizard after the client form is valid', async () => {
    const onComplete = vi.fn()
    render(
      <CreateEstablishmentDrawer open onOpenChange={vi.fn()} onComplete={onComplete} />,
    )
    fillClient()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(
      await screen.findByRole('dialog', { name: 'Configuración restaurante' }),
    ).toBeVisible()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('keeps the client drawer when the service wizard is closed', async () => {
    render(
      <CreateEstablishmentDrawer open onOpenChange={vi.fn()} onComplete={vi.fn()} />,
    )
    fillClient()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Volver' }))
    expect(screen.getByRole('dialog', { name: 'Cliente y administrador' })).toBeVisible()
    expect(screen.getByLabelText('Hotel / establecimiento')).toHaveValue('Sol Centro')
  })

  it('blocks continue when the passwords do not match', async () => {
    render(
      <CreateEstablishmentDrawer open onOpenChange={vi.fn()} onComplete={vi.fn()} />,
    )
    fillClient()
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), {
      target: { value: 'otra-clave-distinta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByText('Las contraseñas no coinciden')).toBeVisible()
    expect(
      screen.queryByRole('dialog', { name: 'Configuración restaurante' }),
    ).not.toBeInTheDocument()
  })

  it('toggles password visibility', () => {
    render(
      <CreateEstablishmentDrawer open onOpenChange={vi.fn()} onComplete={vi.fn()} />,
    )
    const password = screen.getByLabelText('Contraseña inicial (mínimo 15 caracteres)')
    expect(password).toHaveAttribute('type', 'password')
    const [show] = screen.getAllByRole('button', { name: 'Mostrar contraseña' })
    if (!show) throw new Error('Falta el botón para mostrar la contraseña')
    fireEvent.click(show)
    expect(password).toHaveAttribute('type', 'text')
  })
})
