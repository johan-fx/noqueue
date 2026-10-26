import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { ServiceForm } from './ServiceForm'
afterEach(cleanup)
describe('service forms use RHF + Zod', () => {
  it('does not submit an invalid service', async () => {
    const onSave = vi.fn()
    render(<ServiceForm onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Añadir servicio' }))
    await screen.findAllByRole('alert')
    expect(onSave).not.toHaveBeenCalled()
  })
  it('submits numeric fields as numbers with validated settings', async () => {
    const onSave = vi.fn()
    render(<ServiceForm onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Nombre del servicio'), {
      target: { value: 'Terraza' },
    })
    fireEvent.change(
      screen.getByLabelText('Máximo de grupos/personas en espera'),
      { target: { value: '25' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Añadir servicio' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      name: 'Terraza',
      capacity: 25,
      type: 'restaurant',
    })
  })
  it('supports a submit button in the Drawer footer without duplicating the inline button', async () => {
    const onSave = vi.fn()
    render(
      <>
        <ServiceForm formId="drawer-service" hideSubmit onSave={onSave} />
        <button type="submit" form="drawer-service">
          Guardar desde footer
        </button>
      </>,
    )
    expect(
      screen.queryByRole('button', { name: 'Añadir servicio' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nombre del servicio'), {
      target: { value: 'Piscina' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar desde footer' }),
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
  })
})

it('keeps RHF bindings when editing shared time inputs', async () => {
  const onSave = vi.fn()
  render(<ServiceForm onSave={onSave} />)
  fireEvent.change(screen.getByLabelText('Nombre del servicio'), { target: { value: 'Snack bar' } })
  fireEvent.change(screen.getByLabelText('Desde 1'), { target: { value: '13:15' } })
  fireEvent.change(screen.getByLabelText('Hasta 1'), { target: { value: '22:30' } })
  fireEvent.blur(screen.getByLabelText('Hasta 1'))
  fireEvent.click(screen.getByRole('button', { name: 'Añadir servicio' }))
  await waitFor(() => expect(onSave).toHaveBeenCalled())
  expect(onSave.mock.calls[0]?.[0].schedules[0]).toMatchObject({ from: '13:15', to: '22:30' })
})
