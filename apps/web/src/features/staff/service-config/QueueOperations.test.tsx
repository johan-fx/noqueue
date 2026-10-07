import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useForm, useWatch } from 'react-hook-form'
import { afterEach, expect, it } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { QueueOperations } from './QueueOperations'
import { emptyService } from './model'
afterEach(cleanup)
function Harness() {
  const form = useForm<ServiceInput>({
    defaultValues: {
      ...emptyService,
      type: 'reception',
      adjustments: [
        {
          spaceId: 'reception',
          seats: 100,
          minutes: 15,
          reason: 'Busy',
          expiresAt: 1800000000000,
        },
      ],
    },
  })
  const adjustments = useWatch({ control: form.control, name: 'adjustments' })
  return (
    <>
      <QueueOperations form={form} />
      <output data-testid="values">{JSON.stringify(adjustments)}</output>
    </>
  )
}
it('preserves adjustment fields while removing and restoring duration', async () => {
  render(<Harness />)
  const trigger = screen.getByRole('combobox', { name: 'Tipo de ajuste' })
  expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
  expect(trigger).toHaveTextContent('Duración estimada')
  fireEvent.click(trigger)
  {
    const option = await screen.findByRole('option', {
      name: 'Bloquear disponibilidad hasta caducidad',
    })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option, { detail: 1 })
  }
  expect(
    screen.queryByLabelText('Duración temporal (min)'),
  ).not.toBeInTheDocument()
  expect(
    JSON.parse(screen.getByTestId('values').textContent!)[0],
  ).not.toHaveProperty('minutes')
  await waitFor(() =>
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
  )
  fireEvent.click(trigger)
  {
    const option = await screen.findByRole('option', {
      name: 'Duración estimada',
    })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option, { detail: 1 })
  }
  expect(screen.getByLabelText('Duración temporal (min)')).toHaveValue(60)
  expect(
    JSON.parse(screen.getByTestId('values').textContent!)[0],
  ).toMatchObject({ kind: 'duration', reason: 'Busy', minutes: 60 })
})
