import { test, expect } from '../fixtures.js'
import { setup } from '../helpers/queue-actions.js'
type QueueSummary = {
  autoReplacementEnabled: boolean
  version: number
  open: number
  config: Record<string, unknown>
}
type StaffEntry = {
  id: string
  code: string
  version: number
  status: string
  arrivalDeadlineAt: number | null
}

test.skip(
  process.env.NOQUEUE_E2E_AUTO_REPLACEMENT !== 'true',
  'Run with NOQUEUE_E2E_AUTO_REPLACEMENT=true in the isolated local worker',
)

for (const type of ['reception', 'restaurant'] as const) {
  test(`${type}: replaces on a real deadline, exposes trace and keeps arrival manual`, async ({
    page,
    request,
    baseURL,
  }, info) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    const f = await setup(page, request, baseURL!, type)
    const dashboardUrl = page.url()
    const readEntries = async () =>
      (await (
        await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)
      ).json()) as StaffEntry[]
    const queue = (
      (await (
        await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
      ).json()) as QueueSummary[]
    )[0]!
    expect(queue.autoReplacementEnabled).toBe(true)
    const configured = await page.request.patch(
      `/api/v1/staff/queues/${f.queue}`,
      {
        headers: f.headers,
        data: {
          ...queue.config,
          version: queue.version,
          open: !!queue.open,
          graceMinutes: 1,
        },
      },
    )
    expect(configured.ok(), await configured.text()).toBeTruthy()
    for (const [name, size] of [
      ['Ausente', 2],
      ['Sustituto', 2],
      ['Siguiente', 2],
    ] as const) {
      const joined = await page.request.post(
        `/api/v1/staff/queues/${f.queue}/entries`,
        {
          headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            displayName: name,
            partySize: size,
            locale: 'es',
            whatsapp: { consent: false },
            ...(type === 'reception'
              ? { receptionService: 'check_in' }
              : { preferredSpaceId: 'terrace' }),
          },
        },
      )
      expect(joined.ok(), await joined.text()).toBeTruthy()
    }
    const waiting = await readEntries()
    const assigned = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/commands`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data:
          type === 'reception'
            ? {
                action: 'assign_next',
                expectedEntryId: waiting[0]!.id,
                expectedVersion: waiting[0]!.version,
              }
            : {
                action: 'call',
                entryId: waiting[0]!.id,
                version: waiting[0]!.version,
                seating: { mode: 'confirmed', spaceId: 'terrace', seats: 4 },
              },
      },
    )
    expect(assigned.ok(), await assigned.text()).toBeTruthy()
    // No browser polling during the wait: the coordinator alarm owns the transition.
    await page.goto('about:blank')
    const deadline = (await readEntries()).find((e) => e.id === waiting[0]!.id)!
      .arrivalDeadlineAt!
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, deadline - Date.now()) + 300),
    )
    await expect
      .poll(
        async () =>
          (await readEntries()).find((e) => e.id === waiting[1]!.id)?.status,
      )
      .toBe('called')
    const after = await readEntries()
    expect(after.find((e) => e.id === waiting[0]!.id)).toMatchObject({
      status: 'expired',
      automaticReplacement: {
        result: 'replaced',
        successor: { id: waiting[1]!.id },
      },
    })
    expect(after.find((e) => e.id === waiting[1]!.id)).toMatchObject({
      automaticReplacement: { origin: 'arrival_expiry' },
    })
    expect(after.find((e) => e.id === waiting[2]!.id)?.status).toBe('waiting')
    // An assignment from the old screen must not consume the third entry.
    if (type === 'reception') {
      const stale = await page.request.post(
        `/api/v1/staff/queues/${f.queue}/commands`,
        {
          headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            action: 'assign_next',
            expectedEntryId: waiting[1]!.id,
            expectedVersion: waiting[1]!.version,
          },
        },
      )
      expect(stale.status()).toBe(409)
    }
    await page.goto(dashboardUrl)
    await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
    const drawer = page.getByRole('dialog', {
      name: 'Gestionar lista',
      exact: true,
    })
    await expect(drawer.getByText('Asignado automáticamente por ausencia', {exact:true})).toHaveCount(0)
    const successor = drawer.locator(
      `li[data-entry-code="${waiting[1]!.code}"]`,
    )
    await expect(successor).toBeVisible()
    await successor
      .getByRole('button', { name: `Acciones del turno ${waiting[1]!.code}` })
      .click()
    await successor
      .getByRole('button', { name: 'Confirmar llegada', exact: true })
      .last()
      .click()
    await expect
      .poll(
        async () =>
          (await readEntries()).find((e) => e.id === waiting[1]!.id)?.status,
      )
      .toBe('completed')
    await drawer.getByRole('tab', { name: 'Completados', exact: true }).click()
    await page.screenshot({
      path: info.outputPath(`replacement-${type}-mobile.png`),
      fullPage: true,
    })
  })
}

test('quick button sends its displayed head and refreshes a conflict without assigning anyone else', async ({
  page,
  request,
  baseURL,
}) => {
  const f = await setup(page, request, baseURL!, 'reception')
  for (const name of ['Primero', 'Segundo']) {
    const joined = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/entries`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          displayName: name,
          partySize: 1,
          receptionService: 'check_in',
          locale: 'es',
          whatsapp: { consent: false },
        },
      },
    )
    expect(joined.ok(), await joined.text()).toBeTruthy()
  }
  const readEntries = async () =>
    (await (
      await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)
    ).json()) as StaffEntry[]
  const entries = await readEntries()
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  let requests = 0
  await page.route(
    `**/api/v1/staff/queues/${f.queue}/commands`,
    async (route) => {
      requests++
      const payload = route.request().postDataJSON()
      expect(payload).toEqual({
        action: 'assign_next',
        expectedEntryId: entries[0]!.id,
        expectedVersion: entries[0]!.version,
      })
      // Another operator wins after this browser has captured its expected entry.
      const other = await page.request.post(
        `/api/v1/staff/queues/${f.queue}/commands`,
        {
          headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
          data: payload,
        },
      )
      expect(other.ok()).toBeTruthy()
      await route.continue()
    },
  )
  const response = page.waitForResponse((r) =>
    r.url().endsWith(`/queues/${f.queue}/commands`),
  )
  await page
    .getByRole('button', { name: 'Asignar próximo turno', exact: true })
    .click()
  expect((await response).status()).toBe(409)
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Revisa el siguiente turno antes de asignar' }),
  ).toBeVisible()
  expect(requests).toBe(1)
  expect(
    (await readEntries()).find((e) => e.id === entries[1]!.id)?.status,
  ).toBe('waiting')
})
