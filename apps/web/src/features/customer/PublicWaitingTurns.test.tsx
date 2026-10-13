import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PublicWaitingTurns } from './PublicWaitingTurns'

afterEach(cleanup)
const active = { serviceOpen: true, queueState: 'active' as const, canJoin: true, blockReason: null }
it.each(['es', 'en'] as const)('renders a decorative users icon and localized turn counts, never group member counts (%s)', (locale) => {
  const { container, rerender } = render(<PublicWaitingTurns service={{ ...active, waitingTurns: 1, waitingPeople: 4 }} locale={locale} showIcon />)
  expect(screen.getByTestId('public-waiting-turns')).toHaveTextContent(locale === 'es' ? '1 turno en lista de espera' : '1 turn waiting')
  expect(container.querySelector('svg.lucide-users')).toHaveAttribute('aria-hidden', 'true')
  rerender(<PublicWaitingTurns service={{ ...active, waitingTurns: 2, waitingPeople: 6 }} locale={locale} showIcon />)
  expect(screen.getByTestId('public-waiting-turns')).toHaveTextContent(locale === 'es' ? '2 turnos en lista de espera' : '2 turns waiting')
})
it('renders the turn count without an icon by default or when explicitly disabled', () => {
  const service = { ...active, waitingTurns: 2, waitingPeople: 6 }
  const { container, rerender } = render(<PublicWaitingTurns service={service} locale="es" />)
  expect(screen.getByTestId('public-waiting-turns')).toHaveTextContent('2 turnos en lista de espera')
  expect(container.querySelector('svg')).toBeNull()
  rerender(<PublicWaitingTurns service={service} locale="es" showIcon={false} />)
  expect(screen.getByTestId('public-waiting-turns')).toHaveTextContent('2 turnos en lista de espera')
  expect(container.querySelector('svg')).toBeNull()
})
it('removes the whole row and icon for zero blocked counts and legacy responses', () => {
  const { container, rerender } = render(<PublicWaitingTurns service={{ ...active, waitingTurns: 0, queueState: 'paused', canJoin: false, blockReason: 'paused' }} locale="es" showIcon />)
  expect(container).toBeEmptyDOMElement()
  rerender(<PublicWaitingTurns service={{ ...active, waitingPeople: 8 }} locale="es" showIcon />)
  expect(container).toBeEmptyDOMElement()
})
