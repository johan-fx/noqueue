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
it('has one button and exactly two keyboard accessible tablet destinations', async () => {
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
  render(<QueuePublicLinks queueId="q" />)
  const trigger = screen.getByRole('button', { name: 'Abrir enlace público' })
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(trigger.tagName).toBe('BUTTON')
  expect(trigger).toHaveAttribute('type', 'button')
  expect(trigger).not.toHaveAttribute('href')
  expect(screen.queryByRole('link')).toBeNull()
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const registration = await screen.findByRole('menuitem', {
    name: 'Inscripción',
  })
  expect(registration).toHaveAttribute(
    'href',
    'https://public.example/q/q/kiosk',
  )
  expect(registration).toHaveAttribute('target', '_blank')
  expect(registration).toHaveAttribute('rel', 'noopener noreferrer')
  const qr = screen.getByRole('menuitem', { name: 'QR' })
  expect(qr).toHaveAttribute('href', 'https://public.example/q/q/qr')
  expect(qr).toHaveAttribute('target', '_blank')
  expect(qr).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  fireEvent.keyDown(registration, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  await waitFor(() => expect(trigger).toHaveFocus())
})
it.each(['text', 'icon', 'chevron'])(
  'opens the same menu from the %s without opening a destination',
  async (target) => {
    mocks.native = true
    vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
    render(<QueuePublicLinks queueId="q" />)
    const trigger = screen.getByRole('button', { name: 'Abrir enlace público' })
    const images = trigger.querySelectorAll('img')
    fireEvent.click(
      target === 'text' ? trigger : images[target === 'icon' ? 0 : 1]!,
    )
    expect(await screen.findByRole('menu')).toBeVisible()
    expect(mocks.open).not.toHaveBeenCalled()
  },
)
it.each([
  ['Inscripción', 'kiosk'],
  ['QR', 'qr'],
])('opens only %s in the native browser', async (name, destination) => {
  mocks.native = true
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
  render(<QueuePublicLinks queueId="q" />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir enlace público' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: name! }))
  await waitFor(() =>
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({
      url: `https://public.example/q/q/${destination}`,
    }),
  )
})
it('disables the single trigger when native public origin is missing', () => {
  mocks.native = true
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', '')
  render(<QueuePublicLinks queueId="q" />)
  expect(screen.getByRole('alert')).toHaveTextContent('VITE_PUBLIC_APP_ORIGIN')
  const button = screen.getByRole('button', { name: 'Abrir enlace público' })
  expect(button).toBeDisabled()
  expect(button).not.toHaveAttribute('href')
  expect(screen.getAllByRole('button')).toHaveLength(1)
})
it.each(['Inscripción', 'QR'])(
  'reports native opening errors for %s',
  async (name) => {
    mocks.native = true
    vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
    mocks.open.mockRejectedValueOnce(new Error('Rejected'))
    render(<QueuePublicLinks queueId="q" />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Abrir enlace público' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo abrir',
    )
  },
)
