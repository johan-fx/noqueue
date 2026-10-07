import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueueEntryForm } from './QueueEntryForm'
afterEach(cleanup)
it('requires a trimmed name and submits service-specific values, retaining the same attempt on failure', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('Retry'))
    .mockResolvedValue(undefined)
  render(
    <QueueEntryForm
      service={{
        type: 'restaurant',
        receptionServices: [],
        spaces: [{ id: 'a', name: 'Interior', maxPartySize: 4 }],
      }}
      onSubmit={submit}
    />,
  )
  fireEvent.change(screen.getByLabelText('Nombre'), {
    target: { value: '  María  ' },
  })
  expect(screen.getByLabelText('Espacio')).toHaveAttribute(
    'data-slot',
    'select-trigger',
  )
  fireEvent.click(screen.getByLabelText('Espacio'))
  {
    const option = await screen.findByRole('option', { name: 'Interior' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option, { detail: 1 })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Añadir turno' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry')
  fireEvent.click(screen.getByRole('button', { name: 'Añadir turno' }))
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  expect(submit.mock.calls[0]![0]).toEqual({
    displayName: 'María',
    partySize: 2,
    preferredSpaceId: 'a',
    locale: 'es',
  })
  expect(submit.mock.calls[0]![1]).toBe(submit.mock.calls[1]![1])
})

it('keeps service selection controlled and explicitly disables its trigger', async () => {
  const submit = vi.fn().mockResolvedValue(undefined)
  const service = {
    type: 'reception' as const,
    spaces: [],
    receptionServices: ['check_in', 'other'] as ('check_in' | 'other')[],
  }
  const view = render(<QueueEntryForm service={service} onSubmit={submit} />)
  const trigger = screen.getByRole('combobox', { name: 'Tipo de gestión' })
  expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
  expect(trigger).toHaveTextContent('Check-in')
  fireEvent.click(trigger)
  {
    const option = await screen.findByRole('option', { name: 'Otros' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option, { detail: 1 })
  }
  fireEvent.change(screen.getByLabelText('Nombre'), {
    target: { value: 'Guest' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Añadir turno' }))
  await waitFor(() => expect(submit).toHaveBeenCalled())
  expect(submit.mock.calls[0]![0].receptionService).toBe('other')
  view.rerender(<QueueEntryForm service={service} onSubmit={submit} disabled />)
  expect(trigger).toBeDisabled()
})

it('disables incompatible spaces and the trigger while saving', async () => {
  const submit = vi.fn<
    (input: import('@noqueue/contracts/queue').ServiceJoin) => Promise<void>
  >(() => new Promise<void>(() => {}))
  render(
    <QueueEntryForm
      service={{
        type: 'restaurant',
        receptionServices: [],
        spaces: [{ id: 'small', name: 'Small', maxPartySize: 1 }],
      }}
      onSubmit={submit}
    />,
  )
  const trigger = screen.getByRole('combobox', { name: 'Espacio' })
  fireEvent.click(trigger)
  expect(await screen.findByRole('option', { name: 'Small' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  fireEvent.keyDown(trigger, { key: 'Escape' })
  fireEvent.change(screen.getByLabelText('Nombre'), {
    target: { value: 'Guest' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Añadir turno' }))
  expect(trigger).toBeDisabled()
  expect(submit.mock.calls[0]![0]).toMatchObject({
    preferredSpaceId: 'fastest',
  })
})
