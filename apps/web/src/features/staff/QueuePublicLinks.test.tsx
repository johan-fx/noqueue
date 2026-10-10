import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueuePublicLinks } from './QueuePublicLinks'
const mocks = vi.hoisted(() => ({ native: false, open: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open } }))
afterEach(() => {
  cleanup()
  mocks.native = false
  mocks.open.mockReset()
  vi.unstubAllEnvs()
})
it('has the public link and exactly two keyboard accessible destinations', async () => {
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
  render(<QueuePublicLinks queueId="q" />)
  expect(
    screen.getByRole('link', { name: 'Abrir enlace público' })
  ).toHaveAttribute('href', 'https://public.example/q/q')
  const trigger = screen.getByRole('button', {
    name: 'Opciones del enlace público',
  })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const registration = await screen.findByRole('menuitem', {
    name: 'Inscripción',
  })
  expect(registration).toHaveAttribute(
    'href',
    'https://public.example/q/q/kiosk'
  )
  expect(screen.getByRole('menuitem', { name: 'QR' })).toHaveAttribute(
    'href',
    'https://public.example/q/q/qr'
  )
  expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  fireEvent.keyDown(registration, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  await waitFor(() => expect(trigger).toHaveFocus())
})
it('shows actionable native configuration and opening errors', async () => {
  mocks.native = true
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', '')
  const { unmount } = render(<QueuePublicLinks queueId="q" />)
  expect(screen.getByRole('alert')).toHaveTextContent('VITE_PUBLIC_APP_ORIGIN')
  expect(
    screen.getByRole('button', { name: 'Abrir enlace público' })
  ).toBeDisabled()
  unmount()
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
  mocks.open.mockRejectedValueOnce(new Error('Rejected'))
  render(<QueuePublicLinks queueId="q" />)
  fireEvent.click(screen.getByRole('link', { name: 'Abrir enlace público' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir')
})

it('matches button semantics to the rendered anchor and disabled native button', () => {
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
  const { unmount } = render(<QueuePublicLinks queueId="q" />)
  const link = screen.getByRole('link', { name: 'Abrir enlace público' })
  expect(link.tagName).toBe('A')
  expect(link).toHaveAttribute('href', 'https://public.example/q/q')
  expect(link).not.toHaveAttribute('type')
  unmount()
  mocks.native = true
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', '')
  render(<QueuePublicLinks queueId="q" />)
  const button = screen.getByRole('button', { name: 'Abrir enlace público' })
  expect(button.tagName).toBe('BUTTON')
  expect(button).toHaveAttribute('type', 'button')
  expect(button).toBeDisabled()
  expect(button).not.toHaveAttribute('href')
})
