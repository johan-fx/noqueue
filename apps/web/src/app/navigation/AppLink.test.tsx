import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ value: 'native' as 'native' | 'web' }))
vi.mock('../bootstrap/runtime', () => ({ detectRuntime: () => runtime.value }))

import { AppLink } from './AppLink'

afterEach(() => {
  cleanup()
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition
  delete (window as unknown as { matchMedia?: unknown }).matchMedia
  document.documentElement.removeAttribute('data-noqueue-transition-intent')
})

beforeEach(() => {
  runtime.value = 'native'
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  })
})

function RouteLink({ to }: { to: string }) {
  const location = useLocation()
  return <><AppLink to={to}>{to}</AppLink><output aria-label="current location">{location.pathname + location.search}</output></>
}

it('sets the intent before a native route Link navigates', async () => {
  render(<MemoryRouter initialEntries={['/search']}><RouteLink to="/v/venue" /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '/v/venue' }))
  expect(screen.getByLabelText('current location')).toHaveTextContent('/v/venue')
  expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('forward')
})

it('presents a turn link from below rather than fading it', () => {
  render(<MemoryRouter initialEntries={['/search']}><RouteLink to="/t/token" /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '/t/token' }))
  expect(screen.getByLabelText('current location')).toHaveTextContent('/t/token')
  expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('bottom-up')
})

it('keeps the cancelled confirmation home link using the ordinary back transition', () => {
  render(<MemoryRouter initialEntries={['/t/token']}><AppLink to="/?lang=es" intent="back">Volver al inicio</AppLink></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: 'Volver al inicio' }))
  expect(document.documentElement.dataset.noqueueTransitionIntent).toBe('back')
})

it('does not opt into a transition for a query-only link or on web', async () => {
  render(<MemoryRouter initialEntries={['/search']}><RouteLink to="/search?text=coffee" /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '/search?text=coffee' }))
  expect(screen.getByLabelText('current location')).toHaveTextContent('/search?text=coffee')
  expect(document.documentElement.dataset.noqueueTransitionIntent).toBeUndefined()

  cleanup()
  runtime.value = 'web'
  render(<MemoryRouter initialEntries={['/search']}><RouteLink to="/v/venue" /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '/v/venue' }))
  expect(screen.getByLabelText('current location')).toHaveTextContent('/v/venue')
  expect(document.documentElement.dataset.noqueueTransitionIntent).toBeUndefined()
})

it('rechecks reduced motion at click time and still navigates without View Transitions', () => {
  render(<MemoryRouter initialEntries={['/search']}><RouteLink to="/v/venue" /></MemoryRouter>)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true }),
  })

  fireEvent.click(screen.getByRole('link', { name: '/v/venue' }))

  expect(screen.getByLabelText('current location')).toHaveTextContent('/v/venue')
  expect(document.documentElement.dataset.noqueueTransitionIntent).toBeUndefined()
})
