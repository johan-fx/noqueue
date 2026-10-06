import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LocationPicker } from './LocationPicker'
import { api, ApiError } from './api'
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}))
const scope = { kind: 'provision' as const, id: 'operation' }
const candidate = () => ({
  token: 'signed',
  expiresAt: Date.now() + 600000,
  location: {
    formatted: 'Calle Mayor 1, Madrid',
    attribution: [{ text: 'Geoapify', url: 'https://www.geoapify.com/' }],
  },
})
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})
const tick = async (ms = 350) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
function setup(initialAddress = '') {
  const onSelection = vi.fn()
  const view = render(
    <LocationPicker
      scope={scope}
      onSelection={onSelection}
      initialAddress={initialAddress}
    />,
  )
  return {
    ...view,
    onSelection,
    input: screen.getByLabelText('Dirección del establecimiento'),
  }
}
function type(input: HTMLElement, value = 'Calle Mayor 1 Madrid') {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
}
it('debounces from five trimmed characters; Enter explicitly selects without querying formatted text and edits invalidate immediately', async () => {
  vi.mocked(api).mockResolvedValue({ candidates: [candidate()] })
  const { input, onSelection } = setup('Existing Madrid')
  await tick()
  expect(api).not.toHaveBeenCalled()
  type(input, ' abcd ')
  await tick()
  expect(api).not.toHaveBeenCalled()
  type(input)
  await tick(349)
  expect(api).not.toHaveBeenCalled()
  await tick(1)
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith(
    '/locations/autocomplete',
    'POST',
    { text: 'Calle Mayor 1 Madrid', scope },
    undefined,
    expect.any(AbortSignal),
  )
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(onSelection).not.toHaveBeenCalledWith('signed')
  fireEvent.keyDown(input, { key: 'Enter' })
  await tick(0)
  expect(onSelection).toHaveBeenLastCalledWith('signed')
  expect(input).toHaveValue('Calle Mayor 1, Madrid')
  await tick()
  expect(api).toHaveBeenCalledTimes(1)
  type(input, 'Calle Mayor 2 Madrid')
  expect(onSelection).toHaveBeenLastCalledWith('')
})
it('ignores out-of-order results and old finally; Escape cancels an empty popup without resurfacing', async () => {
  let first!: (value: unknown) => void, second!: (value: unknown) => void
  vi.mocked(api)
    .mockImplementationOnce(() => new Promise((r) => (first = r)))
    .mockImplementationOnce(() => new Promise((r) => (second = r)))
  const { input } = setup()
  type(input)
  await tick()
  const signal = vi.mocked(api).mock.calls[0]![4] as AbortSignal
  type(input, 'Calle Nueva Madrid')
  await tick()
  expect(signal.aborted).toBe(true)
  await act(async () => first({ candidates: [candidate()] }))
  expect(screen.getByRole('status')).toHaveTextContent('Buscando')
  fireEvent.keyDown(input, { key: 'Escape' })
  await tick(0)
  expect(input).toHaveAttribute('aria-expanded', 'false')
  await act(async () => second({ candidates: [candidate()] }))
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await tick()
  expect(api).toHaveBeenCalledTimes(2)
})
it('waits for composition end; Tab and blur do not confirm a highlighted result', async () => {
  vi.mocked(api).mockResolvedValue({ candidates: [candidate()] })
  const { input, onSelection } = setup()
  fireEvent.compositionStart(input)
  type(input)
  await tick(1000)
  expect(api).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  await tick()
  expect(api).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Tab' })
  fireEvent.blur(input)
  expect(onSelection).not.toHaveBeenCalledWith('signed')
})
it('expires selected tokens, preserves input and disables confirmation until explicit reselection', async () => {
  vi.mocked(api).mockResolvedValue({
    candidates: [{ ...candidate(), expiresAt: Date.now() + 1000 }],
  })
  const { input, onSelection } = setup()
  type(input)
  await tick()
  fireEvent.click(screen.getByRole('option'))
  expect(onSelection).toHaveBeenLastCalledWith('signed')
  await tick(650)
  expect(onSelection).toHaveBeenLastCalledWith('')
  expect(screen.getByRole('status')).toHaveTextContent('caducado')
  expect(input).toHaveValue('Calle Mayor 1, Madrid')
  expect(api).toHaveBeenCalledTimes(1)
})
it('preserves text on provider error and explicit retry respects Retry-After', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new ApiError(429, 'Demasiados intentos', 2))
    .mockResolvedValue({ candidates: [] })
  const { input } = setup()
  type(input)
  await tick()
  expect(input).toHaveValue('Calle Mayor 1 Madrid')
  const retry = screen.getByRole('button', { name: 'Reintentar búsqueda' })
  expect(retry).toBeDisabled()
  await tick(2000)
  expect(retry).toBeEnabled()
  expect(api).toHaveBeenCalledTimes(1)
  fireEvent.click(retry)
  await tick(0)
  expect(api).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('status')).toHaveTextContent('No hay direcciones')
})
it('scope change and unmount abort work and discard confirmation', async () => {
  vi.mocked(api).mockImplementation(() => new Promise(() => {}))
  const { input, rerender, onSelection, unmount } = setup()
  type(input)
  await tick()
  const signal = vi.mocked(api).mock.calls[0]![4] as AbortSignal
  rerender(
    <LocationPicker
      scope={{ kind: 'venue', id: 'other' }}
      onSelection={onSelection}
    />,
  )
  expect(signal.aborted).toBe(true)
  await tick()
  expect(api).toHaveBeenCalledTimes(1)
  type(
    screen.getByLabelText('Dirección del establecimiento'),
    'Calle Nueva Madrid',
  )
  await tick()
  const last = vi.mocked(api).mock.calls[1]![4] as AbortSignal
  unmount()
  expect(last.aborted).toBe(true)
})
it('empty popup exposes an accessible explicit retry instead of hiding it behind the popup', async () => {
  vi.mocked(api).mockResolvedValue({ candidates: [] })
  const { input } = setup()
  type(input)
  await tick()
  expect(
    screen.getByRole('combobox', { name: 'Dirección del establecimiento' }),
  ).toBe(input)
  const retry = screen.getByRole('button', { name: 'Reintentar búsqueda' })
  expect(retry).toBeEnabled()
  fireEvent.click(retry)
  await tick(0)
  expect(api).toHaveBeenCalledTimes(2)
})

it('composition immediately invalidates a selected address before composed text commits', async () => {
  vi.mocked(api).mockResolvedValue({ candidates: [candidate()] })
  const { input, onSelection } = setup()
  type(input)
  await tick()
  fireEvent.click(screen.getByRole('option'))
  expect(onSelection).toHaveBeenLastCalledWith('signed')
  fireEvent.compositionStart(input)
  expect(onSelection).toHaveBeenLastCalledWith('')
  fireEvent.change(input, { target: { value: 'Calle Nueva Madrid' } })
  await tick(1000)
  expect(api).toHaveBeenCalledTimes(1)
  fireEvent.compositionEnd(input)
  await tick()
  expect(api).toHaveBeenCalledTimes(2)
})
