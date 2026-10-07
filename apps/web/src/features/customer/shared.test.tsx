import { useLocale } from './public-resource'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { CustomerShell } from './shared'

afterEach(cleanup)
function Harness() {
  const [locale, setLocale] = useLocale()
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <CustomerShell
      title="No Queue"
      back="/"
      locale={locale}
      setLocale={setLocale}
    >
      <output aria-label="Route">{location.pathname + location.search}</output>
      <button onClick={() => navigate(-1)}>Previous page</button>
    </CustomerShell>
  )
}
it('renders one compact shadcn language trigger with its initial localized value', () => {
  render(
    <MemoryRouter initialEntries={['/q/demo-queue?lang=en']}>
      <Harness />
    </MemoryRouter>,
  )
  const trigger = screen.getByRole('combobox', { name: 'Language' })
  expect(trigger.tagName).toBe('BUTTON')
  expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
  expect(trigger.querySelector('[data-slot="select-value"]')).toHaveTextContent(
    'EN',
  )
  expect(screen.getAllByRole('combobox')).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
    'href',
    '/',
  )
})
it('changes language without dropping query parameters or adding a history entry', async () => {
  render(
    <MemoryRouter
      initialEntries={[
        '/before',
        '/q/demo-queue?lang=es&type=pool&page=2&text=hotel',
      ]}
      initialIndex={1}
    >
      <Harness />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('combobox', { name: 'Idioma' }))
  const option = await screen.findByRole('option', { name: 'EN' })
  fireEvent.pointerDown(option, { pointerType: 'mouse' })
  fireEvent.click(option, { detail: 1 })
  expect(screen.getByLabelText('Route')).toHaveTextContent(
    '/q/demo-queue?lang=en&type=pool&page=2&text=hotel',
  )
  expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent(
    'EN',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
  expect(screen.getByLabelText('Route')).toHaveTextContent('/before')
})

it('polls public resources every five seconds only while visible and deduplicates focus', async () => {
  const { act } = await import('@testing-library/react')
  const { vi } = await import('vitest')
  const { usePublicResource } = await import('./public-resource')
  const parse = (value: unknown) => value
  function Resource() {
    usePublicResource('/api/test', parse)
    return null
  }
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetch)
  try {
    await act(async () => {
      render(<Resource />)
      await Promise.resolve()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(fetch).toHaveBeenCalledTimes(3)
  } finally {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})
