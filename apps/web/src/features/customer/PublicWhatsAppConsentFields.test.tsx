import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PublicWhatsAppConsentFields } from './PublicWhatsAppConsentFields'

afterEach(cleanup)

it('uses neutral labels and unique accessible ids for multiple public fields', () => {
  render(
    <>
      <PublicWhatsAppConsentFields
        locale="en"
        phone=""
        consent={false}
        disabled={false}
        onPhoneChange={vi.fn()}
        onConsentChange={vi.fn()}
      />
      <PublicWhatsAppConsentFields
        locale="es"
        phone=""
        consent={false}
        disabled={false}
        onPhoneChange={vi.fn()}
        onConsentChange={vi.fn()}
      />
    </>,
  )

  const englishPhone = screen.getByLabelText('Phone number')
  const spanishPhone = screen.getByLabelText('Teléfono')
  const checkboxes = screen.getAllByRole('checkbox')
  expect(englishPhone.closest('label')).toHaveAttribute('for', englishPhone.id)
  expect(spanishPhone.closest('label')).toHaveAttribute('for', spanishPhone.id)
  expect(englishPhone.id).not.toBe(spanishPhone.id)
  expect(checkboxes[0]?.id).not.toBe(checkboxes[1]?.id)

  fireEvent.blur(englishPhone)
  fireEvent.blur(spanishPhone)

  const relatedIds = [
    englishPhone.id,
    spanishPhone.id,
    ...checkboxes.map((checkbox) => checkbox.id),
    ...[englishPhone, spanishPhone].flatMap((phone) =>
      phone.getAttribute('aria-describedby')?.split(/\s+/) ?? [],
    ),
  ]
  expect(new Set(relatedIds).size).toBe(relatedIds.length)
  for (const id of relatedIds) expect(document.getElementById(id)).not.toBeNull()
  expect(screen.getAllByRole('alert')).toHaveLength(2)
  for (const phone of [englishPhone, spanishPhone]) {
    const errorId = phone
      .getAttribute('aria-describedby')
      ?.split(/\s+/)
      .find((id) => id.endsWith('-phone-error'))
    expect(errorId).toBeDefined()
    expect(document.getElementById(errorId!)).toHaveAttribute('role', 'alert')
  }
})
