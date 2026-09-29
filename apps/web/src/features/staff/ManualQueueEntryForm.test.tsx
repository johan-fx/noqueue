import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ManualQueueEntryForm } from './ManualQueueEntryForm'
import { consentVersion } from '@noqueue/contracts/queue'
afterEach(cleanup)
const restaurant = {
  type: 'restaurant' as const,
  receptionServices: [],
  spaces: [{ id: 'terrace', name: 'Terraza', maxPartySize: 4 }],
}
it('requires explicit consent and phone, starts at one diner and retains the request key on retry', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('Retry'))
    .mockResolvedValue(undefined)
  render(
    <ManualQueueEntryForm
      service={restaurant}
      whatsappRequired
      onSubmit={submit}
    />,
  )
  const button = screen.getByRole('button', { name: 'Añadir turno' })
  const consent = screen.getByRole('switch', {
    name: /Consentir notificaciones/,
  })
  expect(consent).not.toBeChecked()
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: '  María  ' },
  })
  fireEvent.change(screen.getByLabelText('Nº de teléfono', { exact: true }), {
    target: { value: '600000000' },
  })
  expect(button).toBeDisabled()
  expect(
    screen.getByRole('spinbutton', { name: 'Número de comensales' }),
  ).toHaveValue(1)
  fireEvent.click(screen.getByRole('button', { name: 'Terraza' }))
  fireEvent.click(consent)
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry')
  fireEvent.click(button)
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  expect(submit.mock.calls[0]![0]).toEqual({
    displayName: 'María',
    partySize: 1,
    locale: 'es',
    preferredSpaceId: 'terrace',
    whatsapp: {
      consent: true,
      phone: '+34600000000',
      version: consentVersion,
    },
  })
  expect(submit.mock.calls[0]![1]).toBe(submit.mock.calls[1]![1])
})
it.each(['reception', 'pool'] as const)(
  'shows no party size for %s and allows explicit local offline admission',
  async (type) => {
    const submit = vi.fn().mockResolvedValue(undefined)
    render(
      <ManualQueueEntryForm
        service={{
          ...restaurant,
          type,
          receptionServices: ['check_in', 'check_out', 'other'],
        }}
        whatsappRequired={false}
        onSubmit={submit}
      />,
    )
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Terraza' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
      target: { value: 'Client' },
    })
    if (type === 'reception')
      fireEvent.click(screen.getByRole('button', { name: 'Check-out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Añadir turno' }))
    await waitFor(() => expect(submit).toHaveBeenCalledOnce())
    expect(submit.mock.calls[0]![0]).toEqual({
      displayName: 'Client',
      partySize: 1,
      locale: 'es',
      whatsapp: { consent: false },
      ...(type === 'reception' ? { receptionService: 'check_out' } : {}),
    })
  },
)
it('guards duplicate submission while awaiting the response', async () => {
  const submit = vi.fn(() => new Promise<void>(() => {}))
  render(
    <ManualQueueEntryForm
      service={restaurant}
      whatsappRequired={false}
      onSubmit={submit}
    />,
  )
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: 'Client' },
  })
  const button = screen.getByRole('button', { name: 'Añadir turno' })
  fireEvent.click(button)
  fireEvent.submit(button.closest('form')!)
  expect(submit).toHaveBeenCalledOnce()
  expect(button).toBeDisabled()
})
