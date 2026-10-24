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
it('defaults to Spanish, preserves data across selector changes and closes after saving even if the refresh fails', async () => {
  vi.mocked(api).mockResolvedValue({
    code: 'P1',
    recoveryToken: 'a'.repeat(64),
    position: 1,
    etaMinutes: 0,
    status: 'waiting',
    notification: 'disabled',
  })
  const onClose = vi.fn()
  const onSaved = vi.fn().mockRejectedValue(new Error('Refresh failed'))
  render(
    <AddQueueEntryDrawer
      queue={queue}
      onClose={onClose}
      onSaved={onSaved}
      returnFocus={null}
    />,
  )
  const language = screen.getByRole('combobox', {
    name: 'Idioma del formulario',
  })
  expect(language).toHaveTextContent('ES')
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: 'Guest' },
  })
  fireEvent.click(language)
  const english = await screen.findByRole('option', { name: 'EN' })
  fireEvent.pointerDown(english, { pointerType: 'mouse' })
  fireEvent.click(english, { detail: 1 })
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('Guest')
  fireEvent.click(screen.getByRole('button', { name: 'Add queue entry' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api).mock.calls[0]?.[2]).toMatchObject({
    displayName: 'Guest',
    locale: 'en',
  })
  expect(onSaved).toHaveBeenCalledTimes(1)
  expect(onSaved.mock.invocationCallOrder[0]).toBeLessThan(
    onClose.mock.invocationCallOrder[0]!,
  )
})

it('stays open with the error when the entry cannot be created', async () => {
  vi.mocked(api).mockRejectedValue(new TypeError('Network down'))
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <AddQueueEntryDrawer
      queue={queue}
      onClose={onClose}
      onSaved={onSaved}
      returnFocus={null}
    />,
  )
  fireEvent.change(screen.getByLabelText('Nombre', { exact: true }), {
    target: { value: 'Guest' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Añadir turno' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(onSaved).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
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
  await waitFor(() => expect(search).toHaveFocus())
  fireEvent.keyDown(search, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  expect(dialog).toBeVisible()
  expect(country).toHaveFocus()
})
