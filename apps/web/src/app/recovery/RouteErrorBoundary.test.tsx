import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { requestAppReload } from '../pwa/update-coordinator'
import { detectRuntime } from '../bootstrap/runtime'
import { withRouteRecovery } from './with-route-recovery'

vi.mock('../pwa/update-coordinator', () => ({
  requestAppReload: vi.fn(),
  getPwaUpdateErrorMessage: (_error: unknown, locale: string) => locale === 'en'
    ? 'Close other No Queue tabs and try again.'
    : 'Cierra las otras pestañas de No Queue y vuelve a intentarlo.',
}))
vi.mock('../bootstrap/runtime', () => ({ detectRuntime: vi.fn(() => 'web') }))

const routers: ReturnType<typeof createMemoryRouter>[] = []
const chunkFailure = new TypeError('Failed to fetch dynamically imported module: https://example.com/assets/PublicQueue-old.js')

function renderFailedRoute(error: unknown = chunkFailure, initialEntry = '/q/a?lang=es') {
  const router = createMemoryRouter(withRouteRecovery([
    { path: '/q/:queueId', lazy: async () => { throw error } },
    { path: '/t/:recoveryToken', lazy: async () => { throw error } },
    { path: '/', element: <p>Home</p> },
  ]), { initialEntries: [initialEntry] })
  routers.push(router)
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.mocked(detectRuntime).mockReturnValue('web')
  vi.mocked(requestAppReload).mockReset().mockResolvedValue(undefined)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  routers.splice(0).forEach(router => router.dispose())
  vi.restoreAllMocks()
})

it('catches an initial lazy route failure eagerly without raw stack/URL or automatic reload', async () => {
  renderFailedRoute()
  expect(await screen.findByRole('heading', { name: 'No se ha podido cargar esta pantalla' })).toBeVisible()
  expect(screen.getByText(/Puede haber una nueva versión/)).toBeVisible()
  expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument()
  expect(screen.queryByText(/PublicQueue-old/)).not.toBeInTheDocument()
  expect(requestAppReload).not.toHaveBeenCalled()
})

it('catches lazy failures during client navigation as well as initial load', async () => {
  const router = renderFailedRoute(chunkFailure, '/')
  await screen.findByText('Home')
  await act(() => router.navigate('/q/a'))
  expect(await screen.findByRole('button', { name: 'Volver a cargar' })).toBeEnabled()
  expect(requestAppReload).not.toHaveBeenCalled()
})

it('uses the coordinator only after explicit consent and ignores double clicks', async () => {
  vi.mocked(requestAppReload).mockReturnValue(new Promise(() => {}))
  renderFailedRoute()
  const button = await screen.findByRole('button', { name: 'Volver a cargar' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(requestAppReload).toHaveBeenCalledTimes(1)
  expect(button).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Preparando la recarga')
})

it('keeps recovery link and stored data intact, and lets a failed attempt be retried manually', async () => {
  vi.mocked(requestAppReload).mockRejectedValueOnce(new Error('blocked'))
  localStorage.setItem('noqueue.test-turn', 'keep-local')
  sessionStorage.setItem('noqueue.test-form', 'keep-session')
  const router = renderFailedRoute(chunkFailure, '/t/private-token?lang=en#details')
  fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Close other No Queue tabs')
  expect(router.state.location).toMatchObject({ pathname: '/t/private-token', search: '?lang=en', hash: '#details' })
  expect(localStorage.getItem('noqueue.test-turn')).toBe('keep-local')
  expect(sessionStorage.getItem('noqueue.test-form')).toBe('keep-session')
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  expect(requestAppReload).toHaveBeenCalledTimes(2)
  localStorage.removeItem('noqueue.test-turn')
  sessionStorage.removeItem('noqueue.test-form')
})

it('offers offline guidance and enables manual retry on reconnect without reloading itself', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  renderFailedRoute()
  const button = await screen.findByRole('button', { name: 'Volver a cargar' })
  expect(button).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('No tienes conexión')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('online')))
  expect(button).toBeEnabled()
  expect(requestAppReload).not.toHaveBeenCalled()
})

it('does not misdiagnose or expose an unrelated application error', async () => {
  renderFailedRoute(new Error('backend secret raw stack or token'))
  await screen.findByRole('heading')
  expect(screen.getByText(/Se ha producido un error inesperado/)).toBeVisible()
  expect(screen.queryByText(/nueva versión/)).not.toBeInTheDocument()
  expect(screen.queryByText(/backend secret/)).not.toBeInTheDocument()
  expect(requestAppReload).not.toHaveBeenCalled()
})

it('allows an offline native shell to recover its locally packaged modules', async () => {
  vi.mocked(detectRuntime).mockReturnValue('native')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  renderFailedRoute()
  const button = await screen.findByRole('button', { name: 'Volver a cargar' })
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(requestAppReload).toHaveBeenCalledOnce()
})
