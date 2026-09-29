import { setup, join, act, prove, pilot } from '../helpers/queue-actions.js'
import { queueOrder } from '../helpers/queue-order.js'
import {
  test as base,
  expect,
  type Page,
  type TestInfo,
  type APIRequestContext,
} from '@playwright/test'
type Step = {
  scenarioId: string
  step: string
  actual: unknown
  expected: unknown
  simulatedAt: number
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
test('Q-BROWSER-ORDER public joins and skip update staff and two isolated clients', async ({
  page,
  request,
  browser,
  baseURL,
  evidence,
}, info) => {
  await queueOrder({ page, request, browser, baseURL: baseURL!, evidence, info })
})
test('Q-BROWSER-RESOURCE reservation arrival and explicit release preserve physical capacity', async ({
  page,
  request,
  browser,
  baseURL,
  evidence,
}, info) => {
  const t = await setup(page, request, baseURL!),
    guest = await browser.newContext({
      baseURL: baseURL!,
      extraHTTPHeaders: { 'CF-Connecting-IP': crypto.randomUUID() },
    })
  try {
    const alice = await guest.newPage()
    await join(alice, t.queue, 'Alice')
    await act(page, 'Alice', 'Llamar')
    await expect(alice.getByText(/Es tu turno/)).toBeVisible()
    await act(page, 'Alice', 'Confirmar llegada')
    await expect(
      alice.getByText('Estado: En servicio', { exact: true })
    ).toBeVisible()
    const second = await browser.newContext({
      baseURL: baseURL!,
      extraHTTPHeaders: { 'CF-Connecting-IP': crypto.randomUUID() },
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
        }
      )
      await prove(
        info,
        evidence,
        'Q-BROWSER-RESOURCE',
        'occupied resource rejects another call',
        refused.status(),
        409
      )
      await page.getByRole('tab', { name: 'Completados' }).click()
      await act(page, 'Alice', 'Liberar recurso')
      await expect(
        alice.getByText('Estado: Servicio finalizado', { exact: true })
      ).toBeVisible()
      await page.getByRole('tab', { name: 'Lista', exact: true }).click()
      await act(page, 'Bob', 'Llamar')
      await expect(bob.getByText(/Es tu turno/)).toBeVisible()
      await prove(
        info,
        evidence,
        'Q-BROWSER-RESOURCE',
        'release allows the next real call',
        true,
        true
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
    guest = await browser.newContext({
      baseURL: baseURL!,
      extraHTTPHeaders: { 'CF-Connecting-IP': crypto.randomUUID() },
    })
  try {
    const alice = await guest.newPage()
    await join(alice, t.queue, 'Alice')
    await page.getByRole('button', { name: 'Volver', exact: true }).click()
    await page.getByRole('switch', { name: 'Abrir cola' }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cerrar cola', exact: true })
      .click()
    const form = await guest.newPage()
    await form.goto(`/q/${t.queue}`)
    await expect(
      form.getByText('La cola está cerrada.', { exact: true })
    ).toBeVisible()
    await expect(
      form.getByRole('button', { name: 'Unirme a la cola' })
    ).toBeDisabled()
    await expect(
      alice.getByText('Estado: waiting', { exact: true })
    ).toBeVisible()
    const rejected = await form.request.post(
      `/api/v1/public/services/${t.queue}/entries`,
      {
        headers: { ...t.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: { displayName: 'Closed', partySize: 4, locale: 'es' },
      }
    )
    expect(rejected.ok()).toBe(false)
    await prove(
      info,
      evidence,
      'Q-BROWSER-CLOSE',
      'new admission rejected; existing turn remains waiting',
      rejected.status(),
      409
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
      guest = await browser.newContext({
        baseURL: baseURL!,
        extraHTTPHeaders: { 'CF-Connecting-IP': crypto.randomUUID() },
      })
    try {
      const first = await guest.newPage(),
        second = await guest.newPage()
      await join(first, t.queue, 'First')
      await join(second, t.queue, 'Second')
      await expect(
        second.getByText('Espera aproximada: 50 min', { exact: true })
      ).toBeVisible()
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
          }
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
              { data }
            )
          ).status()
        ).toBe(401)
        expect(
          (
            await request.post(
              '/api/v1/experiments/local/staff/queue-history',
              {
                headers: pilot,
                data: { ...data, durations: Array(32).fill(60) },
              }
            )
          ).status()
        ).toBe(400)
        const loaded = await request.post(
          '/api/v1/experiments/local/staff/queue-history',
          { headers: pilot, data }
        )
        expect(loaded.ok(), await loaded.text()).toBeTruthy()
      }
      await expect(
        second.getByText(`Espera aproximada: ${expected} min`, { exact: true })
      ).toBeVisible()
      const row = page
        .getByRole('dialog', { name: 'Gestionar cola', exact: true })
        .locator('li')
        .filter({ hasText: 'Second' })
      await expect(
        row.getByText(`${expected} min`, { exact: true })
      ).toBeVisible()
      await prove(
        info,
        evidence,
        `Q-BROWSER-${kind}`,
        'terrace/4 expected ETA rendered by both clients',
        await second
          .getByText(`Espera aproximada: ${expected} min`, { exact: true })
          .textContent(),
        `Espera aproximada: ${expected} min`
      )
      await second.screenshot({
        path: info.outputPath('customer-estimate.png'),
      })
    } finally {
      await guest.close()
    }
  })
