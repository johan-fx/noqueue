import { resolveFixtureLocation } from './location.js'
import {
  expect,
  type Page,
  type APIRequestContext,
  type TestInfo,
} from '@playwright/test'
export type Step = {
  scenarioId: string
  step: string
  actual: unknown
  expected: unknown
  simulatedAt: number
}
export const pilot = {
  'X-NoQueue-Pilot-Token': 'test-pilot-access-at-least-32-characters',
}
export async function setup(
  page: Page,
  request: APIRequestContext,
  origin: string,
  serviceType: 'restaurant' | 'reception' = 'restaurant',
) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    owner = `o_${suffix}`,
    sales = `s_${suffix}`,
    password = 'queue-verification-password'
  const headers = { Origin: origin }
  expect(
    (
      await request.post('/api/v1/experiments/local/staff/identity', {
        headers: pilot,
        data: { username: sales, password },
      })
    ).ok(),
  ).toBeTruthy()
  expect(
    (
      await request.post('/api/v1/auth/sign-in/username', {
        headers,
        data: { username: sales, password },
      })
    ).ok(),
  ).toBeTruthy()
  const response = await request.post(
    '/api/v1/staff/commercial/organizations',
    {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        ...(await resolveFixtureLocation(request, origin)),
        organizationName: 'Verification',
        slug: `verify-${suffix}`,
        venueName: 'Queue Verification',
        timezone: 'Europe/Madrid',
        ownerName: 'Owner',
        ownerUsername: owner,
        ownerPassword: password,
        services: [
          {
            name: serviceType === 'reception' ? 'Reception' : 'Restaurant',
            type: serviceType,
            capacity: 99,
            averageMinutes: 30,
            graceMinutes: serviceType === 'restaurant' ? 5 : 2,
            cutoffMinutes: 0,
            twentyFourHours: true,
            schedules: [],
            receptionServices: serviceType === 'reception' ? ['check_in'] : [],
            spaces:
              serviceType === 'restaurant'
                ? [
                    {
                      id: 'terrace',
                      name: 'Terrace',
                      tables: 1,
                      tableTypes: [{ seats: 4, count: 1, averageMinutes: 50 }],
                    },
                  ]
                : [],
          },
        ],
      },
    },
  )
  expect(response.ok(), await response.text()).toBeTruthy()
  const { venueId } = (await response.json()) as { venueId: string }
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Queue Verification', exact: true }),
  ).toBeVisible()
  const queues = (await (
    await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)
  ).json()) as {
    id: string
    version: number
    config: Record<string, unknown>
  }[]
  const queue = queues[0]!
  if (serviceType === 'restaurant') {
    const ctx = (await (
      await page.request.get(`/api/v1/staff/queues/${queue.id}/opening-context`)
    ).json()) as {
      contextToken: string
      groups: { spaceId: string; seats: number }[]
    }
    expect(
      (
        await page.request.post(`/api/v1/staff/queues/${queue.id}/lifecycle`, {
          headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            action: 'declare_full',
            contextToken: ctx.contextToken,
          },
        })
      ).ok(),
    ).toBeTruthy()
    for (const group of ctx.groups) {
      const current = (await (
        await page.request.get(`/api/v1/staff/queues/${queue.id}/opening-context`)
      ).json()) as { contextToken: string }
      expect(
        (
          await page.request.post(`/api/v1/staff/queues/${queue.id}/lifecycle`, {
            headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
            data: {
              action: 'occupancy',
              contextToken: current.contextToken,
              group: { ...group, occupied: 0 },
              reason: 'Fixture physical capacity update',
            },
          })
        ).ok(),
      ).toBeTruthy()
    }
  }
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  return { queue: queue.id, venueId, headers }
}
export async function join(
  page: Page,
  queue: string,
  name: string,
  partySize = 4,
) {
  await page.goto(`/q/${queue}`)
  await page.getByLabel('Nombre', { exact: true }).fill(name)
  await fillPublicWhatsAppConsent(page)
  for (let i = 1; i < partySize; i++)
    await page.getByRole('button', { name: 'Más comensales' }).click()
  await page.getByRole('button', { name: 'Ponerme en lista' }).click()
  await expect(page).toHaveURL(/\/t\//)
}

export async function fillPublicWhatsAppConsent(page: Page) {
  await page
    .getByLabel(/^(?:Teléfono|Phone number)$/)
    .fill('600000000')
  await page.getByRole('checkbox').check()
}
export async function act(
  page: Page,
  name: string,
  label: string,
  beforeConfirm?: () => Promise<void>,
) {
  const row = page
    .getByRole('dialog', { name: 'Gestionar lista', exact: true })
    .locator('li')
    .filter({ hasText: name })
  await row.getByRole('button', { name: /Acciones del turno/ }).click()
  await row.getByRole('button', { name: label, exact: true }).click()
  await beforeConfirm?.()
  // Arrival confirmation is a direct action; the dashboard does not open a sheet.
  if (label === 'Confirmar llegada') return
  await page
    .getByRole('dialog', { name: label, exact: true })
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click()
}
export async function prove(
  info: TestInfo,
  steps: Step[],
  id: string,
  event: string,
  actual: unknown,
  expected: unknown,
) {
  steps.push({
    scenarioId: id,
    step: event,
    simulatedAt: Date.now(),
    actual,
    expected,
  })
  expect(actual).toEqual(expected)
  await info.attach(event, {
    body: JSON.stringify({ actual, expected }),
    contentType: 'application/json',
  })
}
