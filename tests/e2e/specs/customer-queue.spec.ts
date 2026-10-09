import { test, expect, newClientContext, type Page } from '../fixtures.js'
import { setup, join } from '../helpers/queue-actions.js'
import { selectCustomerLanguage } from '../helpers/customer-language.js'
import { strictApiMocks } from '../helpers/api-mocks.js'
import type {
  Entry,
  PublicService,
} from '../../../packages/contracts/src/queue.js'

async function assertWhatsAppConsentGate(page: Page) {
  const phone = page.getByLabel(
    /^(?:Teléfono|Phone number)$/,
  )
  const consent = page.getByRole('checkbox')
  const joinButton = page.getByRole('button', {
    name: 'Ponerme en lista',
  })

  await expect(consent).not.toBeChecked()
  await phone.fill('+34600000000')
  await expect(consent).not.toBeChecked()
  await expect(joinButton).toBeDisabled()
  await consent.check()
  await expect(consent).toBeChecked()
  await expect(joinButton).toBeEnabled()
}

test('customer joins from the venue, recovers, edits, yields and cancels against the real API', async ({
  page,
  request,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90000)
  const t = await setup(page, request, baseURL!)
  const guest = await newClientContext(browser, info, 'customer-guest', {
    baseURL: baseURL!,
    viewport: { width: 390, height: 844 },
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
            whatsapp: {
              consent: true,
              phone: '+34600000000',
              version: 'whatsapp-public-service-updates-v1',
            },
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
    await assertWhatsAppConsentGate(client)
    await client.getByRole('button', { name: 'Ponerme en lista' }).click()
    await expect(client).toHaveURL(/\/t\//)
    await expect(client.getByText('4 turnos')).toBeVisible()
    const recoveryUrl = client.url()
    await client.reload()
    await expect(client.getByText('4 turnos')).toBeVisible()
    await client.getByRole('button', { name: 'Modificar', exact: true }).click()
    await client
      .getByRole('button', { name: 'Modificar número de comensales' })
      .click()
    await client.getByRole('button', { name: 'Más comensales' }).click()
    await client.getByRole('button', { name: 'Continuar', exact: true }).click()
    await client.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await expect(client.getByRole('dialog')).not.toBeVisible()
    await expect(client.getByText('4 turnos')).toBeVisible()
    const token = new URL(recoveryUrl).pathname.split('/').at(-1)!
    let snapshot = (await (
      await guest.request.get(`/api/v1/public/entries/${token}`)
    ).json()) as Entry
    expect(snapshot.customer).toMatchObject({
      displayName: 'María Cliente',
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
          whatsapp: {
            consent: true,
            phone: '+34600000000',
            version: 'whatsapp-public-service-updates-v1',
          },
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
    await client
      .getByRole('button', { name: 'Sí, abandonar la lista de espera' })
      .click()
    await expect(
      client.getByText('Ya no estás en la lista de espera'),
    ).toBeVisible()
    snapshot = (await (
      await guest.request.get(`/api/v1/public/entries/${token}`)
    ).json()) as Entry
    expect(snapshot.status).toBe('cancelled')
    await client
      .getByRole('link', { name: 'Seleccionar lista de espera' })
      .click()
    await expect(client).toHaveURL(new RegExp(`/v/${t.venueId}`))
    await selectCustomerLanguage(client, 'en')
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
}, info) => {
  const t = await setup(page, request, baseURL!)
  const guest = await newClientContext(browser, info, 'response-loss-guest', {
    baseURL: baseURL!,
    // Intercept transport only; both POST attempts execute against the real server.
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
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
    await client
      .getByRole('button', { name: 'Sí, abandonar la lista de espera' })
      .click()
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
    await client
      .getByRole('button', { name: 'Sí, abandonar la lista de espera' })
      .click()
    await expect(client.getByRole('dialog')).not.toBeVisible()
    await expect(
      client.getByText('Ya no estás en la lista de espera'),
    ).toBeVisible()
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
  canJoin: true,
  serviceOpen: true,
  queueState: 'active',
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
    test.setTimeout(60000)
    await page.setViewportSize({ width: 390, height: 844 })
    const token = 'a'.repeat(64)
    let phase: NonNullable<Entry['customer']>['phase'] = 'waiting'
    let offline = false
    const mocks = await strictApiMocks(page, [
      {
        method: 'GET',
        path: '/api/v1/public/services/restaurant',
        expectedHits: { min: 1 },
        respond: () => ({ json: service }),
      },
      {
        method: 'GET',
        path: '/api/v1/public/venues/venue/services',
        expectedHits: { min: 1 },
        respond: () => ({
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
      },
      {
        method: 'GET',
        path: `/api/v1/public/entries/${token}`,
        expectedHits: { min: 1 },
        respond: () =>
          offline
            ? { json: null, abort: true }
            : {
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
                actions:
                  phase === 'waiting' || phase === 'approaching'
                    ? ['update', 'cancel', 'yield']
                    : [],
              },
                },
              },
      },
    ])
    const capture = async (name: string) => {
      await page.mouse.move(0, 0)
      await page.evaluate(async () => {
        await document.fonts.ready
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
    await page.getByRole('radio', { name: 'Terraza' }).click()
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
      if (phase === 'waiting') {
        const modify = page.getByRole('button', {
          name: 'Modificar',
          exact: true,
        })
        await modify.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await capture('modify-menu')
        await page
          .getByRole('button', { name: 'Modificar número de comensales' })
          .click()
        await expect(
          page.getByRole('button', { name: 'Continuar', exact: true }),
        ).toBeDisabled()
        await capture('guest-zero')
        await page.getByRole('button', { name: 'Más comensales' }).click()
        await page.getByRole('button', { name: 'Más comensales' }).click()
        await capture('guest-add')
        await page
          .getByRole('button', { name: 'Continuar', exact: true })
          .click()
        await capture('guest-confirm')
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(modify).toBeFocused()
        await modify.click()
        await page.getByRole('button', { name: 'Modificar sala' }).click()
        await capture('room')
        await page.getByRole('button', { name: 'Anular' }).click()
        await expect(modify).toBeFocused()
        await page
          .getByRole('button', { name: 'Abandonar la lista', exact: true })
          .click()
        await capture('abandon-sheet')
        await page.keyboard.press('Escape')
        await expect(
          page.getByRole('button', { name: 'Abandonar la lista', exact: true }),
        ).toBeFocused()
      }
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
    await page.setViewportSize({ width: 1280, height: 900 })
    await capture('cancelled-desktop')
    phase = 'waiting'
    await page.goto(`/t/${token}`)
    await page.getByRole('button', { name: 'Modificar', exact: true }).click()
    await capture('modify-menu-desktop')
    await page
      .getByRole('button', { name: 'Modificar número de comensales' })
      .click()
    await capture('guest-zero-desktop')
    await page.getByRole('button', { name: 'Más comensales' }).click()
    await page.getByRole('button', { name: 'Más comensales' }).click()
    await capture('guest-add-desktop')
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await capture('guest-confirm-desktop')
    await page.keyboard.press('Escape')
    await page
      .getByRole('button', { name: 'Abandonar la lista', exact: true })
      .click()
    await capture('abandon-sheet-desktop')
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab')
      await expect(page.getByRole('dialog')).toContainText(
        '¿Quieres continuar?',
      )
      await expect
        .poll(
          async () =>
            await page
              .getByRole('dialog')
              .evaluate((dialog) => dialog.contains(document.activeElement)),
        )
        .toBe(true)
    }
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    phase = 'waiting'
    await page.goto(`/t/${token}`)
    await expect(page.getByText('5 turnos')).toBeVisible()
    offline = true
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('5 turnos')).toBeVisible()
    offline = false
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await mocks.assertComplete()
  })
  test('yield confirmation keeps the server position and phase with responsive feedback', async ({
    page,
  }, info) => {
    test.setTimeout(60000)
    const token = 'b'.repeat(64)
    let yielded = false
    let phase: 'waiting' | 'approaching' | 'called' = 'approaching'
    const mocks = await strictApiMocks(page, [
      {
        method: 'GET',
        path: `/api/v1/public/entries/${token}`,
        expectedHits: { min: 1 },
        respond: () => ({
          json: {
          code: 'XP03',
          position: yielded ? 7 : 3,
          etaMinutes: yielded ? 35 : 10,
          estimateQuality: 'estimated',
          status: phase === 'called' ? 'called' : 'waiting',
          notification: 'disabled',
          customer: {
            service,
            displayName: 'María López',
            partySize: 4,
            preferredSpaceId: 'terrace',
            locale: 'es',
            version: yielded ? 1 : 0,
            serverNow: Date.now(),
            createdAt: Date.now(),
            calledAt: phase === 'called' ? Date.now() : null,
            arrivalDeadlineAt: phase === 'called' ? Date.now() + 300000 : null,
            arrivedAt: null,
            phase,
            actions: phase === 'called' ? [] : ['update', 'cancel', 'yield'],
          },
          },
        }),
      },
      {
        method: 'POST',
        path: `/api/v1/public/entries/${token}/commands`,
        expectedHits: { min: 2, max: 2 },
        respond: (request) => {
          expect(request.postDataJSON()).toEqual({
            action: 'yield',
            version: 0,
          })
          yielded = true
          phase = 'waiting'
          return { json: { ok: true } }
        },
      },
    ])
    const capture = async (name: string) => {
      await page.mouse.move(0, 0)
      await page.evaluate(async () => {
        await document.fonts.ready
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
    for (const width of [390, 1280]) {
      yielded = false
      phase = 'approaching'
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto(`/t/${token}`)
      await page
        .getByRole('button', { name: 'Pasar turno', exact: true })
        .click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await capture(`yield-sheet-${width}`)
      await page.getByRole('button', { name: 'Sí, pasar turno' }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible()
      await expect(page.getByText('6 turnos')).toBeVisible()
      await capture(`yield-confirmed-${width}`)
      await expect(page.getByText('Has pasado turno')).toBeVisible()
      const notice = await page
        .getByRole('status')
        .filter({ hasText: 'Has pasado turno' })
        .boundingBox()
      const footer = await page.locator('footer').boundingBox()
      expect(notice!.y + notice!.height).toBeLessThanOrEqual(footer!.y)
      await expect(page).toHaveURL(new RegExp(`/t/${token}$`))
      await page.reload()
      await expect(page.getByText('6 turnos')).toBeVisible()
      await expect(page.getByText('Has pasado turno')).toHaveCount(0)
    }
    await mocks.assertComplete()
  })

  test('shows both server-projected actions while called and keeps web cancellation confirmed', async ({
    page,
  }) => {
    const token = 'c'.repeat(64)
    let cancelled = false
    const version = 4
    const mocks = await strictApiMocks(page, [
      {
        method: 'GET',
        path: `/api/v1/public/entries/${token}`,
        expectedHits: { min: 2 },
        respond: () => ({
          json: {
            code: 'XP03',
            position: 1,
            etaMinutes: 0,
            estimateQuality: 'estimated',
            status: cancelled ? 'cancelled' : 'called',
            notification: 'disabled',
            customer: {
              service,
              displayName: 'María López',
              partySize: 4,
              preferredSpaceId: 'terrace',
              locale: 'es',
              version: cancelled ? version + 1 : version,
              serverNow: Date.now(),
              createdAt: Date.now(),
              calledAt: Date.now(),
              arrivalDeadlineAt: cancelled ? null : Date.now() + 300000,
              arrivedAt: null,
              phase: cancelled ? 'cancelled' : 'called',
              actions: cancelled ? [] : ['cancel', 'yield'],
            },
          },
        }),
      },
      {
        method: 'POST',
        path: `/api/v1/public/entries/${token}/commands`,
        expectedHits: { min: 1, max: 1 },
        respond: (request) => {
          expect(request.postDataJSON()).toEqual({
            action: 'cancel',
            version,
          })
          cancelled = true
          return { json: { ok: true } }
        },
      },
    ])

    await page.goto(`/t/${token}`)
    await expect(
      page.getByRole('button', { name: 'Pasar turno', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Abandonar la lista', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Abandonar la lista', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page
      .getByRole('button', { name: 'Sí, abandonar la lista de espera' })
      .click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Ya no estás en la lista de espera' }),
    ).toBeVisible()
    await mocks.assertComplete()
  })
})

for (const type of ['reception', 'pool'] as const) {
  test(`${type} public form, recovery, yield and cancellation against the real API`, async ({
    page,
    request,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(90000)
    const t = await setup(page, request, baseURL!)
    const config = {
      name: type === 'reception' ? 'Recepción' : 'Bar piscina',
      type,
      capacity: 99,
      averageMinutes: 30,
      graceMinutes: 5,
      cutoffMinutes: 0,
      twentyFourHours: true,
      schedules: [],
      receptionServices:
        type === 'reception' ? ['check_in', 'check_out', 'other'] : [],
      spaces: [],
      approachTurns: 0,
      approachMinutes: 0,
    }
    const created = await page.request.post(
      `/api/v1/staff/venues/${t.venueId}/queues`,
      {
        headers: { ...t.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: config,
      },
    )
    expect(created.ok(), await created.text()).toBeTruthy()
    const { id } = (await created.json()) as { id: string }
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/v1/staff/queues/${id}/opening-context`,
        )
        if (!response.ok()) return false
        const state = (await response.json()) as {
          open: boolean
          queueState: string
        }
        return state.open && state.queueState === 'active'
      })
      .toBe(true)
    const guest = await newClientContext(browser, testInfo, 'service-guest', {
      baseURL: baseURL!,
      viewport: { width: 390, height: 844 },
    })
    try {
      const client = await guest.newPage()
      await client.goto(`/q/${id}`)
      await client.getByLabel('Nombre', { exact: true }).fill('Daniel')
      await expect(
        client.getByRole('button', { name: 'Más comensales' }),
      ).toHaveCount(0)
      if (type === 'reception') {
        await expect(
          client.getByRole('radio', { name: 'Check-in', exact: true }),
        ).toBeChecked()
        await client.getByRole('radio', { name: 'Otros temas' }).click()
        await client
          .getByRole('radio', { name: 'Check-in', exact: true })
          .click()
      } else await expect(client.getByRole('radio')).toHaveCount(0)
      await assertWhatsAppConsentGate(client)
      await client.getByRole('heading', { name: 'Introduce tus datos' }).click()
      for (const width of [390, 1280]) {
        await client.setViewportSize({ width, height: 844 })
        await client.screenshot({
          path: `/tmp/noqueue-${type}-${width}-${testInfo.project.name}.png`,
          fullPage: true,
          animations: 'disabled',
        })
        expect(
          await client.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy()
      }
      await selectCustomerLanguage(client, 'en')
      await expect(
        client.getByRole('heading', { name: 'Enter your details' }),
      ).toBeVisible()
      await selectCustomerLanguage(client, 'es')
      await client.getByRole('button', { name: 'Ponerme en lista' }).click()
      await expect(client).toHaveURL(/\/t\//)
      await client.reload()
      await expect(
        client.getByRole('button', { name: 'Modificar', exact: true }),
      ).toHaveCount(0)
      await expect(
        client.getByRole('button', { name: 'Pasar turno', exact: true }),
      ).toHaveCount(1)
      const token = new URL(client.url()).pathname.split('/').at(-1)!
      const joined = await (
        await guest.request.get(`/api/v1/public/entries/${token}`)
      ).json()
      expect(joined.customer).toMatchObject({
        partySize: 1,
        preferredSpaceId: null,
        actions: ['cancel', 'yield'],
      })
      const successor = await guest.request.post(
        `/api/v1/public/services/${id}/entries`,
        {
          headers: { Origin: baseURL!, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            displayName: 'Next guest',
            partySize: 1,
            locale: 'es',
            whatsapp: {
              consent: true,
              phone: '+34600000000',
              version: 'whatsapp-public-service-updates-v1',
            },
            ...(type === 'reception' ? { receptionService: 'check_out' } : {}),
          },
        },
      )
      expect(successor.ok(), await successor.text()).toBeTruthy()
      await client
        .getByRole('button', { name: 'Pasar turno', exact: true })
        .click()
      await client
        .getByRole('button', { name: 'Sí, pasar turno', exact: true })
        .click()
      await expect(
        client.getByText('Has pasado turno', { exact: true }),
      ).toBeVisible()
      await client
        .getByRole('button', { name: 'Abandonar la lista', exact: true })
        .click()
      await client
        .getByRole('button', { name: 'Sí, abandonar la lista de espera' })
        .click()
      await expect(
        client.getByRole('heading', {
          name: 'Ya no estás en la lista de espera',
        }),
      ).toBeVisible()
    } finally {
      await guest.close()
    }
  })
}
