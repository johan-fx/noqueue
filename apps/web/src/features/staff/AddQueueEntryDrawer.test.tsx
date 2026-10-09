import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { QueueSummary } from '@noqueue/contracts/staff'
import { AddQueueEntryDrawer } from './AddQueueEntryDrawer'
import { api } from './api'
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const queue: QueueSummary = {
  id: 'pool',
  name: 'Piscina',
  venueId: 'hotel',
  capacity: 20,
  averageMinutes: 30,
  open: 1,
  version: 1,
  manualJoinWhatsappRequired: false,
  config: {
    name: 'Piscina',
    type: 'pool',
    capacity: 20,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [],
    receptionServices: [],
  },
}
it('defaults to Spanish, preserves data across selector changes and retains submitted locale in the result link', async () => {
  vi.mocked(api).mockResolvedValue({
    code: 'P1',
    recoveryToken: 'a'.repeat(64),
    position: 1,
    etaMinutes: 0,
    status: 'waiting',
    notification: 'disabled',
  })
  render(
    <AddQueueEntryDrawer
      queue={queue}
      onClose={vi.fn()}
      onSaved={vi.fn().mockRejectedValue(new Error('Refresh failed'))}
      returnFocus={null}
    />,
  )
  expect(screen.getByRole('button', { name: 'ES' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: 'Guest' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'EN' }))
  expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('Guest')
  fireEvent.click(screen.getByRole('button', { name: 'Add queue entry' }))
  await screen.findByRole('heading', { name: 'Queue entry added' })
  expect(vi.mocked(api).mock.calls[0]?.[2]).toMatchObject({
    displayName: 'Guest',
    locale: 'en',
  })
  expect(screen.getByLabelText('Queue entry link')).toHaveValue(
    window.location.origin + '/t/' + 'a'.repeat(64) + '?lang=en',
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'The queue entry has been created.',
  )
  fireEvent.click(screen.getByRole('button', { name: 'ES' }))
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Queue entry added' }),
    ).toBeVisible(),
  )
  expect(screen.getByLabelText('Queue entry link')).toHaveValue(
    window.location.origin + '/t/' + 'a'.repeat(64) + '?lang=en',
  )
})

it('keeps country search keyboard focus inside the drawer and closes only the popup on Escape', async () => {
  render(
    <AddQueueEntryDrawer
      queue={queue}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      returnFocus={null}
    />,
  )
  const dialog = screen.getByRole('dialog')
  const country = screen.getByRole('combobox', { name: 'País' })
  fireEvent.click(country)
  const search = await screen.findByRole('combobox', { name: 'Buscar país' })
  expect(search).toHaveFocus()
  fireEvent.keyDown(search, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  expect(dialog).toBeVisible()
  expect(country).toHaveFocus()
})
