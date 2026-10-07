import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueueReminder } from './QueueReminder'
import { api, ApiError } from './api'
vi.mock('./api', async () => {
  const actual = await vi.importActual('./api')
  return { ...actual, api: vi.fn() }
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.useRealTimers()
})
it('ignoring the reminder never posts and dismissal only acknowledges', async () => {
  vi.useFakeTimers()
  vi.mocked(api).mockResolvedValue({ contextToken: 'current' })
  render(<QueueReminder queueId="queue" onSaved={() => {}} />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000)
  })
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
  await act(async () => {})
  expect(api).toHaveBeenLastCalledWith(
    '/queues/queue/lifecycle',
    'POST',
    { action: 'dismiss_reminder', contextToken: 'current' },
    expect.any(String),
  )
})
it('refreshes the context after a concurrency conflict before retry', async () => {
  let token = 0,
    posts = 0
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === 'POST') {
      if (++posts === 1) throw new ApiError(409, 'conflict')
      return {}
    }
    return { contextToken: `token-${++token}` }
  })
  render(<QueueReminder queueId="queue" onSaved={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Activar lista' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Activar lista' }))
  await waitFor(() => expect(posts).toBe(2))
  expect(api).toHaveBeenLastCalledWith(
    '/queues/queue/lifecycle',
    'POST',
    { action: 'declare_full', contextToken: 'token-2' },
    expect.any(String),
  )
})
