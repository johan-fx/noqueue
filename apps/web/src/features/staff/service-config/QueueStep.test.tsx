import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { afterEach, expect, it } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { QueueStep } from './QueueStep'
import { emptyService } from './model'

afterEach(cleanup)

let form: UseFormReturn<ServiceInput>

function Harness() {
  form = useForm<ServiceInput>({ defaultValues: emptyService })
  return <QueueStep form={form} />
}

it('shows automatic assignment first, off by default, and writes it to the form', () => {
  render(<Harness />)
  const toggle = screen.getByRole('switch', {
    name: 'Modo de gestión automática',
  })
  expect(toggle).not.toBeChecked()
  expect(
    toggle.compareDocumentPosition(screen.getByLabelText(/Intervalo inicial/)) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  fireEvent.click(toggle)
  expect(form.getValues('automaticAssignmentEnabled')).toBe(true)
})
