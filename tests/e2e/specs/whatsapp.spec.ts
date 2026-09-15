import { expect, test } from '@playwright/test'
test('joins the demo queue and receives provider delivery through the real worker', async ({
  page,
}) => {
  await page.goto('/q/demo-queue')
  await page
    .getByLabel('Código de acceso a pruebas')
    .fill('test-pilot-access-at-least-32-characters')
  await page.getByRole('checkbox').check()
  await page
    .getByLabel('Teléfono con prefijo internacional')
    .fill('+34600000000')
  await page.getByRole('button', { name: 'Apuntarme a la cola' }).click()
  await expect(page).toHaveURL(/\/t\/[a-f0-9]{64}/)
  await expect(page.getByRole('heading', { name: 'Tu turno' })).toBeVisible()
  await expect(page.getByText('WhatsApp: delivered')).toBeVisible({
    timeout: 30000,
  })
  await page.reload()
  await expect(page.getByText('WhatsApp: delivered')).toBeVisible()
})
