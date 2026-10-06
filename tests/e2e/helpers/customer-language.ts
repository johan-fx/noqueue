import { expect, type Page } from '@playwright/test'

export async function selectCustomerLanguage(page: Page, locale: 'es' | 'en') {
  const previous = locale === 'en' ? 'ES' : 'EN'
  const trigger = page.getByRole('combobox', {
    name: locale === 'en' ? 'Idioma' : 'Language',
    exact: true,
  })
  await expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
  await trigger.focus()
  await trigger.press('ArrowDown')
  await expect(
    page.getByRole('option', { name: previous, exact: true }),
  ).toBeFocused()
  await page.keyboard.press(locale === 'en' ? 'ArrowDown' : 'ArrowUp')
  await expect(
    page.getByRole('option', { name: locale.toUpperCase(), exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  const changed = page.getByRole('combobox', {
    name: locale === 'en' ? 'Language' : 'Idioma',
    exact: true,
  })
  await expect(changed.locator('[data-slot="select-value"]')).toHaveText(
    locale.toUpperCase(),
  )
  await expect(changed).toBeFocused()
}
