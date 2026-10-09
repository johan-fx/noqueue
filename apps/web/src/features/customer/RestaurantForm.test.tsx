import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RestaurantForm } from './RestaurantForm'
import type { PublicService } from '@noqueue/contracts/queue'
afterEach(cleanup)
it('allows recovering the same submitted request after admission is paused', async () => {
  const service = {
    id: 'q',
    name: 'Restaurant',
    type: 'restaurant',
    spaces: [{ id: 'room', name: 'Room', maxPartySize: 4 }],
  } as PublicService
  const submit = vi.fn().mockRejectedValue(new Error('Connection lost'))
  const { rerender } = render(
    <RestaurantForm service={service} locale="en" onSubmit={submit} />,
  )
  fireEvent.change(screen.getByLabelText(/name/i), {
    target: { value: 'Guest' },
  })
  fireEvent.change(
    screen.getByLabelText('Phone number'),
    { target: { value: '612345678' } },
  )
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await screen.findByRole('alert')
  const key = submit.mock.calls[0]![1]
  rerender(
    <RestaurantForm service={service} locale="en" disabled onSubmit={submit} />,
  )
  expect(
    screen.getByRole('button', { name: 'Join waiting list' }),
  ).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  expect(submit.mock.calls[1]![1]).toBe(key)
  expect(submit.mock.calls[0]![0]).toMatchObject({
    whatsapp: {
      consent: true,
      phone: '+34612345678',
      version: 'whatsapp-public-service-updates-v1',
    },
  })
})
