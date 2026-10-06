import { test, expect } from '@playwright/test'
import { setup, join } from '../helpers/queue-actions.js'
import type {
  Entry,
  PublicService,
} from '../../../packages/contracts/src/queue.js'

test('customer joins from the venue, recovers, edits, yields and cancels against the real API', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(90000)
  const t = await setup(page, request, baseURL!)
  const guest = await browser.newContext({
    baseURL: baseURL!,
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'CF-Connecting-IP': crypto.randomUUID() },
  })
  try {
    const client = await guest.newPage()
    // Keep the first guest in the waiting state for the edit path.
    const queues = await (
      await page.request.get(`/api/v1/staff/venues/${t.venueId}/queues`)
    ).json()
    const config = queues[0]
    expect(
      (
        await page.request.patch(`/api/v1/staff/queues/${t.queue}`, {
          headers: t.headers,
          data: {
            ...config.config,
            version: config.version,
            open: true,
            approachTurns: 0,
            approachMinutes: 0,
          },
        })
      ).ok(),
    ).toBeTruthy()
    for (let i = 0; i < 4; i++) {
      const response = await guest.request.post(
        `/api/v1/public/services/${t.queue}/entries`,
        {
          headers: { Origin: baseURL!, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            displayName: `Ahead ${i}`,
            partySize: 4,
            preferredSpaceId: 'fastest',
            locale: 'es',
          },
        },
      )
      expect(response.ok()).toBeTruthy()
    }
    await client.goto(`/v/${t.venueId}`)
    await expect(
      client.getByText('16 personas en lista de espera'),
    ).toBeVisible()
    await client.getByRole('link', { name: /Restaurant/ }).click()
    await client.getByLabel('Nombre', { exact: true }).fill('María Cliente')
    await client.getByRole('button', { name: 'Ponerme en lista' }).click()
    await expect(client).toHaveURL(/\/t\//)
    await expect(client.getByText('4 turnos')).toBeVisible()
    const recoveryUrl = client.url()
    await client.reload()
    await expect(client.getByText('4 turnos')).toBeVisible()
    await client.getByRole('button', { name: 'Modificar', exact: true }).click()
    await client.getByLabel('Nombre', { exact: true }).fill('María Editada')
    await client.getByRole('button', { name: 'Más comensales' }).click()
    await client.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(client.getByText('4 turnos')).toBeVisible()
    const token = new URL(recoveryUrl).pathname.split('/').at(-1)!
    let snapshot = (await (
      await guest.request.get(`/api/v1/public/entries/${token}`)
    ).json()) as Entry
    expect(snapshot.customer).toMatchObject({
      displayName: 'María Editada',
      partySize: 2,
      version: 1,
    })
    const successor = await guest.request.post(
      `/api/v1/public/services/${t.queue}/entries`,
      {
        headers: { Origin: baseURL!, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          displayName: 'Successor',
          partySize: 2,
          preferredSpaceId: 'fastest',
          locale: 'es',
        },
      },
    )
    expect(successor.ok()).toBeTruthy()
    const latest = (
      await (
        await page.request.get(`/api/v1/staff/venues/${t.venueId}/queues`)
      ).json()
    )[0]
    const updated = await page.request.patch(
      `/api/v1/staff/queues/${t.queue}`,
      {
        headers: t.headers,
        data: {
          ...latest.config,
          version: latest.version,
          open: true,
          approachTurns: 10,
          applyApproachToActive: true,
        },
      },
    )
    expect(updated.ok(), await updated.text()).toBeTruthy()
    await expect(client.getByText('Ya casi es tu turno')).toBeVisible()
    await client
      .getByRole('button', { name: 'Pasar turno', exact: true })
      .click()
    await expect(client.getByRole('dialog')).toBeVisible()
    await client.getByRole('button', { name: 'Sí, pasar turno' }).click()
    await expect(client.getByText('5 turnos')).toBeVisible()
    await client.getByRole('button', { name: 'Abandonar la lista' }).click()
    await client.getByRole('button', { name: 'Sí, abandonar' }).click()
    await expect(client.getByText('Has abandonado la lista')).toBeVisible()
    snapshot = (await (
      await guest.request.get(`/api/v1/public/entries/${token}`)
    ).json()) as Entry
    expect(snapshot.status).toBe('cancelled')
    await client
      .getByRole('link', { name: 'Seleccionar lista de espera' })
      .click()
    await expect(client).toHaveURL(new RegExp(`/v/${t.venueId}`))
    await client.getByLabel('Idioma').selectOption('en')
    await expect(
      client.getByRole('heading', { name: /Welcome to/ }),
    ).toBeVisible()
  } finally {
    await guest.close()
  }
})

test('a lost command response retries the same browser intent without applying it twice', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const t = await setup(page, request, baseURL!)
  const guest = await browser.newContext({
    baseURL: baseURL!,
    // Intercept transport only; both POST attempts execute against the real server.
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'CF-Connecting-IP': crypto.randomUUID() },
  })
  try {
    const client = await guest.newPage()
    await join(client, t.queue, 'Response loss')
    const token = new URL(client.url()).pathname.split('/').at(-1)!
    const attempts: {
      key: string | undefined
      payload: string | null
      status: number
      body: unknown
    }[] = []
    await client.route(
      `**/api/v1/public/entries/${token}/commands`,
      async (route) => {
        const response = await route.fetch()
        attempts.push({
          key: route.request().headers()['idempotency-key'],
          payload: route.request().postData(),
          status: response.status(),
          body: await response.json(),
        })
        if (attempts.length === 1) await route.abort('failed')
        else await route.fulfill({ response })
      },
    )
    await client.getByRole('button', { name: 'Abandonar la lista' }).click()
    await client.getByRole('button', { name: 'Sí, abandonar' }).click()
    await expect(client.getByRole('dialog').getByRole('alert')).toBeVisible()
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.status).toBe(200)
    const committed = (await (
      await guest.request.get(`/api/v1/public/entries/${token}`)
    ).json()) as Entry
    expect(committed).toMatchObject({
      status: 'cancelled',
      customer: { version: 1 },
    })
    // Losing the response must not dismiss the sheet or invent a successful confirmation.
    await expect(client.getByRole('dialog')).toBeVisible()
    await client.getByRole('button', { name: 'Sí, abandonar' }).click()
    await expect(client.getByRole('dialog')).not.toBeVisible()
    await expect(client.getByText('Has abandonado la lista')).toBeVisible()
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual(attempts[0])
    expect(attempts[0]!.key).toMatch(/^[a-f0-9-]{36}$/)
    const replayed = (await (
      await guest.request.get(`/api/v1/public/entries/${token}`)
    ).json()) as Entry
    expect(replayed).toMatchObject({
      status: 'cancelled',
      customer: { version: 1 },
    })
  } finally {
    await guest.close()
  }
})

const service: PublicService = {
  id: 'restaurant',
  name: 'Restaurante',
  venueId: 'venue',
  venueName: 'Hotel Miramar',
  type: 'restaurant',
  open: 1,
  receptionServices: [],
  spaces: [
    { id: 'terrace', name: 'Terraza', maxPartySize: 8 },
    { id: 'interior', name: 'Interior', maxPartySize: 6 },
    { id: 'bar', name: 'Barra', maxPartySize: 2 },
  ],
}
test.describe('visual customer states', () => {
  // Route fixtures must bypass the app service worker; real API coverage above does not.
  test.use({ serviceWorkers: 'block' })
  test('visual fixtures cover all diner states at 390px, modal keyboard interaction and refresh recovery', async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const token = 'a'.repeat(64)
    let phase: NonNullable<Entry['customer']>['phase'] = 'waiting'
    let offline = false
    await page.route('**/api/v1/public/services/restaurant', (route) =>
      route.fulfill({ json: service }),
    )
    await page.route('**/api/v1/public/venues/venue/services', (route) =>
      route.fulfill({
        json: {
          id: 'venue',
          name: 'Hotel Miramar',
          services: [
            { ...service, waitingPeople: 6, averageWaitMinutes: 30 },
            {
              ...service,
              id: 'reception',
              name: 'Recepción',
              type: 'reception',
              waitingPeople: 4,
              averageWaitMinutes: 8,
            },
            {
              ...service,
              id: 'pool',
              name: 'Bar Piscina',
              type: 'pool',
              waitingPeople: 5,
              averageWaitMinutes: 20,
            },
          ],
        },
      }),
    )
    await page.route(`**/api/v1/public/entries/${token}`, (route) =>
      offline
        ? route.abort()
        : route.fulfill({
            json: {
              code: 'XP03',
              status:
                phase === 'arrived'
                  ? 'served'
                  : phase === 'approaching'
                  ? 'waiting'
                  : phase,
              position: phase === 'approaching' ? 3 : 6,
              etaMinutes: phase === 'approaching' ? 10 : 30,
              estimateQuality: 'estimated',
              notification: 'disabled',
              customer: {
                service,
                displayName: 'María López',
                partySize: 4,
                preferredSpaceId: 'terrace',
                locale: 'es',
                version: 0,
                serverNow: Date.now(),
                createdAt: Date.now(),
                calledAt: Date.now(),
                arrivalDeadlineAt: Date.now() + 300000,
                arrivedAt: new Date('2026-09-30T19:35:00').getTime(),
                phase,
                actions: ['cancel', 'update', 'yield'],
              },
            },
          }),
    )
    const capture = async (name: string) => {
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        )
      })
      await page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
      })
      await info.attach(name, {
        path: info.outputPath(`${name}.png`),
        contentType: 'image/png',
      })
    }
    await page.goto('/v/venue')
    await expect(page.getByText('6 personas en lista de espera')).toBeVisible()
    await capture('selector')
    await page.goto('/q/restaurant')
    await page.getByLabel('Nombre', { exact: true }).fill('María López')
    for (let i = 0; i < 3; i++)
      await page.getByRole('button', { name: 'Más comensales' }).click()
    await page.getByRole('radio', { name: 'Terraza' }).check()
    await capture('join')
    for (const next of [
      'waiting',
      'approaching',
      'called',
      'arrived',
      'expired',
      'cancelled',
    ] as const) {
      phase = next
      await page.goto(`/t/${token}`)
      await expect(page.getByRole('heading').first()).toBeVisible()
      await expect(page.getByText('Cargando…')).toHaveCount(0)
      await capture(next)
      if (phase === 'approaching') {
        await page
          .getByRole('button', { name: 'Pasar turno', exact: true })
          .click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
        await capture('yield-sheet')
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
    }
    phase = 'waiting'
    await page.goto(`/t/${token}`)
    await expect(page.getByText('5 turnos')).toBeVisible()
    offline = true
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('5 turnos')).toBeVisible()
    offline = false
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
