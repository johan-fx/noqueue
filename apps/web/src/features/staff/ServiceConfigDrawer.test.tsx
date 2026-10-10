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
import { ServiceConfigDrawer } from './ServiceConfigDrawer'
import { emptyService } from './service-config/model'

afterEach(cleanup)

function renderWizard(onSave = vi.fn()) {
  render(
    <ServiceConfigDrawer
      open
      mode="create"
      onClose={vi.fn()}
      onSave={onSave}
    />,
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
    expect(
      screen.getByRole('dialog', { name: 'Configuración restaurante' }),
    ).toBeVisible()
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
    fireEvent.change(
      screen.getByLabelText('Tiempo medio del cliente en mesa'),
      {
        target: { value: '45' },
      },
    )
    await next()
    expect(
      screen.getByText('Preferencia de espacio por asignación'),
    ).toBeVisible()
    await next()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Chez Paul',
          type: 'restaurant',
          averageMinutes: 45,
          scheduleGroups: [{ days: [1, 2], twentyFourHours: false, ranges: [{ from: '12:00', to: '23:00' }] }],
        }),
      ),
    )
  })

  it('saves the table breakdown from the advanced space drawer', async () => {
    const onSave = renderWizard()
    fireEvent.change(screen.getByLabelText('Nombre del servicio'), {
      target: { value: 'Chez Paul' },
    })
    await next()
    fireEvent.click(
      screen.getByRole('button', { name: 'Configuración avanzada' }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Configuración avanzada' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'De 2' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Añadir una mesa de 2' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'De 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(screen.getByLabelText('Nº total de mesas disponibles')).toHaveValue(
      3,
    )
    await next()
    await next()
    await next()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          spaces: [
            {
              id: 'legacy-0',
              name: 'Interior',
              tables: 3,
              tableTypes: [
                { seats: 2, count: 2 },
                { seats: 4, count: 1 },
              ],
            },
          ],
        }),
      ),
    )
  })

  it('saves queue times per space and table size from the advanced drawer', async () => {
    const onSave = renderWizard()
    fireEvent.change(screen.getByLabelText('Nombre del servicio'), {
      target: { value: 'Chez Paul' },
    })
    await next()
    fireEvent.click(
      screen.getByRole('button', { name: 'Configuración avanzada' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'De 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'De 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await next()
    fireEvent.click(
      screen.getByRole('button', { name: 'Configuración avanzada' }),
    )
    const advanced = screen.getByRole('dialog', {
      name: 'Configuración avanzada',
    })
    fireEvent.click(
      within(advanced).getByRole('button', { name: 'Mesas de 2' }),
    )
    fireEvent.change(
      within(advanced).getByLabelText('Interior · 2 plazas (min)'),
      {
        target: { value: '50' },
      },
    )
    fireEvent.click(
      within(advanced).getByRole('button', { name: 'Mesas de 4' }),
    )
    fireEvent.change(
      within(advanced).getByLabelText('Interior · 4 plazas (min)'),
      {
        target: { value: '70' },
      },
    )
    fireEvent.click(within(advanced).getByRole('button', { name: 'Confirmar' }))
    await next()
    await next()
    expect(screen.getByText('Interior · 2 plazas: 50 min')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          spaces: [
            expect.objectContaining({
              id: 'legacy-0',
              tableTypes: [
                { seats: 2, count: 1, averageMinutes: 50 },
                { seats: 4, count: 1, averageMinutes: 70 },
              ],
            }),
          ],
        }),
      ),
    )
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
    expect(
      screen.queryByRole('button', { name: '+ Añadir espacio' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Preferencia de espacio por asignación'),
    ).not.toBeInTheDocument()
    await next()
    fireEvent.click(
      screen.getByRole('button', { name: 'Configuración avanzada' }),
    )
    expect(
      screen.queryByRole('tablist', { name: 'Espacios' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Opciones de operación' }),
    )
    expect(screen.getByLabelText('Puestos de atención')).toBeVisible()
  })
})

it('keeps arrival grace out of basic settings and discards advanced changes on back', async () => {
  render(
    <ServiceConfigDrawer
      open
      mode="edit"
      initial={{
        ...emptyService,
        name: 'Simple',
        spaces: [
          {
            id: 'terrace',
            name: 'Terraza',
            tables: 1,
            tableTypes: [{ seats: 4, count: 1, averageMinutes: 40 }],
          },
        ],
      }}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  )
  await next()
  await next()
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  expect(
    screen.queryByLabelText('Plazo de llegada (minutos)'),
  ).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Turnos por delante')).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText('Minutos de espera para acercamiento'),
  ).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Motor de estimación')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Configuración avanzada' }),
  )
  expect(screen.getByLabelText('Turnos por delante')).toHaveValue(2)
  expect(
    screen.getByLabelText('Minutos de espera para acercamiento'),
  ).toHaveValue(10)
  fireEvent.click(screen.getByRole('button', { name: 'Mesas de 4' }))
  fireEvent.change(screen.getByLabelText('Terraza · 4 plazas (min)'), {
    target: { value: '90' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de operación' }))
  expect(screen.queryByLabelText('Motor de estimación')).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText(/todos los recursos están vacíos/),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
  fireEvent.click(
    screen.getByRole('button', { name: 'Configuración avanzada' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Mesas de 4' }))
  expect(screen.getByLabelText('Terraza · 4 plazas (min)')).toHaveValue(40)
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de operación' }))
  expect(screen.queryByLabelText('Motor de estimación')).not.toBeInTheDocument()
})

it('labels pool queue capacity in people rather than turns', async () => {
  render(
    <ServiceConfigDrawer
      open
      mode="edit"
      initial={{ ...emptyService, name: 'Piscina', type: 'pool' }}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  )
  await next()
  expect(screen.getByLabelText('Nº máximo de personas en lista')).toBeVisible()
  expect(
    screen.queryByLabelText('Nº máximo de turnos en lista'),
  ).not.toBeInTheDocument()
})
it('a lost or expired location confirmation disables only final save without losing wizard data', async () => {
  const onSave = vi.fn(),
    props = {
      open: true,
      mode: 'create' as const,
      onClose: vi.fn(),
      onSave,
      initial: { ...emptyService, name: 'Expiry regression' },
    }
  const view = render(
    <ServiceConfigDrawer {...props} {...{ saveDisabled: true }} />,
  )
  for (let i = 0; i < 4; i++) await next()
  const confirm = screen.getByRole('button', { name: /^Confirmar$/ })
  expect(confirm).toBeDisabled()
  fireEvent.click(confirm)
  expect(onSave).not.toHaveBeenCalled()
  view.rerender(<ServiceConfigDrawer {...props} {...{ saveDisabled: false }} />)
  expect(confirm).toBeEnabled()
})
