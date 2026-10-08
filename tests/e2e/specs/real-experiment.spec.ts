import { expect, test } from '../fixtures.js'
import { strictApiMocks } from '../helpers/api-mocks.js'

test.describe('simulated experiment page contract', () => {
  test.use({ serviceWorkers: 'block' })

  test('explains delivery safely and retries an explicit advance with the same key', async ({
    page,
  }) => {
    await page.goto('/api/v1/experiments/confirmation')

    const snapshots = [
      {
        entries: [
          {
            code: 'TEST-01',
            partySize: 3,
            status: 'waiting',
            position: 4,
            confirmation: 'confirmed',
            notification: 'accepted',
          },
        ],
      },
      {
        entries: [
          {
            code: 'TEST-01',
            partySize: 3,
            status: 'waiting',
            position: 4,
            confirmation: 'confirmed',
            notification: 'unknown',
          },
        ],
      },
      {
        entries: [
          {
            code: 'TEST-01',
            partySize: 3,
            status: 'waiting',
            position: 3,
            confirmation: 'confirmed',
            notification: 'unknown',
          },
        ],
      },
    ]
    let snapshotIndex = 0
    const advanceKeys: string[] = []
    const mocks = await strictApiMocks(page, [
      {
        method: 'GET',
        path: '/api/v1/experiments/confirmation/state',
        expectedHits: { min: 3 },
        respond: () => ({
          json: snapshots[Math.min(snapshotIndex++, snapshots.length - 1)],
        }),
      },
      {
        method: 'POST',
        path: '/api/v1/experiments/confirmation/advance',
        expectedHits: 2,
        respond: (request) => {
          advanceKeys.push(request.headers()['idempotency-key'] ?? '')
          return advanceKeys.length === 1
            ? { json: { error: 'transport_interrupted' }, abort: true }
            : { json: { action: 'advance' } }
        },
      },
    ])

    await page
      .getByLabel('Acceso al piloto')
      .fill('test-pilot-access-at-least-32-characters')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.locator('#delivery-badge')).toHaveText(
      'Aceptado por WhatsApp',
    )
    await expect(page.locator('#delivery-detail')).toContainText(
      'todavía no confirma su entrega',
    )

    await page.locator('#refresh').click()
    await expect(page.locator('#delivery-badge')).toHaveText(
      'Resultado incierto',
    )
    await expect(page.locator('#delivery-detail')).toContainText(
      'No se reintentará automáticamente',
    )
    await expect(page.getByRole('button', { name: /reenviar/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /reenviar/i })).toHaveCount(0)

    const advance = page.getByRole('button', {
      name: 'Avanzar un turno',
      exact: true,
    })
    await advance.click()
    await expect(page.getByRole('alert')).toContainText(
      'No pudimos comprobar el resultado',
    )
    await expect(advance).toBeEnabled()
    await advance.click()
    await expect(page.locator('#guest-position')).toHaveText('3')
    expect(advanceKeys).toHaveLength(2)
    expect(advanceKeys[0]).toMatch(/^[0-9a-f-]{36}$/i)
    expect(advanceKeys[1]).toBe(advanceKeys[0])
    await mocks.assertComplete()
  })
})
