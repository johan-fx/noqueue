import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ runtime: 'native', factory: vi.fn(), start: vi.fn(), enable: vi.fn(), disable: vi.fn(), dispose: vi.fn() }))
vi.mock('@/app/bootstrap/runtime', () => ({ detectRuntime: () => m.runtime }))
vi.mock('./push-registration', () => ({ createNativePush: m.factory }))
import { NativePushProvider, NativePushControls } from './NativePush'
beforeEach(() => { vi.clearAllMocks(); m.runtime = 'native'; m.factory.mockReturnValue({ start: m.start, enable: m.enable, disable: m.disable, dispose: m.dispose }) })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
function mount(hasTurn = true) { return render(<MemoryRouter><NativePushProvider><NativePushControls locale="es" hasTurn={hasTurn} /></NativePushProvider></MemoryRouter>) }
it.each([['web', 'true'], ['native', 'false']])('does not initialize push for runtime=%s flag=%s', (runtime, flag) => {
  m.runtime = runtime; vi.stubEnv('VITE_MOBILE_PUSH_ENABLED', flag); mount()
  expect(m.factory).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull()
})
it('offers contextual activation without automatically requesting it', () => {
  vi.stubEnv('VITE_MOBILE_PUSH_ENABLED', 'true'); const view = mount()
  expect(m.start).toHaveBeenCalledOnce(); expect(m.enable).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Activar avisos' }))
  expect(m.enable).toHaveBeenCalledOnce(); view.unmount(); expect(m.dispose).toHaveBeenCalledOnce()
})
it('does not offer first-time activation on an empty turn list', () => {
  vi.stubEnv('VITE_MOBILE_PUSH_ENABLED', 'true'); mount(false)
  expect(screen.queryByRole('button')).toBeNull(); expect(m.enable).not.toHaveBeenCalled()
})
