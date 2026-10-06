import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { QrScanner } from './QrScanner'
const { decode, stop } = vi.hoisted(() => ({ decode: vi.fn(), stop: vi.fn() }))
vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromConstraints(...args: unknown[]) {
      return decode(...args)
    }
  },
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
it('releases camera controls on close', async () => {
  decode.mockResolvedValue({ stop })
  const view = render(
    <MemoryRouter>
      <QrScanner locale="es" onClose={vi.fn()} />
    </MemoryRouter>,
  )
  await waitFor(() => expect(decode).toHaveBeenCalledOnce())
  const trackStop = vi.fn()
  Object.defineProperty(
    screen.getByLabelText('Vista de la cámara'),
    'srcObject',
    {
      configurable: true,
      value: { getTracks: () => [{ stop: trackStop }] },
      writable: true,
    },
  )
  view.unmount()
  expect(trackStop).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
})
it('stops a camera that finishes starting after navigation', async () => {
  let resolve!: (value: { stop: () => void }) => void
  decode.mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const view = render(
    <MemoryRouter>
      <QrScanner locale="en" onClose={vi.fn()} />
    </MemoryRouter>,
  )
  await waitFor(() => expect(decode).toHaveBeenCalledOnce())
  view.unmount()
  resolve({ stop })
  await waitFor(() => expect(stop).toHaveBeenCalledOnce())
})
it('shows denied camera and search fallback without navigating to invalid links', async () => {
  decode.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
  render(
    <MemoryRouter>
      <QrScanner locale="es" onClose={vi.fn()} />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No se puede acceder a la cámara',
  )
  expect(screen.getByRole('button', { name: 'Buscar servicio' })).toBeVisible()
})

it('rejects external QR values and navigates only to a verified internal service', async () => {
  decode.mockResolvedValue({ stop })
  const onClose = vi.fn()
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<QrScanner locale="es" onClose={onClose} />} />
        <Route path="/q/:id" element={<p>Service opened</p>} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(decode).toHaveBeenCalledOnce())
  const callback = decode.mock.calls[0]![2] as (result: {
    getText: () => string
  }) => void
  callback({ getText: () => 'https://external.test/q/queue-a' })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Este QR no enlaza',
  )
  expect(onClose).not.toHaveBeenCalled()
  callback({ getText: () => '/q/queue-a' })
  expect(await screen.findByText('Service opened')).toBeVisible()
  expect(onClose).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalled()
})
