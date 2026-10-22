import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initialPushState, type PushState } from './push-registration'
const m = vi.hoisted(() => ({ runtime: 'native', factory: vi.fn(), start: vi.fn(), reconcile: vi.fn(), enable: vi.fn(), joined: vi.fn(), dispose: vi.fn() }))
vi.mock('@/app/bootstrap/runtime', () => ({ detectRuntime: () => m.runtime }))
vi.mock('./push-registration', async original => ({ ...await original<typeof import('./push-registration')>(), createNativePush: m.factory }))
import { usePushAfterJoin } from './native-push-context'
import { NativePushProvider, NativePushControls } from './NativePush'
beforeEach(() => { vi.clearAllMocks(); m.runtime = 'native'; vi.stubEnv('VITE_MOBILE_PUSH_ENABLED', 'true'); m.factory.mockReturnValue({ start: m.start, reconcile: m.reconcile, enable: m.enable, requestAfterJoin: m.joined, dispose: m.dispose }) })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
function mount(hasTurn = true, locale: 'es' | 'en' = 'es') { return render(<MemoryRouter><NativePushProvider hasActiveTurn={hasTurn}><NativePushControls locale={locale} hasTurn={hasTurn} /></NativePushProvider></MemoryRouter>) }
function update(patch: Partial<PushState>) { act(() => m.factory.mock.calls[0]![0].status({ ...initialPushState, ...patch })) }
it.each([['web', 'true'], ['native', 'false']])('does not initialize push for runtime=%s flag=%s', (runtime, flag) => {
  m.runtime = runtime; vi.stubEnv('VITE_MOBILE_PUSH_ENABLED', flag); mount()
  expect(m.factory).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull()
})
it('never prompts on mount; shows the Figma card only after permissions are checked', () => {
  const view = mount()
  expect(m.start).toHaveBeenCalledOnce(); expect(m.enable).not.toHaveBeenCalled(); expect(m.joined).not.toHaveBeenCalled()
  expect(screen.queryByRole('button')).toBeNull()
  update({ permission: 'prompt', registration: 'off' })
  expect(screen.getByText('Activa las notificaciones para recibir actualizaciones sobre tu turno')).toBeVisible()
  expect(screen.getByRole('region', { name: 'Notificaciones del turno' }).querySelector('img')).toHaveAttribute('alt', '')
  fireEvent.click(screen.getByRole('button', { name: 'Activar' }))
  expect(m.enable).toHaveBeenCalledOnce(); view.unmount(); expect(m.dispose).toHaveBeenCalledOnce()
})
it.each(['off', 'busy', 'error'] as const)('hides every control without an active turn (%s)', registration => {
  mount(false); update({ permission: 'denied', registration }); expect(screen.queryByRole('button')).toBeNull()
})
it.each(['checking', 'unavailable', 'enabled'] as const)('offers no activation or deactivation for %s', registration => {
  mount(); update({ permission: registration === 'enabled' ? 'granted' : 'unknown', registration })
  expect(screen.queryByRole('button')).toBeNull()
})
it('disables the CTA while busy and keeps the label', () => {
  mount(); update({ permission: 'prompt', registration: 'busy' })
  fireEvent.click(screen.getByRole('button', { name: 'Activar' }))
  expect(screen.getByRole('button', { name: 'Activar' })).toBeDisabled(); expect(m.enable).not.toHaveBeenCalled()
})
it('shows manual settings instructions when settings cannot be opened', () => {
  mount(); update({ permission: 'blocked', registration: 'off', settingsError: true })
  expect(screen.getByRole('status')).toHaveTextContent('Ajustes del dispositivo')
  expect(screen.getByRole('button', { name: 'Activar' })).toBeVisible()
})
it('separates registration failure from permission activation', () => {
  mount(); update({ permission: 'granted', registration: 'error' })
  expect(screen.queryByRole('button', { name: 'Activar' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })); expect(m.enable).toHaveBeenCalledOnce()
})
it('translates activation to English', () => {
  mount(true, 'en'); update({ permission: 'denied', registration: 'off' })
  expect(screen.getByText('Enable notifications to receive updates about your turn')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Enable' })).toBeVisible()
})
it('exposes only an explicit admission action, safe outside a provider', () => {
  function Admission() { const afterJoin = usePushAfterJoin(); return <button onClick={() => afterJoin('join-id')}>Join</button> }
  const view = render(<Admission />); fireEvent.click(screen.getByText('Join')); expect(m.joined).not.toHaveBeenCalled(); view.unmount()
  render(<MemoryRouter><NativePushProvider><Admission /></NativePushProvider></MemoryRouter>)
  expect(m.joined).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Join')); expect(m.joined).toHaveBeenCalledWith('join-id')
})
