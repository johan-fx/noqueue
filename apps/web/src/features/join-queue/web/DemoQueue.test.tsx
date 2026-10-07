import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { DemoQueue } from './DemoQueue'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('uses controlled Base UI locale and consent without changing form payloads', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false })
  vi.stubGlobal('fetch', fetch)
  render(
    <MemoryRouter>
      <DemoQueue />
    </MemoryRouter>,
  )
  const locale = screen.getByRole('combobox', { name: 'Idioma' })
  expect(locale).toHaveAttribute('data-slot', 'select-trigger')
  expect(locale).toHaveTextContent('Español')
  fireEvent.click(locale)
  {
    const option = await screen.findByRole('option', { name: 'English' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option, { detail: 1 })
  }
  const consent = screen.getByRole('checkbox')
  expect(consent).toHaveAttribute('data-slot', 'checkbox')
  expect(consent).not.toBeChecked()
  fireEvent.click(consent)
  expect(screen.getByLabelText('Phone with country code')).toBeVisible()
  fireEvent.click(consent)
  expect(
    screen.queryByLabelText('Phone with country code'),
  ).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Pilot access code'), {
    target: { value: 'pilot' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({
    locale: 'en',
    whatsapp: { consent: false },
  })
  await screen.findByRole('alert')
  fireEvent.click(consent)
  fireEvent.change(screen.getByLabelText('Phone with country code'), {
    target: { value: '+34600000000' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({
    locale: 'en',
    whatsapp: { consent: true, phone: '+34600000000' },
  })
})
