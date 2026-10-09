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
import {
  publicServiceConsentVersion,
} from '@noqueue/contracts/queue'
import { whatsappConsentNotice } from '@/features/consent/whatsapp-consent-copy'
import { DemoQueue } from './DemoQueue'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('requires explicit public consent and submits the current notice version', async () => {
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
  expect(screen.getByRole('spinbutton', { name: 'Party size' })).toHaveAttribute(
    'data-slot',
    'input',
  )
  expect(screen.getByLabelText('Pilot access code')).toHaveAttribute(
    'data-slot',
    'input',
  )
  expect(screen.getByText(whatsappConsentNotice.en.consent)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Join waiting list' })).toBeDisabled()
  expect(screen.getByLabelText('Phone number')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Pilot access code'), {
    target: { value: 'pilot' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Phone number'), {
    target: { value: '612345678' },
  })
  fireEvent.click(consent)
  fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
    partySize: 2,
    locale: 'en',
    whatsapp: {
      consent: true,
      phone: '+34612345678',
      version: publicServiceConsentVersion,
    },
  })
  await screen.findByRole('alert')
})
