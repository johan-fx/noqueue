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
  fireEvent.change(screen.getByLabelText('Espacio'), {
    target: { value: 'a' },
  })
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
