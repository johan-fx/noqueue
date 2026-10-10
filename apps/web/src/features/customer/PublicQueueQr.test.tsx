import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { BrowserQRCodeReader } from '@zxing/browser'
import { PublicQueueQr } from './PublicQueueQr'
import { webRoutes } from '@/app/routes/web-routes'
import { nativeRoutes } from '@/app/routes/native-routes'
const service = { id: 'q', name: 'Restaurant', venueName: 'Hotel', open: 1, type: 'restaurant', receptionServices: [], spaces: [] }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('decodes the real black/white SVG QR into the original absolute public URL', async () => {
  vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://public.example')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(service)))
  render(<MemoryRouter initialEntries={['/q/q/qr?lang=en']}><Routes><Route path="/q/:queueId/qr" element={<PublicQueueQr />} /></Routes></MemoryRouter>)
  const qr = await screen.findByRole('img', { name: 'QR code to join the waiting list' })
  const svg = qr as unknown as SVGSVGElement
  const dimension = Number(svg.getAttribute('viewBox')!.split(' ')[3])
  const scale = 8
  const width = dimension * scale
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255)
  const path = svg.querySelector('path[fill="#000000"]')!.getAttribute('d')!
  const runs = [...path.matchAll(/M(\d+)[ ,](\d+)\s*h(\d+)v1H\d+z/g)]
  expect(runs.length).toBeGreaterThan(20)
  for (const match of runs) {
    const x = Number(match[1]); const y = Number(match[2]); const length = Number(match[3])
    expect(x).toBeGreaterThanOrEqual(4); expect(y).toBeGreaterThanOrEqual(4)
    for (let row = y * scale; row < (y + 1) * scale; row++) {
      for (let col = x * scale; col < (x + length) * scale; col++) {
        const offset = (row * width + col) * 4
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0
      }
    }
  }
  const canvas = { width, height: width, getContext: () => ({ getImageData: () => ({ data: pixels }) }) } as unknown as HTMLCanvasElement
  expect(new BrowserQRCodeReader().decodeFromCanvas(canvas).getText()).toBe('https://public.example/q/q?lang=en')
  expect(screen.getByRole('link', { name: 'Open waiting list' })).toHaveAttribute('href', 'https://public.example/q/q?lang=en')
})
it('registers new routes only on the public web surface', () => {
  expect(webRoutes.map((route) => route.path)).toEqual(expect.arrayContaining(['/q/:queueId/kiosk', '/q/:queueId/qr']))
  const nativePaths = nativeRoutes.flatMap((route) => route.children?.map((child) => child.path) ?? [])
  expect(nativePaths).not.toContain('/q/:queueId/kiosk')
  expect(nativePaths).not.toContain('/q/:queueId/qr')
})
it('does not show a QR for an unavailable service', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
  render(<MemoryRouter initialEntries={['/q/missing/qr']}><Routes><Route path="/q/:queueId/qr" element={<PublicQueueQr />} /></Routes></MemoryRouter>)
  await screen.findByRole('alert')
  expect(screen.queryByRole('img')).toBeNull()
})
