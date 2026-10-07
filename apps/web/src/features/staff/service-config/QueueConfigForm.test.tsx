import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueueConfigForm } from './QueueConfigForm'
afterEach(cleanup)
it('edits identical sizes independently and preserves stable identities', () => {
  const confirm = vi.fn()
  render(
    <QueueConfigForm
      spaces={[
        {
          id: 'terrace',
          name: 'Terrace',
          tables: 1,
          tableTypes: [{ seats: 4, count: 1 }],
        },
        {
          id: 'salon',
          name: 'Salon',
          tables: 1,
          tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
        },
      ]}
      averageMinutes={30}
      saved={[{ seats: 4, averageMinutes: 40, capacity: 99 }]}
      onConfirm={confirm}
    />,
  )
  expect(screen.getByRole('tablist', { name: 'Espacios' })).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Terrace' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(screen.getByRole('tabpanel', { name: 'Terrace' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Mesas de 4' }))
  expect(
    screen.queryByLabelText('Salon · 4 plazas (min)'),
  ).not.toBeInTheDocument()
  expect(screen.getByLabelText('Terrace · 4 plazas (min)')).toHaveValue(40)
  fireEvent.change(screen.getByLabelText('Terrace · 4 plazas (min)'), {
    target: { value: '70' },
  })
  fireEvent.click(screen.getByRole('tab', { name: 'Salon' }))
  expect(screen.getByRole('tabpanel', { name: 'Salon' })).toBeVisible()
  expect(
    screen.queryByLabelText('Terrace · 4 plazas (min)'),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Mesas de 4' }))
  expect(screen.getByLabelText('Salon · 4 plazas (min)')).toHaveValue(20)
  fireEvent.click(screen.getByRole('tab', { name: 'Terrace' }))
  fireEvent.click(screen.getByRole('button', { name: 'Mesas de 4' }))
  expect(screen.getByLabelText('Terrace · 4 plazas (min)')).toHaveValue(70)
  fireEvent.submit(
    screen.getByLabelText('Terrace · 4 plazas (min)').closest('form')!,
  )
  expect(confirm).toHaveBeenCalledWith(
    [
      {
        id: 'terrace',
        name: 'Terrace',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 70 }],
      },
      {
        id: 'salon',
        name: 'Salon',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
      },
    ],
    expect.any(Object),
  )
})

it('uses points of attention for pool without editing physical legacy groups', () => {
  render(
    <QueueConfigForm
      type="pool"
      spaces={[
        {
          id: 'pool',
          name: 'Piscina',
          tables: 2,
          tableTypes: [{ seats: 3, count: 2 }],
        },
      ]}
      averageMinutes={60}
      saved={undefined}
      onConfirm={vi.fn()}
    />,
  )
  expect(
    screen.queryByRole('button', { name: 'Grupos de 3' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de operación' }))
  expect(screen.getByLabelText('Puestos de atención')).toHaveValue(1)
  expect(screen.queryByLabelText(/máximo/i)).not.toBeInTheDocument()
})

it('rejects an invalid adjustment even when the operation section is collapsed', () => {
  const confirm = vi.fn()
  render(
    <QueueConfigForm
      spaces={[
        {
          id: 'terrace',
          name: 'Terrace',
          tables: 1,
          tableTypes: [{ seats: 4, count: 1 }],
        },
      ]}
      averageMinutes={30}
      saved={undefined}
      options={{
        adjustments: [
          {
            spaceId: 'terrace',
            seats: 4,
            minutes: 50,
            reason: '',
            expiresAt: Date.now() + 3600000,
          },
        ],
      }}
      onConfirm={confirm}
    />,
  )
  fireEvent.submit(document.getElementById('queue-config')!)
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toBeVisible()
})

it('keeps the per-queue arrival grace in advanced configuration and preserves explicit five', () => {
  render(
    <QueueConfigForm
      spaces={[]}
      averageMinutes={5}
      saved={undefined}
      type="pool"
      options={{ graceMinutes: 5 }}
      onConfirm={vi.fn()}
    />,
  )
  expect(screen.getByLabelText('Plazo de llegada (minutos)')).toHaveValue(5)
})
