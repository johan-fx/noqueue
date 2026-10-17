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
  expectedMinutes?: number,
) {
  // The UI ticks once per second and floors seconds; allow only those two seconds.
  await expect
    .poll(async () => {
      const entry = projection()
      if (
        !entry ||
        (expectedMinutes !== undefined && entry.etaMinutes !== expectedMinutes) ||
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
test('Q-BROWSER-RESOURCE assignment and arrival do not depend on physical table inventory', async ({
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
    await expect(alice.getByRole('heading', { name: '¡Es tu turno!', exact: true })).toBeVisible()
    const second = await newClientContext(browser, info, 'order-bob', {
      baseURL: baseURL!,
    })
    try {
      const bob = await second.newPage()
      await join(bob, t.queue, 'Bob')
      await act(page, 'Bob', 'Asignar turno')
      await expect(bob.getByRole('heading', { name: '¡Es tu turno!', exact: true })).toBeVisible()
      const list = (await (
        await page.request.get(`/api/v1/staff/queues/${t.queue}/entries`)
      ).json()) as { displayName: string; status: string }[]
      await prove(
        info,
        evidence,
        'Q-BROWSER-RESOURCE',
        'two independent queue turns can be assigned without a capacity release',
        list.filter((entry) => entry.status === 'called').length,
        2,
      )
      await act(page, 'Alice', 'Confirmar llegada')
      await expect(
        alice.getByText('Se ha confirmado tu llegada', { exact: true }),
      ).toBeVisible()
      const finalList = (await (
        await page.request.get(`/api/v1/staff/queues/${t.queue}/entries`)
      ).json()) as { displayName: string; status: string }[]
      await prove(
        info,
        evidence,
        'Q-BROWSER-RESOURCE',
        'arrival confirmation finalizes the turn without a later release command',
        finalList.find((entry) => entry.displayName === 'Alice')?.status,
        'completed',
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
      form.getByText('No se admiten inscripciones en este momento.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      form.getByRole('button', { name: 'Ponerme en lista' }),
    ).toBeDisabled()
    const closedService = await form.request.get(`/api/v1/public/services/${t.queue}`)
    expect(closedService.ok()).toBe(true)
    expect(await closedService.json()).toMatchObject({ queueState: 'paused', canJoin: false })
    await expect(
      alice.getByRole('heading', {
        name: 'Estás en la lista de espera de Queue Verification',
        exact: true,
      }),
    ).toBeVisible()
    const token = new URL(alice.url()).pathname.split('/').at(-1)!
    const retained = await alice.request.get(`/api/v1/public/entries/${token}`)
    expect(await retained.json()).toMatchObject({
      status: 'waiting',
      etaMinutes: 50,
      customer: { phase: 'waiting' },
    })
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
  test(
    `Q-BROWSER-${kind} ${
      kind === 'MEAN'
        ? 'configuration updates the shared customer and staff ETA'
        : 'contextual learning updates the customer and staff ETA'
    }`,
    async ({
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
      await join(first, t.queue, 'First', 4, 'Terrace')
      await join(second, t.queue, 'Second', 4, 'Terrace')
      // Customer configured work includes both parties; staff uses real scheduling.
      const initialProjection = await expectProjectedCountdown(second, projection, 100)
      const expectedCustomer = kind === 'MEAN' ? 70 : 100
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
          intervals: [60, 60, 60],
        }
        expect(
          (
            await request.post(
              '/api/v1/experiments/local/staff/assignment-history',
              { data },
            )
          ).status(),
        ).toBe(401)
        expect(
          (
            await request.post(
              '/api/v1/experiments/local/staff/assignment-history',
              {
                headers: pilot,
                data: { ...data, intervals: Array(31).fill(60) },
              },
            )
          ).status(),
        ).toBe(400)
        const loaded = await request.post(
          '/api/v1/experiments/local/staff/assignment-history',
          { headers: pilot, data },
        )
        expect(loaded.ok(), await loaded.text()).toBeTruthy()
        const learned = (await loaded.json()) as {
          inserted: number
          serviceFactor: number
          contextFactor: number
        }
        expect(learned).toMatchObject({ inserted: 3 })
        expect(learned.serviceFactor).toBeGreaterThan(1)
        expect(learned.contextFactor).toBeGreaterThan(1)
      }
      const row = page
        .getByRole('dialog', { name: 'Gestionar lista', exact: true })
        .locator('li')
        .filter({ hasText: 'Second' })
      if (kind === 'LEARNING')
        await expect
          .poll(() => projection()?.predictedAt)
          .not.toBe(initialProjection.predictedAt)
      const updatedProjection = await expectProjectedCountdown(
        second,
        projection,
        kind === 'MEAN' ? expectedCustomer : undefined,
      )
      if (kind === 'MEAN')
        expect(updatedProjection.predictedAt).not.toBe(initialProjection.predictedAt)
      else {
        expect(updatedProjection.predictedAt).toBeGreaterThan(
          initialProjection.predictedAt,
        )
        expect(updatedProjection.etaMinutes).toBeGreaterThan(
          initialProjection.etaMinutes,
        )
      }
      const staffEtaMinutes = async () => {
        const timer = /\b(\d+):([0-5]\d)\b/.exec(await row.innerText())
        return timer
          ? Math.ceil((Number(timer[1]) * 60 + Number(timer[2])) / 60)
          : -1
      }
      await expect.poll(staffEtaMinutes).toBe(updatedProjection.etaMinutes)
      const staffEta = await staffEtaMinutes()
      await prove(
        info,
        evidence,
        `Q-BROWSER-${kind}`,
        'contextual estimate is shared by the customer countdown and staff row',
        { customer: updatedProjection.etaMinutes, staff: staffEta },
        {
          customer: updatedProjection.etaMinutes,
          staff: updatedProjection.etaMinutes,
        },
      )
      await second.screenshot({
        path: info.outputPath('customer-estimate.png'),
      })
      } finally {
        await guest.close()
      }
    },
  )

test('Q-BROWSER-COUNTDOWN polls and returning to the tab never restart the customer deadline', async ({
  page,
  request,
  browser,
  baseURL,
  evidence,
}, info) => {
  const t = await setup(page, request, baseURL!)
  const queues = (await (
    await page.request.get(`/api/v1/staff/venues/${t.venueId}/queues`)
  ).json()) as { id: string; version: number; config: Record<string, unknown> }[]
  const queue = queues.find((item) => item.id === t.queue)!
  const configured = await page.request.patch(`/api/v1/staff/queues/${t.queue}`, {
    headers: t.headers,
    data: {
      ...queue.config,
      open: true,
      version: queue.version,
      averageMinutes: 4,
      spaces: [{
        id: 'terrace', name: 'Terrace', tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 4 }],
      }],
    },
  })
  expect(configured.ok(), await configured.text()).toBeTruthy()
  const guest = await newClientContext(browser, info, 'countdown', { baseURL: baseURL! })
  const customer = await guest.newPage()
  try {
    const first = await guest.newPage()
    await join(first, t.queue, 'First')
    await join(customer, t.queue, 'Second')
    const token = new URL(customer.url()).pathname.split('/').at(-1)!
    const entryPath = `/api/v1/public/entries/${token}`
    type Snapshot = Projection & { customer: { serverNow: number } }
    const responses: Snapshot[] = []
    customer.on('response', async (response) => {
      if (response.request().method() === 'GET' &&
          new URL(response.url()).pathname === entryPath && response.ok())
        responses.push(await response.json() as Snapshot)
    })
    // Observe the mounted page's next real poll. Reloading here can invalidate
    // the registration GET before its response body has been read. Every snapshot
    // is the application's own fetch from isolated Worker/D1, never fulfilled JSON.
    await expect.poll(() => responses.length).toBeGreaterThanOrEqual(1)
    const initial = responses[0]!
    expect(initial.etaMinutes).toBe(8)
    expect(initial.predictedAt - initial.customer.serverNow).toBeGreaterThan(7 * 60000)
    expect(initial.predictedAt - initial.customer.serverNow).toBeLessThanOrEqual(8 * 60000)
    const countdown = customer.getByRole('progressbar')
    const seconds = async () => {
      const label = await countdown.getAttribute('aria-label')
      const match = /^Espera aproximada: (\d+):(\d{2}) \(minutos:segundos\)$/.exec(label ?? '')
      expect(match, label ?? 'Missing countdown').not.toBeNull()
      return Number(match![1]) * 60 + Number(match![2])
    }
    await expect(countdown).toBeVisible()
    // Capture every displayed tick, including a brief upward jump between polls.
    await countdown.evaluate((element) => {
      const samples: number[] = []
      const record = () => {
        const match = /^Espera aproximada: (\d+):(\d{2})/.exec(element.getAttribute('aria-label') ?? '')
        if (match) samples.push(Number(match[1]) * 60 + Number(match[2]))
        element.setAttribute('data-countdown-samples', JSON.stringify(samples))
      }
      record()
      new MutationObserver(record).observe(element, {
        attributes: true, attributeFilter: ['aria-label'],
      })
    })
    let previousSeconds = await seconds()
    let previousServerNow = initial.customer.serverNow
    for (let poll = 1; poll <= 3; poll++) {
      // Ignore incidental focus responses: each observation must cross the
      // five-second production polling interval, with 500 ms scheduling tolerance.
      const nextTimedSnapshot = () => responses.find((snapshot) =>
        snapshot.customer.serverNow >= previousServerNow + 4500)
      await expect.poll(nextTimedSnapshot, { timeout: 10_000 }).toBeDefined()
      const snapshot = nextTimedSnapshot()!
      expect(snapshot.customer.serverNow).toBeGreaterThan(previousServerNow)
      expect(snapshot.predictedAt).toBe(initial.predictedAt)
      await expect.poll(seconds).toBeLessThan(previousSeconds)
      previousSeconds = await seconds()
      previousServerNow = snapshot.customer.serverNow
    }
    const beforeHidden = { seconds: previousSeconds, now: Date.now(), responses: responses.length }
    // Headless engines do not consistently hide pages via bringToFront(). Drive
    // the Page Visibility API events explicitly, retaining real server/browser
    // clocks and the production visibilitychange/focus listeners (no time mocks).
    await customer.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // Cross a complete polling interval while hidden: no background GET allowed.
    await expect.poll(() => Date.now() - beforeHidden.now, { timeout: 9000 }).toBeGreaterThanOrEqual(6000)
    expect(responses).toHaveLength(beforeHidden.responses)
    const returned = customer.waitForResponse((response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === entryPath && response.ok(),
    { timeout: 4000 })
    await customer.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    const resumed = await (await returned).json() as Snapshot
    expect(resumed.customer.serverNow).toBeGreaterThan(previousServerNow)
    expect(resumed.predictedAt).toBe(initial.predictedAt)
    await expect.poll(seconds).toBeLessThanOrEqual(beforeHidden.seconds - 5)
    const resumedSeconds = await seconds()
    // Returning must restart polling, not only issue one focus refresh.
    await expect.poll(() => responses.some((snapshot) =>
      snapshot.customer.serverNow >= resumed.customer.serverNow + 4500),
    { timeout: 10_000 }).toBe(true)
    expect(responses.at(-1)!.predictedAt).toBe(initial.predictedAt)
    await expect.poll(seconds).toBeLessThan(resumedSeconds)
    const finalSeconds = await seconds()
    const elapsedSeconds = (responses.at(-1)!.customer.serverNow - initial.customer.serverNow) / 1000
    expect(Math.abs(finalSeconds - (initial.predictedAt - Date.now()) / 1000)).toBeLessThanOrEqual(2)
    const ticks = JSON.parse(await countdown.getAttribute('data-countdown-samples') ?? '[]') as number[]
    expect(ticks.length).toBeGreaterThan(15)
    expect(ticks.every((value, index) => index === 0 || value <= ticks[index - 1]!)).toBe(true)
    await prove(info, evidence, 'Q-BROWSER-COUNTDOWN', 'stable deadline across polls, hidden interval and resumed polling',
      { stable: responses.every((snapshot) => snapshot.predictedAt === initial.predictedAt), elapsed: elapsedSeconds >= 24, decreasing: finalSeconds < ticks[0]! - 20 },
      { stable: true, elapsed: true, decreasing: true })
  } finally {
    await customer.removeAllListeners('response', { behavior: 'wait' })
    await guest.close()
  }
})

// Keep this synthetic entry route under Playwright interception across reloads.
const progressTest = test.extend({ serviceWorkers: 'block' })
progressTest('Q-BROWSER-PROGRESS one baseline reflects numeric ETA, delay, call deadline and arrival', async ({
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
  await checkProgress(0, '50', 'text-black')
  // Waiting changes only when the next backend poll delivers a different estimate.
  await page.clock.runFor(2000)
  await checkProgress(0, '50', 'text-black')
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
      remaining === 10 ? 'text-orange-500' : 'text-black',
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
