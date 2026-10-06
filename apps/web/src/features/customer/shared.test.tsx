import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { CustomerShell, useLocale } from './shared'

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
