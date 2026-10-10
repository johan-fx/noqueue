import { setup, join, act, prove, pilot } from '../helpers/queue-actions.js'
import { queueOrder } from '../helpers/queue-order.js'
import {
  test as base,
  expect,
  type Page,
  type TestInfo,
  type APIRequestContext,
  newClientContext,
} from '../fixtures.js'
type Step = {
  scenarioId: string
  step: string
  actual: unknown
  expected: unknown
  simulatedAt: number
}
type Projection = { etaMinutes: number; predictedAt: number }
function observeProjection(page: Page) {
  let latest: Projection | undefined
  page.on('response', async (response) => {
    if (
      response.request().method() === 'GET' &&
      /\/api\/v1\/public\/entries\/[a-f0-9]{64}$/.test(
        new URL(response.url()).pathname,
      ) &&
      response.ok()
    )
      latest = (await response.json()) as Projection
  })
  return () => latest
}
async function expectProjectedCountdown(
  page: Page,
  projection: () => Projection | undefined,
  expectedMinutes: number,
) {
  // The UI ticks once per second and floors seconds; allow only those two seconds.
  await expect
    .poll(async () => {
      const entry = projection()
      if (
        entry?.etaMinutes !== expectedMinutes ||
        !Number.isFinite(entry.predictedAt)
      )
        return Infinity
      const sample = await page.getByRole('progressbar').evaluate((element) => ({
        label: element.getAttribute('aria-label'),
        now: Date.now(),
      }))
      const countdown =
        /^Espera aproximada: (\d+):(\d{2}) \(minutos:segundos\)$/.exec(
          sample.label ?? '',
        )
      if (!countdown || Number(countdown[2]) >= 60) return Infinity
      const remainingMs =
        (Number(countdown[1]) * 60 + Number(countdown[2])) * 1000
      return Math.abs(remainingMs - Math.max(0, entry.predictedAt - sample.now))
    })
    .toBeLessThanOrEqual(2000)
  return projection()!
}
const test = base.extend<{ evidence: Step[] }>({
  evidence: async ({}, use, info) => {
    const steps: Step[] = []
    await use(steps)
    await info.attach('queue-evidence', {
      body: Buffer.from(JSON.stringify(steps)),
      contentType: 'application/json',
    })
  },
})
// Includes several independent polling intervals and context teardown; no retries.
test.setTimeout(90_000)
test('Q-BROWSER-ORDER public joins and quick assignment update staff and two isolated clients', async ({
  page,
  request,
  browser,
  baseURL,
  evidence,
}, info) => {
  await queueOrder({
    page,
    request,
    browser,
    baseURL: baseURL!,
    evidence,
    info,
  })
})
test('Q-BROWSER-RESOURCE reservation arrival and explicit release preserve physical capacity', async ({
  page,
  request,
  browser,
  baseURL,
  evidence,
}, info) => {
  const t = await setup(page, request, baseURL!),
    guest = await newClientContext(browser, info, 'order-alice', {
      baseURL: baseURL!,
    })
  try {
    const alice = await guest.newPage()
    await join(alice, t.queue, 'Alice')
    await act(page, 'Alice', 'Asignar turno')
    await expect(alice.getByText(/Es tu turno/)).toBeVisible()
    await act(page, 'Alice', 'Confirmar llegada')
    await expect(
      alice.getByText('Se ha confirmado tu llegada', { exact: true }),
    ).toBeVisible()
    const second = await newClientContext(browser, info, 'order-bob', {
      baseURL: baseURL!,
    })
    try {
      const bob = await second.newPage()
      await join(bob, t.queue, 'Bob')
      const list = (await (
        await page.request.get(`/api/v1/staff/queues/${t.queue}/entries`)
      ).json()) as { id: string; displayName: string; version: number }[]
      const row = list.find((e) => e.displayName === 'Bob')!
      const refused = await page.request.post(
        `/api/v1/staff/queues/${t.queue}/commands`,
        {
          headers: { ...t.headers, 'Idempotency-Key': crypto.randomUUID() },
          data: { entryId: row.id, version: row.version, action: 'call' },
        },
      )
      await prove(
        info,
        evidence,
        'Q-BROWSER-RESOURCE',
        'occupied resource rejects another call',
        refused.status(),
        409,
      )
      await page.getByRole('tab', { name: 'Completados' }).click()
      await act(page, 'Alice', 'Liberar recurso')
      await expect(
        alice.getByText('Se ha confirmado tu llegada', { exact: true }),
      ).toBeVisible()
      await page.getByRole('tab', { name: 'Lista', exact: true }).click()
      await act(page, 'Bob', 'Asignar turno')
      await expect(bob.getByText(/Es tu turno/)).toBeVisible()
      await prove(
        info,
        evidence,
        'Q-BROWSER-RESOURCE',
        'release allows the next real call',
        true,
        true,
      )
    } finally {
      await second.close()
    }
  } finally {
    await guest.close()
  }
})
test('Q-BROWSER-CLOSE closing rejects new joins without cancelling an existing turn', async ({
  page,
  request,
  browser,
  baseURL,
  evidence,
}, info) => {
  const t = await setup(page, request, baseURL!),
    guest = await newClientContext(browser, info, 'resource-alice', {
      baseURL: baseURL!,
    })
  try {
    const alice = await guest.newPage()
    await join(alice, t.queue, 'Alice')
    await page.getByRole('button', { name: 'Volver', exact: true }).click()
    await page
      .getByRole('switch', { name: 'Cerrar lista', exact: true })
      .click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cerrar lista', exact: true })
      .click()
    const form = await guest.newPage()
    await form.goto(`/q/${t.queue}`)
    await expect(
      form.getByText('Lista pausada', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      form.getByRole('button', { name: 'Ponerme en lista' }),
    ).toBeDisabled()
    await expect(
      alice.getByText('Ya casi es tu turno', { exact: true }),
    ).toBeVisible()
    const rejected = await form.request.post(
      `/api/v1/public/services/${t.queue}/entries`,
      {
        headers: { ...t.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          displayName: 'Closed',
          partySize: 4,
          locale: 'es',
          whatsapp: {
            consent: true,
            phone: '+34600000000',
            version: 'whatsapp-public-service-updates-v1',
          },
        },
      },
    )
    expect(rejected.ok()).toBe(false)
    await prove(
      info,
      evidence,
      'Q-BROWSER-CLOSE',
      'new admission rejected; existing turn remains waiting',
      rejected.status(),
      409,
    )
  } finally {
    await guest.close()
  }
})
for (const kind of ['MEAN', 'LEARNING'] as const)
  test(`Q-BROWSER-${kind} recalculated group ETA reaches staff and customer`, async ({
    page,
    request,
    browser,
    baseURL,
    evidence,
  }, info) => {
    const t = await setup(page, request, baseURL!),
      guest = await newClientContext(browser, info, `${kind.toLowerCase()}-client`, {
        baseURL: baseURL!,
      })
    try {
      const first = await guest.newPage(),
        second = await guest.newPage()
      const projection = observeProjection(second)
      await join(first, t.queue, 'First')
      await join(second, t.queue, 'Second')
      const initialProjection = await expectProjectedCountdown(second, projection, 50)
      const expected = kind === 'MEAN' ? 35 : 54
      if (kind === 'MEAN') {
        const queues = (await (
          await page.request.get(`/api/v1/staff/venues/${t.venueId}/queues`)
        ).json()) as {
          id: string
          version: number
          open: boolean
          config: Record<string, unknown>
        }[]
        const q = queues.find((q) => q.id === t.queue)!
        const response = await page.request.patch(
          `/api/v1/staff/queues/${t.queue}`,
          {
            headers: t.headers,
            data: {
              ...q.config,
              open: true,
              version: q.version,
              spaces: [
                {
                  id: 'terrace',
                  name: 'Terrace',
                  tables: 1,
                  tableTypes: [{ seats: 4, count: 1, averageMinutes: 35 }],
                },
              ],
            },
          },
        )
        expect(response.ok(), await response.text()).toBeTruthy()
      } else {
        const data = {
          queueId: t.queue,
          spaceId: 'terrace',
          seats: 4,
          durations: [60, 60, 60],
        }
        expect(
          (
            await request.post(
              '/api/v1/experiments/local/staff/queue-history',
              { data },
            )
          ).status(),
        ).toBe(401)
        expect(
          (
            await request.post(
              '/api/v1/experiments/local/staff/queue-history',
              {
                headers: pilot,
                data: { ...data, durations: Array(32).fill(60) },
              },
            )
          ).status(),
        ).toBe(400)
        const loaded = await request.post(
          '/api/v1/experiments/local/staff/queue-history',
          { headers: pilot, data },
        )
        expect(loaded.ok(), await loaded.text()).toBeTruthy()
      }
      const updatedProjection = await expectProjectedCountdown(second, projection, expected)
      expect(updatedProjection.predictedAt).not.toBe(initialProjection.predictedAt)
      const row = page
        .getByRole('dialog', { name: 'Gestionar lista', exact: true })
        .locator('li')
        .filter({ hasText: 'Second' })
      await expect(
        row.getByText(`${expected} min`, { exact: true }),
      ).toBeVisible()
      await prove(
        info,
        evidence,
        `Q-BROWSER-${kind}`,
        'terrace/4 expected ETA and timestamp countdown rendered by both clients',
        updatedProjection.etaMinutes,
        expected,
      )
      await second.screenshot({
        path: info.outputPath('customer-estimate.png'),
      })
    } finally {
      await guest.close()
    }
  })

test('Q-BROWSER-PROGRESS one baseline reflects numeric ETA, delay, call deadline and arrival', async ({
  page,
  evidence,
}, info) => {
  const token = 'a'.repeat(64)
  const now = 1_800_000_000_000
  await page.clock.install({ time: now })
  const snapshot = {
    code: 'PROGRESS',
    position: 6,
    etaMinutes: 50,
    estimateQuality: 'estimated',
    initialEtaMinutes: 50,
    status: 'waiting',
    notification: 'disabled',
    customer: {
      service: {
        id: 'progress',
        name: 'Restaurant',
        venueName: 'Hotel',
        open: 1,
        type: 'restaurant',
        receptionServices: [],
        spaces: [],
      },
      displayName: 'Guest',
      partySize: 4,
      preferredSpaceId: null,
      locale: 'en',
      version: 0,
      serverNow: now,
      createdAt: now,
      calledAt: null as number | null,
      arrivalDeadlineAt: null as number | null,
      arrivedAt: null as number | null,
      phase: 'waiting',
      actions: ['cancel', 'yield'],
    },
  }
  await page.route(`**/api/v1/public/entries/${token}`, (route) =>
    route.fulfill({ json: snapshot }),
  )
  await page.goto(`/t/${token}?lang=en`)
  const ring = page.getByRole('progressbar')
  const arc = ring.locator('circle[stroke="currentColor"]')
  const checkProgress = async (
    percentage: number,
    label: string,
    color: string,
  ) => {
    await expect(ring).toHaveAttribute('aria-valuenow', String(percentage))
    await expect(ring).toContainText(label)
    await expect(ring).toHaveClass(new RegExp(color))
    if (percentage === 0) await expect(arc).toHaveCount(0)
    else if (percentage === 100)
      expect(await arc.getAttribute('stroke-dasharray')).toBeNull()
    else {
      const dash = (await arc.getAttribute('stroke-dasharray'))!
        .split(' ')
        .map(Number)
      expect(dash[0]! / dash[1]!).toBeCloseTo(percentage / 100)
    }
    await prove(
      info,
      evidence,
      'Q-BROWSER-PROGRESS',
      `${label}: temporal arc and numeric label`,
      Number(await ring.getAttribute('aria-valuenow')),
      percentage,
    )
  }
  await checkProgress(0, '50', 'text-gray-700')
  // Waiting changes only when the next backend poll delivers a different estimate.
  await page.clock.runFor(2000)
  await checkProgress(0, '50', 'text-gray-700')
  for (const [remaining, percentage] of [
    [25, 50],
    [40, 20],
    [10, 80],
  ]) {
    snapshot.etaMinutes = remaining!
    snapshot.customer.phase = remaining === 10 ? 'approaching' : 'waiting'
    snapshot.customer.serverNow =
      now + (await page.evaluate(() => Date.now())) - now
    await page.clock.runFor(5000)
    await checkProgress(
      percentage!,
      String(remaining),
      remaining === 10 ? 'text-orange-500' : 'text-gray-700',
    )
  }
  snapshot.customer.phase = 'called'
  snapshot.status = 'called'
  snapshot.estimateQuality = 'unknown'
  snapshot.customer.calledAt = now
  snapshot.customer.arrivalDeadlineAt = now + 5 * 60000
  snapshot.customer.serverNow = now
  await page.reload()
  await checkProgress(90, '5:00', 'text-red-700')
  await page.clock.runFor(1000)
  await expect(ring).toContainText('4:59')
  // Server-time snapshots remain authoritative after refresh/reload.
  snapshot.customer.serverNow = now + 3 * 60000
  await page.reload()
  await checkProgress(96, '2:00', 'text-red-700')
  snapshot.customer.serverNow = now + 5 * 60000
  await page.reload()
  await checkProgress(100, '0:00', 'text-red-700')
  await expect(
    page.getByRole('heading', { name: 'It is your turn!' }),
  ).toBeVisible()
  snapshot.customer.phase = 'arrived'
  snapshot.status = 'completed'
  await page.reload()
  await checkProgress(100, 'Arrival confirmed', 'text-green-600')
})
