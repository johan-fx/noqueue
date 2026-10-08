import { expect, test } from '../fixtures.js'

test('serves the web app and versioned health endpoint', async ({
  page,
  request,
}) => {
  const healthResponse = await request.get('/api/v1/health')
  expect(healthResponse.ok()).toBeTruthy()
  await expect(healthResponse.json()).resolves.toEqual({
    status: 'ok',
    service: 'noqueue-api',
  })

  await page.goto('/')
  await expect(
    page.getByRole('heading', {
      name: '¿Dónde quieres unirte a la lista de espera?',
    }),
  ).toBeVisible()
  await page.goto('/demo')
  await expect(page.getByText('No Queue · Web')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Join the waiting list' }),
  ).toBeVisible()
})
