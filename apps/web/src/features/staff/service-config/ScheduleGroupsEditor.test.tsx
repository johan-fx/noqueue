import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ServiceConfigDrawer } from '../ServiceConfigDrawer'
import { emptyService } from './model'
afterEach(cleanup)
function wizard() {
  const onSave = vi.fn()
  render(
    <ServiceConfigDrawer
      open
      mode="create"
      initial={{ ...emptyService, name: 'Pool', type: 'pool' }}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  )
  return onSave
}
it('confirms locally, adds separate ownership, edits with accessible icons and frees deleted days', async () => {
  const save = wizard()
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Editar horario 1' }),
    ).toHaveFocus(),
  )
  expect(
    screen.queryByRole('button', { name: 'Lunes' }),
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Añadir horario diferente' }),
  )
  expect(screen.getByRole('button', { name: 'Lunes' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Martes' }))
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Editar horario 1' }))
  expect(screen.getByRole('button', { name: 'Lunes' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Martes' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Confirmar horario 1' }),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar horario 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Editar horario 1' }))
  expect(screen.getByRole('button', { name: 'Lunes' })).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Eliminar horario 1' }),
  ).toBeDisabled()
  expect(save).not.toHaveBeenCalled()
})
it('keeps invalid active groups open on confirmation, switch and Next; discards extra drafts', () => {
  wizard()
  fireEvent.click(
    screen.getByRole('button', { name: 'Añadir horario diferente' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Selecciona al menos un día',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Editar horario 1' }))
  expect(screen.getByRole('button', { name: 'Lunes' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  expect(screen.getByLabelText('Nombre del servicio')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar horario 2' }))
  expect(screen.queryByText('Horario 2')).not.toBeInTheDocument()
})
it('retains cached timed ranges across full-day mode and wizard navigation, and persists active modes only', async () => {
  const save = wizard()
  fireEvent.change(screen.getByLabelText('Desde'), {
    target: { value: '10:00' },
  })
  fireEvent.click(screen.getByRole('switch', { name: 'Abierto 24 horas' }))
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
  fireEvent.click(screen.getByRole('button', { name: 'Editar horario 1' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Abierto 24 horas' }))
  expect(screen.getByLabelText('Desde')).toHaveValue('10:00')
  expect(
    screen.getByRole('button', { name: 'Eliminar franja 1' }),
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('switch', { name: 'Abierto 24 horas' }))
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  await vi.waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleGroups: [{ days: [1], twentyFourHours: true, ranges: [] }],
      }),
    ),
  )
  expect(save.mock.calls[0]![0]).not.toHaveProperty('schedules')
})
it('disables new groups when all days are reserved and keeps header non-interactive', () => {
  wizard()
  for (const day of [
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
    'Domingo',
  ])
    fireEvent.click(screen.getByRole('button', { name: day }))
  expect(
    screen.getByRole('button', { name: 'Añadir horario diferente' }),
  ).toBeDisabled()
  fireEvent.click(screen.getByText('Horario 1'))
  expect(screen.getByRole('button', { name: 'Listo' })).toBeVisible()
})
it('adds blank ranges and rejects overlap/overnight hours with inline feedback', () => {
  wizard()
  fireEvent.click(screen.getByRole('button', { name: 'Añadir franja' }))
  expect(screen.getAllByLabelText('Desde')[1]).toHaveValue('')
  fireEvent.change(screen.getAllByLabelText('Desde')[1]!, {
    target: { value: '13:00' },
  })
  fireEvent.change(screen.getAllByLabelText('Hasta')[1]!, {
    target: { value: '14:00' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Las franjas se solapan')
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar franja 2' }))
  fireEvent.change(screen.getByLabelText('Desde'), {
    target: { value: '23:00' },
  })
  fireEvent.change(screen.getByLabelText('Hasta'), {
    target: { value: '02:00' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
  expect(
    within(screen.getByRole('region', { name: 'Horario 1' })).getByRole(
      'alert',
    ),
  ).toHaveTextContent('medianoche')
})

it('opens distinct legacy day patterns losslessly and submits grouped ranges without flattening', async () => {
  const save = vi.fn()
  const { scheduleGroups, ...common } = emptyService
  expect(scheduleGroups).toHaveLength(1)
  render(
    <ServiceConfigDrawer
      open
      mode="edit"
      initial={{
        ...common,
        name: 'Legacy pool',
        type: 'pool',
        twentyFourHours: false,
        schedules: [
          { day: 1, from: '10:00', to: '12:00' },
          { day: 2, from: '16:00', to: '20:00' },
        ],
      }}
      onClose={vi.fn()}
      onSave={save}
    />,
  )
  expect(
    screen.getByRole('button', { name: 'Confirmar horario 1' }),
  ).toBeVisible()
  expect(screen.getByLabelText('Desde')).toHaveValue('10:00')
  fireEvent.click(screen.getByRole('button', { name: 'Editar horario 2' }))
  expect(screen.getByLabelText('Desde')).toHaveValue('16:00')
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  expect(screen.getByText('10:00 - 12:00')).toBeVisible()
  expect(screen.getByText('16:00 - 20:00')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleGroups: [
          {
            days: [1],
            twentyFourHours: false,
            ranges: [{ from: '10:00', to: '12:00' }],
          },
          {
            days: [2],
            twentyFourHours: false,
            ranges: [{ from: '16:00', to: '20:00' }],
          },
        ],
      }),
    ),
  )
})

it('moves keyboard focus to an available day when opening another group', async () => {
  wizard()
  fireEvent.click(
    screen.getByRole('button', { name: 'Añadir horario diferente' }),
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Martes' })).toHaveFocus(),
  )
  fireEvent.keyDown(screen.getByRole('button', { name: 'Martes' }), {
    key: 'ArrowRight',
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Miércoles' })).toHaveFocus(),
  )
})

it('matches collapsed Figma actions and compact summary without repeating visual labels', () => {
  wizard()
  fireEvent.click(screen.getByRole('button', { name: 'Añadir franja' }))
  expect(
    screen
      .getAllByText('Desde')
      .filter((label) => !label.classList.contains('sr-only')),
  ).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar franja 2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
  expect(
    screen.getByRole('button', { name: 'Editar horario 1' }),
  ).toHaveTextContent('Editar')
  expect(screen.getByText('Lunes · 12:00–23:00')).toBeVisible()
})

it('validates the expanded interval budget before local confirmation', () => {
  wizard()
  for (const day of [
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
    'Domingo',
  ])
    fireEvent.click(screen.getByRole('button', { name: day }))
  fireEvent.change(screen.getByLabelText('Desde'), {
    target: { value: '00:00' },
  })
  fireEvent.change(screen.getByLabelText('Hasta'), {
    target: { value: '01:00' },
  })
  for (let i = 1; i < 5; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Añadir franja' }))
    fireEvent.change(screen.getAllByLabelText('Desde')[i]!, {
      target: { value: `${String(i * 2).padStart(2, '0')}:00` },
    })
    fireEvent.change(screen.getAllByLabelText('Hasta')[i]!, {
      target: { value: `${String(i * 2 + 1).padStart(2, '0')}:00` },
    })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
  expect(screen.getByRole('alert')).toHaveTextContent('28 franjas')
  expect(screen.getByRole('button', { name: 'Listo' })).toBeVisible()
})
it('offers editable default ranges when disabling a stored full-day group with no cached times', () => {
  render(
    <ServiceConfigDrawer
      open
      mode="edit"
      initial={{
        ...emptyService,
        name: 'Always',
        scheduleGroups: [{ days: [1], twentyFourHours: true, ranges: [] }],
      }}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('switch', { name: 'Abierto 24 horas' }))
  expect(screen.getByLabelText('Desde')).toHaveValue('12:00')
})
