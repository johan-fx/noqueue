import { expect, type APIRequestContext, type Page } from '@playwright/test'
export async function resolveFixtureLocation(
  request: APIRequestContext,
  origin: string,
  text = 'Calle Mayor 1 Madrid',
) {
  const locationOperationId = crypto.randomUUID()
  const response = await request.post('/api/v1/staff/locations/resolve', {
    headers: { Origin: origin },
    data: { text, scope: { kind: 'provision', id: locationOperationId } },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const result = await response.json()
  expect(result.candidates).toHaveLength(1)
  return {
    locationOperationId,
    locationToken: result.candidates[0].token as string,
  }
}
export async function confirmFixtureLocation(page: Page) {
  await page
    .getByLabel('Dirección del establecimiento')
    .fill('Calle Mayor 1 Madrid')
  await page.getByRole('option', { name: /Calle Mayor 1, Madrid/ }).click()
  await expect(page.getByLabel('Dirección del establecimiento')).toHaveValue(
    'Calle Mayor 1, Madrid',
  )
}
