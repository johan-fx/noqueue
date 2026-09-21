import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServiceConfigDrawer } from './ServiceConfigDrawer'
import { emptyService } from './service-config/model'

afterEach(cleanup)

function renderWizard(onSave = vi.fn()) {
  render(
    <ServiceConfigDrawer open mode="create" onClose={vi.fn()} onSave={onSave} />,
  )
  return onSave
}

async function next() {
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
}

describe('service configuration wizard', () => {
  it('does not leave the first step when the name is empty', async () => {
    const onSave = renderWizard()
    await next()
    expect(screen.getByRole('dialog', { name: 'Configuración restaurante' })).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('walks the restaurant steps and submits hours and numbers', async () => {
    const onSave = renderWizard()
    fireEvent.change(screen.getByLabelText('Nombre del servicio'), {
      target: { value: 'Chez Paul' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Martes' }))
    await next()
    expect(screen.getByText('Espacio 1')).toBeVisible()
    await next()
    fireEvent.change(screen.getByLabelText('Tiempo medio del cliente en mesa'), {
      target: { value: '45' },
    })
    await next()
    expect(screen.getByText('Preferencia de espacio por asignación')).toBeVisible()
    await next()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chez Paul',
        type: 'restaurant',
        averageMinutes: 45,
        schedules: expect.arrayContaining([
          { day: 1, from: '12:00', to: '23:00' },
          { day: 2, from: '12:00', to: '23:00' },
        ]),
      }),
    ))
  })

  it('does not ask a reception for spaces', async () => {
    render(
      <ServiceConfigDrawer
        open
        mode="create"
        initial={{
          ...emptyService,
          name: 'Lobby',
          type: 'reception',
          spaces: [],
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )
    await next()
    expect(screen.getByText('Servicios de recepción')).toBeVisible()
    expect(screen.queryByRole('button', { name: '+ Añadir espacio' })).not.toBeInTheDocument()
    expect(screen.queryByText('Preferencia de espacio por asignación')).not.toBeInTheDocument()
  })
})
