import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { PhoneInput } from './phone-input'

afterEach(cleanup)

function Harness({
  locale = 'en',
  disabled = false,
}: {
  locale?: 'es' | 'en'
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  return (
    <div>
      <PhoneInput
        id="phone"
        aria-label={locale === 'es' ? 'Teléfono' : 'Phone number'}
        locale={locale}
        disabled={disabled}
        value={value}
        onChange={setValue}
      />
      <output aria-label="E.164 value">{value}</output>
    </div>
  )
}

it('defaults to Spain and emits E.164 for a national number', async () => {
  render(<Harness />)
  const country = screen.getByRole('combobox', { name: 'Country' })
  const phone = screen.getByLabelText('Phone number')
  expect(country).toHaveTextContent('+34')
  expect(phone).toHaveValue('')
  expect(phone).toHaveAttribute('inputmode', 'tel')
  expect(phone).toHaveAttribute('autocomplete', 'tel-national')
  fireEvent.change(phone, { target: { value: '612345678' } })
  await waitFor(() =>
    expect(screen.getByLabelText('E.164 value')).toHaveTextContent(
      '+34612345678',
    ),
  )
})

it('lets the user select France and enter a national number', async () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('combobox', { name: 'Country' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Search country' }), {
    target: { value: 'France' },
  })
  fireEvent.click(await screen.findByRole('option', { name: /France/ }))
  expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent(
    '+33',
  )
  fireEvent.change(screen.getByLabelText('Phone number'), {
    target: { value: '612345678' },
  })
  await waitFor(() =>
    expect(screen.getByLabelText('E.164 value')).toHaveTextContent(
      '+33612345678',
    ),
  )
})

it('reinterprets a national number when the selected country changes', async () => {
  render(<Harness />)
  const phone = screen.getByLabelText('Phone number')
  fireEvent.change(phone, { target: { value: '612345678' } })
  await waitFor(() =>
    expect(screen.getByLabelText('E.164 value')).toHaveTextContent(
      '+34612345678',
    ),
  )
  fireEvent.click(screen.getByRole('combobox', { name: 'Country' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Search country' }), {
    target: { value: 'France' },
  })
  fireEvent.click(await screen.findByRole('option', { name: /France/ }))
  await waitFor(() =>
    expect(screen.getByLabelText('E.164 value')).toHaveTextContent(
      '+33612345678',
    ),
  )
})

it('recognizes a pasted international number and resolves its country', async () => {
  render(<Harness />)
  fireEvent.change(screen.getByLabelText('Phone number'), {
    target: { value: '+33612345678' },
  })
  await waitFor(() => {
    expect(screen.getByLabelText('E.164 value')).toHaveTextContent(
      '+33612345678',
    )
    expect(
      screen.getByRole('combobox', { name: 'Country' }),
    ).toHaveTextContent('+33')
  })
})

it('keeps incomplete input visible while the full number is not yet entered', () => {
  render(<Harness />)
  const phone = screen.getByLabelText('Phone number')
  fireEvent.change(phone, { target: { value: '612' } })
  expect(phone).not.toHaveValue('')
})

it('localizes country names and supports keyboard country selection', async () => {
  render(<Harness locale="es" />)
  const country = screen.getByRole('combobox', { name: 'País' })
  fireEvent.click(country)
  const search = screen.getByRole('combobox', { name: 'Buscar país' })
  const popup = search.closest('[data-slot="phone-country-popup"]')
  expect(popup).not.toBeNull()
  expect(popup).toHaveClass(
    'w-72',
    'max-w-[calc(100vw-2rem)]',
    'max-h-(--available-height)',
    'overflow-y-auto',
  )
  fireEvent.change(search, { target: { value: 'Francia' } })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  await waitFor(() => expect(country).toHaveTextContent('+33'))
})

it('disables both country selection and phone entry', () => {
  render(<Harness disabled />)
  const country = screen.getByRole('combobox', { name: 'Country' })
  const phone = screen.getByLabelText('Phone number')
  expect(country).toBeDisabled()
  expect(phone).toBeDisabled()
  fireEvent.click(country)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})
