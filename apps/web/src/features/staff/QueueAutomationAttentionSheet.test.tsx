import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueueAutomationAttentionSheet } from './QueueAutomationAttentionSheet'
import type { QueueAutomationAttention, StaffEntry } from '@noqueue/contracts/staff'

afterEach(cleanup)
const attention: QueueAutomationAttention = { id: 'cycle', createdAt: Date.now(), capacity: 2, spaceId: 'inside', spaceName: 'Interior', entry: { id: 'pepe', code: '9R8UW8', displayName: 'Pepe' } }
const alberto: StaffEntry = { id: 'alberto', code: 'JNXM87', displayName: 'Alberto', partySize: 4, status: 'waiting', sequence: 2, version: 0, calledAt: null, waitingSince: Date.now() - 80000, allowedActions: ['call'], space: { id: 'inside', name: 'Interior', source: 'preferred' } }
function props() { return { attention: [attention], selectedId: attention.id, candidates: [alberto], clockOffsetMs: 0, onSelectAttention: vi.fn(), onSelectCandidate: vi.fn(), onClose: vi.fn(), returnFocus: () => null } }
it('matches the approved Pepe/Alberto sheet and selects without assigning or offering an old-cycle replacement', () => {
  const p = props()
  render(<QueueAutomationAttentionSheet {...p} />)
  const sheet = screen.getByRole('dialog', { name: 'No hay un turno compatible' })
  expect(within(sheet).getByText('Pepe')).toBeVisible()
  expect(within(sheet).getByText('2 personas · Interior')).toBeVisible()
  expect(within(sheet).getByRole('alert')).toHaveTextContent('Para continuar, realiza una nueva asignación manual.')
  expect(within(sheet).getByRole('list', { name: 'Turnos pendientes para asignación manual' })).toHaveTextContent('Alberto')
  expect(within(sheet).getByText('1 min esperando')).toBeVisible()
  fireEvent.click(within(sheet).getByRole('button', { name: 'Asignar' }))
  expect(p.onSelectCandidate).toHaveBeenCalledExactlyOnceWith(alberto, attention.id)
  expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
  fireEvent.click(within(sheet).getByRole('button', { name: 'Ahora no' }))
  expect(p.onClose).toHaveBeenCalledOnce()
})
it('groups incidents in one sheet and preserves the selected cycle identity', () => {
  const p = props()
  const second = { ...attention, id: 'second', entry: { ...attention.entry, displayName: 'María' } }
  const v = render(<QueueAutomationAttentionSheet {...p} attention={[attention, second]} />)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'María · 2' }))
  expect(p.onSelectAttention).toHaveBeenCalledWith('second')
  v.rerender(<QueueAutomationAttentionSheet {...p} attention={[attention, second]} selectedId="second" />)
  fireEvent.click(screen.getByRole('button', { name: 'Asignar' }))
  expect(p.onSelectCandidate).toHaveBeenCalledWith(alberto, 'second')
})
it('disables stale candidates and closes when another operator resolved the selected incident', () => {
  const p = props()
  const v = render(<QueueAutomationAttentionSheet {...p} candidates={[{ ...alberto, allowedActions: [], callable: false }]} />)
  expect(screen.getByRole('button', { name: 'Asignar' })).toBeDisabled()
  v.rerender(<QueueAutomationAttentionSheet {...p} attention={[]} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
