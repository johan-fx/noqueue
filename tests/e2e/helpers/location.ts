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
  const input = page.getByLabel('Dirección del establecimiento')
  // fill() can edit an offscreen input without scrolling in WebKit. Focus it
  // like a pointer user first, so the portalled suggestions have a visible anchor.
  await input.click()
  await expect(input).toBeInViewport()
  await input.fill('Calle Mayor 1 Madrid')
  const candidate = page.getByRole('option', { name: /Calle Mayor 1, Madrid/ })
  // Results arrive after the debounce and provider response. Check their render
  // before their geometry; keep the viewport assertion (do not force/scroll them).
  await expect(candidate).toBeVisible()
  await expect(candidate).toBeInViewport()
  await candidate.click()
  await expect(input).toHaveValue('Calle Mayor 1, Madrid')
}
