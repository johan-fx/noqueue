import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PublicService } from '@noqueue/contracts/queue'
import { ServiceForm } from './ServiceForm'
const service: PublicService = {
  id: 'q',
  name: 'Reception',
  venueName: 'Hotel',
  type: 'reception',
  open: 1,
  spaces: [],
  receptionServices: ['check_out', 'check_in', 'other'],
}
afterEach(cleanup)
it('requires a name and defaults to enabled check-in with a single-person payload', async () => {
  const submit = vi.fn().mockResolvedValue(undefined)
  render(<ServiceForm service={service} locale="en" onSubmit={submit} />)
  expect(
    screen.getByRole('button', { name: 'Join waiting list' }),
  ).toBeDisabled()
  expect(screen.getByRole('radio', { name: 'Check-in' })).toBeChecked()
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: ' Guest ' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'Other matters' }))
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      {
        displayName: 'Guest',
        partySize: 1,
        locale: 'en',
        receptionService: 'other',
      },
      expect.any(String),
    ),
  )
})
it('selects the first available task, reconciles disabled tasks and blocks empty configuration', () => {
  const { rerender } = render(
    <ServiceForm
      service={{ ...service, receptionServices: ['check_out', 'other'] }}
      locale="en"
      onSubmit={vi.fn()}
    />,
  )
  expect(
    screen.queryByRole('radio', { name: 'Check-in' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Check-out' })).toBeChecked()
  rerender(
    <ServiceForm
      service={{ ...service, receptionServices: ['other'] }}
      locale="en"
      onSubmit={vi.fn()}
    />,
  )
  expect(screen.getByRole('radio', { name: 'Other matters' })).toBeChecked()
  rerender(
    <ServiceForm
      service={{ ...service, receptionServices: [] }}
      locale="en"
      onSubmit={vi.fn()}
    />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'No reception services are available',
  )
  expect(
    screen.getByRole('button', { name: 'Join waiting list' }),
  ).toBeDisabled()
})
it('pool has only name and preserves the same idempotency key after a lost response and pause', async () => {
  const pool = { ...service, type: 'pool' as const }
  const submit = vi.fn().mockRejectedValue(new Error('Connection lost'))
  const { rerender } = render(
    <ServiceForm service={pool} locale="es" onSubmit={submit} />,
  )
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Nombre'), {
    target: { value: 'María' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ponerme en lista' }))
  fireEvent.click(screen.getByRole('button', { name: 'Guardando…' }))
  await screen.findByRole('alert')
  expect(submit).toHaveBeenCalledTimes(1)
  expect(submit.mock.calls[0]![0]).toEqual({
    displayName: 'María',
    partySize: 1,
    locale: 'es',
  })
  rerender(
    <ServiceForm service={pool} locale="es" disabled onSubmit={submit} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Ponerme en lista' }))
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  expect(submit.mock.calls[1]![1]).toBe(submit.mock.calls[0]![1])
})
