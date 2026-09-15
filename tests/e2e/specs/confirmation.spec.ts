import { expect, test } from '@playwright/test'

test('staff and customer experiment uses the real local turn, confirmation inbox and revocation', async ({
  page,
  browserName,
}) => {
  await page.goto('/api/v1/experiments/local/confirmation')
  await expect(
    page.getByRole('heading', {
      name: 'EXPERIMENT — staff-assisted confirmation',
    }),
  ).toBeVisible()
  await expect(
    page.getByText('LOCAL SIMULATION.', { exact: false }),
  ).toBeVisible()
  await page
    .getByLabel('Pilot access code')
    .fill('test-pilot-access-at-least-32-characters')
  await page
    .getByLabel('Phone with international prefix')
    .fill(
      {
        chromium: '+34600000001',
        firefox: '+34600000002',
        webkit: '+34600000003',
      }[browserName],
    )
  await page.getByLabel('Party size').fill('3')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create experimental turn' }).click()
  await expect(
    page.getByText('Updates permission: pending', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Simulated request: accepted', { exact: true }),
  ).toBeVisible({ timeout: 30000 })
  await page
    .getByRole('button', { name: 'Simulate CONFIRMO button', exact: true })
    .click()
  await expect(
    page.getByText('Updates permission: confirmed', { exact: true }),
  ).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Simulate STOP', exact: true }).click()
  await expect(
    page.getByText('Updates permission: revoked', { exact: true }),
  ).toBeVisible({ timeout: 30000 })
  await page
    .getByRole('button', { name: 'Simulate CONFIRMO button', exact: true })
    .click()
  await expect(
    page.getByText('Updates permission: revoked', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/^Turn .* — waiting — position/)).toBeVisible()
})
