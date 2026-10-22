import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { detectRuntime } from '@/app/bootstrap/runtime'
import { RouteLoadingScreen } from '@/app/recovery/RouteErrorBoundary'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { CustomerTurn } from './CustomerTurn'
import { PublicQueue } from './PublicQueue'
import { PublicVenue } from './PublicVenue'
import { PublicDiscovery } from './PublicDiscovery'

vi.mock('@/app/bootstrap/runtime', () => ({ detectRuntime: vi.fn(() => 'native') }))
vi.mock('@/data/api/customer', () => ({ customerFetch: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/platform/capacitor/discovery-capabilities', () => ({ discoveryPosition: vi.fn(() => new Promise(() => {})) }))

beforeEach(() => vi.mocked(detectRuntime).mockReturnValue('native'))
afterEach(() => { cleanup(); localStorage.clear() })

it('centers a standalone spinner on both viewport axes without visible text', () => {
  const { container } = render(<LoadingSpinner fullScreen />)
  const spinner = screen.getByRole('status', { name: 'Cargando' })
  expect(spinner).toHaveClass('animate-spin', 'size-4')
  expect(spinner.parentElement).toHaveClass('fixed', 'inset-0', 'flex', 'items-center', 'justify-center')
  expect(container.textContent).toBe('')
})

it('centers an embedded spinner without covering the screen', () => {
  render(<LoadingSpinner locale="en" />)
  const spinner = screen.getByRole('status', { name: 'Loading' })
  expect(spinner.parentElement).toHaveClass('w-full', 'flex', 'items-center', 'justify-center')
  expect(spinner.parentElement).not.toHaveClass('fixed')
  expect(spinner.parentElement?.textContent).toBe('')
})

it('uses the fullscreen spinner for native route recovery, preserving the web fallback', () => {
  const { container, rerender } = render(<RouteLoadingScreen />)
  expect(screen.getByRole('status').parentElement).toHaveClass('fixed', 'inset-0')
  expect(container.textContent).toBe('')
  vi.mocked(detectRuntime).mockReturnValue('web')
  rerender(<RouteLoadingScreen />)
  expect(screen.getByRole('status')).toHaveTextContent('Cargando…')
})

it.each([CustomerTurn, PublicQueue, PublicVenue])('%s uses a centered spinner while its resource is pending', (Page) => {
  render(<MemoryRouter><Page /></MemoryRouter>)
  const spinner = screen.getByRole('status', { name: 'Cargando' })
  expect(spinner).toHaveClass('animate-spin')
  expect(spinner.parentElement).toHaveClass('flex-1', 'items-center', 'justify-center')
  expect(screen.queryByText(/Cargando|Loading/)).not.toBeInTheDocument()
})

it.each(['es', 'en'])('search uses only a spinner inside its results in %s', (locale) => {
  render(<MemoryRouter initialEntries={['/search?lang=' + locale]}><PublicDiscovery search /></MemoryRouter>)
  const results = screen.getByRole('region', { name: locale === 'es' ? 'Servicios' : 'Services' })
  expect(within(results).getByRole('status')).toHaveClass('animate-spin')
  expect(results.textContent).toBe('')
})

it('replaces all location-button content with a centered spinner while locating', () => {
  render(<MemoryRouter><PublicDiscovery /></MemoryRouter>)
  const button = screen.getByRole('button', { name: 'Usar mi ubicación' })
  fireEvent.click(button)
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('aria-busy', 'true')
  expect(within(button).getByRole('status')).toHaveClass('animate-spin')
  expect(button.textContent).toBe('')
  expect(button.querySelectorAll('svg')).toHaveLength(1)
})
