import { newClientContext, test, expect } from '../fixtures.js'
import { setup } from '../helpers/queue-actions.js'
type QueueSummary = {
  id?: string
  autoReplacementEnabled: boolean
  version: number
  open: number
  config: Record<string, unknown> & { automaticAssignmentEnabled?: boolean }
}
type StaffEntry = {
  id: string
  code: string
  version: number
  sequence: number
  status: string
  arrivalDeadlineAt: number | null
  displayName?: string | null
  partySize?: number
  receptionService?: 'check_in' | 'check_out' | 'other' | null
}

type SeedEntry = {
  displayName: string
  partySize: number
  receptionService?: 'check_in' | 'check_out' | 'other'
}

async function addStaffEntries(
  page: import('@playwright/test').Page,
  queue: string,
  headers: Record<string, string>,
  entries: SeedEntry[],
) {
  for (const entry of entries) {
    const response = await page.request.post(
      `/api/v1/staff/queues/${queue}/entries`,
      {
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          displayName: entry.displayName,
          partySize: entry.partySize,
          locale: 'es',
          whatsapp: { consent: false },
          ...(entry.receptionService
            ? { receptionService: entry.receptionService }
            : {}),
        },
      },
    )
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

async function configureAutomatic(
  page: import('@playwright/test').Page,
  venueId: string,
  queueId: string,
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  const queues = (await (
    await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)
  ).json()) as QueueSummary[]
  const queue = queues.find((item) => item.id === queueId) ?? queues[0]!
  const saved = await page.request.patch(`/api/v1/staff/queues/${queueId}`, {
    headers,
    data: {
      ...queue.config,
      ...overrides,
      automaticAssignmentEnabled: true,
      version: queue.version,
      open: !!queue.open,
    },
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()
}

async function readStaffEntries(
  page: import('@playwright/test').Page,
  queue: string,
) {
  return (await (
    await page.request.get(`/api/v1/staff/queues/${queue}/entries`)
  ).json()) as StaffEntry[]
}

async function manageEntry(
  page: import('@playwright/test').Page,
  code: string,
) {
  await page
    .locator(`li[data-entry-code="${code}"]`)
    .getByRole('button', { name: `Gestionar turno ${code}` })
    .click()
  return page.getByRole('dialog', { name: 'Gestionar turno', exact: true })
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
    const automationBefore = await page.request.get(
      `/api/v1/staff/queues/${f.queue}/automation`,
    )
    expect(automationBefore.ok(), await automationBefore.text()).toBeTruthy()
    expect(await automationBefore.json()).toMatchObject({
      configured: false,
      effective: false,
      activeCycles: 0,
    })
    const configured = await page.request.patch(
      `/api/v1/staff/queues/${f.queue}`,
      {
        headers: f.headers,
        data: {
          ...queue.config,
          automaticAssignmentEnabled: true,
          version: queue.version,
          open: !!queue.open,
          graceMinutes: 1,
        },
      },
    )
    expect(configured.ok(), await configured.text()).toBeTruthy()
    const automationConfigured = await page.request.get(
      `/api/v1/staff/queues/${f.queue}/automation`,
    )
    expect(automationConfigured.ok(), await automationConfigured.text()).toBeTruthy()
    expect(await automationConfigured.json()).toMatchObject({
      configured: true,
      effective: true,
      activeCycles: 0,
    })
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
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/v1/staff/queues/${f.queue}/automation`,
        )
        return (await response.json()).activeCycles
      })
      .toBe(1)
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
      automationCycle: {
        capacity: type === 'restaurant' ? 2 : null,
        state: 'active',
      },
      automaticReplacement: {
        result: 'replaced',
        successor: { id: waiting[1]!.id },
      },
    })
    expect(after.find((e) => e.id === waiting[1]!.id)).toMatchObject({
      automaticReplacement: { origin: 'arrival_expiry' },
      automationCycle: {
        capacity: type === 'restaurant' ? 2 : null,
        state: 'active',
      },
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
    await expect(
      page.getByRole('dialog', { name: 'Elige otro turno', exact: true }),
    ).toHaveCount(0)
    const drawer = page.getByRole('dialog', {
      name: 'Gestionar lista',
      exact: true,
    })
    const successor = drawer.locator(
      `li[data-entry-code="${waiting[1]!.code}"]`,
    )
    await expect(successor).toBeVisible()
    const successorManage = await manageEntry(page, waiting[1]!.code)
    await successorManage
      .getByRole('button', { name: 'Confirmar llegada', exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (await readEntries()).find((e) => e.id === waiting[1]!.id)?.status,
      )
      .toBe('completed')
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/v1/staff/queues/${f.queue}/automation`,
        )
        return (await response.json()).activeCycles
      })
      .toBe(0)
    await drawer.getByRole('tab', { name: 'Completados', exact: true }).click()
    await page.screenshot({
      path: info.outputPath(`replacement-${type}-mobile.png`),
      fullPage: true,
    })
  })
}

test('manual cancellation stops only its own active reception cycle', async ({
  page,
  request,
  baseURL,
}) => {
  const f = await setup(page, request, baseURL!, 'reception')
  await configureAutomatic(page, f.venueId, f.queue, f.headers, { graceMinutes: 1 })

  for (const name of ['Ciclo cancelado', 'Ciclo confirmado', 'Debe esperar']) {
    const joined = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/entries`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          displayName: name,
          partySize: 1,
          locale: 'es',
          whatsapp: { consent: false },
          receptionService: 'check_in',
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
  for (const entry of entries.slice(0, 2)) {
    const assigned = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/commands`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          action: 'assign_next',
          expectedEntryId: entry.id,
          expectedVersion: entry.version,
        },
      },
    )
    expect(assigned.ok(), await assigned.text()).toBeTruthy()
  }
  const active = await page.request.get(
    `/api/v1/staff/queues/${f.queue}/automation`,
  )
  expect(await active.json()).toMatchObject({ activeCycles: 2 })

  const cancelled = await page.request.post(
    `/api/v1/staff/queues/${f.queue}/commands`,
    {
      headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
      data: { action: 'cancel', entryId: entries[0]!.id, version: 1 },
    },
  )
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy()
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/v1/staff/queues/${f.queue}/automation`,
      )
      return (await response.json()).activeCycles
    })
    .toBe(1)
  const afterCancel = await readEntries()
  expect(afterCancel.find((entry) => entry.id === entries[0]!.id)?.status).toBe(
    'cancelled',
  )
  expect(afterCancel.find((entry) => entry.id === entries[1]!.id)?.status).toBe(
    'called',
  )
  expect(afterCancel.find((entry) => entry.id === entries[2]!.id)?.status).toBe(
    'waiting',
  )

  const completed = await page.request.post(
    `/api/v1/staff/queues/${f.queue}/commands`,
    {
      headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
      data: { action: 'complete', entryId: entries[1]!.id, version: 1 },
    },
  )
  expect(completed.ok(), await completed.text()).toBeTruthy()
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/v1/staff/queues/${f.queue}/automation`,
      )
      return (await response.json()).activeCycles
    })
    .toBe(0)
  expect((await readEntries()).find((entry) => entry.id === entries[2]!.id)?.status).toBe(
    'waiting',
  )
})

test('automatic assignment is opt-in per service in configuration and has no cycle before a manual call', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(60_000)
  const f = await setup(page, request, baseURL!, 'restaurant')
  const summaries = (await (
    await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
  ).json()) as QueueSummary[]
  expect(summaries[0]!.config.automaticAssignmentEnabled ?? false).toBe(false)

  await page.keyboard.press('Escape')
  await page
    .getByRole('button', { name: 'Opciones del servicio' })
    .first()
    .click()
  await page
    .getByRole('menuitem', { name: 'Configurar servicio', exact: true })
    .click()
  const config = page.getByRole('dialog', {
    name: 'Configuración restaurante',
    exact: true,
  })
  await config.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await config.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await config
    .getByRole('button', { name: 'Configuración avanzada', exact: true })
    .click()
  const advanced = page.getByRole('dialog', {
    name: 'Configuración avanzada',
    exact: true,
  })
  const automaticSwitch = advanced.getByRole('switch', {
    name: 'Modo de gestión automática',
  })
  await expect(automaticSwitch).toHaveAttribute('aria-checked', 'false')
  await automaticSwitch.click()
  await advanced.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await config.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await config.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(config.getByText('Gestión automática activa')).toBeVisible()
  await config.getByRole('button', { name: 'Confirmar', exact: true }).click()

  const card = page.getByRole('article', { name: 'Servicio Restaurant' })
  await expect(card.getByText('Gestión automática', { exact: true })).toBeVisible()
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/v1/staff/venues/${f.venueId}/queues`,
      )
      const rows = (await response.json()) as QueueSummary[]
      return rows[0]!.config.automaticAssignmentEnabled
    })
    .toBe(true)
  const automation = await page.request.get(
    `/api/v1/staff/queues/${f.queue}/automation`,
  )
  expect(await automation.json()).toMatchObject({
    configured: true,
    effective: true,
    activeCycles: 0,
  })
})

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

test('waiting and called passes toast once; priorities are FIFO and subtype-compatible', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000)
  const f = await setup(page, request, baseURL!, 'reception')
  await configureAutomatic(page, f.venueId, f.queue, f.headers, {
    graceMinutes: 5,
    receptionServices: ['check_in', 'check_out', 'other'],
  })
  await addStaffEntries(page, f.queue, f.headers, [
    { displayName: 'Ciclo inicial', partySize: 1, receptionService: 'check_in' },
    { displayName: 'Compatible normal', partySize: 1, receptionService: 'check_in' },
    { displayName: 'Compatible segundo', partySize: 1, receptionService: 'check_in' },
    { displayName: 'Subtipo distinto', partySize: 1, receptionService: 'check_out' },
    { displayName: 'Prioridad Uno', partySize: 1, receptionService: 'check_in' },
    { displayName: 'Prioridad Dos', partySize: 1, receptionService: 'check_in' },
  ])
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Gestionar lista', exact: true })

  await drawer.getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
  const callToast = 'Turno asignado. Seguimiento automático activo.'
  await expect(page.getByText(callToast, { exact: true })).toHaveCount(1)
  let entries = await readStaffEntries(page, f.queue)
  const initial = entries.find((entry) => entry.status === 'called')!
  const compatibleNormal = entries.find((entry) => entry.displayName === 'Compatible normal')!
  const compatibleSecond = entries.find((entry) => entry.displayName === 'Compatible segundo')!
  const priorityOne = entries.find((entry) => entry.displayName === 'Prioridad Uno')!
  const priorityTwo = entries.find((entry) => entry.displayName === 'Prioridad Dos')!
  const otherSubtype = entries.find((entry) => entry.displayName === 'Subtipo distinto')!

  const waitingManage = await manageEntry(page, compatibleNormal.code)
  await waitingManage.getByRole('button', { name: 'Pasar turno', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Pasar turno', exact: true })
    .getByRole('button', { name: 'Pasar turno', exact: true })
    .click()
  const waitingPassToast = 'Turno pasado. La lista se ha actualizado.'
  await expect(page.getByText(waitingPassToast, { exact: true })).toHaveCount(1)
  await page.waitForTimeout(700)
  await expect(page.getByText(waitingPassToast, { exact: true })).toHaveCount(1)
  entries = await readStaffEntries(page, f.queue)
  expect(entries.find((entry) => entry.id === compatibleSecond.id)!.sequence).toBeLessThan(
    entries.find((entry) => entry.id === compatibleNormal.id)!.sequence,
  )
  expect(
    await page.request
      .get(`/api/v1/staff/queues/${f.queue}/automation`)
      .then((response) => response.json())
      .then((automation) => automation.nextEntry.id),
  ).toBe(compatibleSecond.id)
  expect((await readStaffEntries(page, f.queue)).filter((entry) => entry.status === 'called')).toHaveLength(1)

  for (const priority of [priorityOne, priorityTwo]) {
    const manage = await manageEntry(page, priority.code)
    await manage
      .getByRole('button', { name: 'Priorizar para siguiente turno', exact: true })
      .click()
    const confirm = page.getByRole('dialog', {
      name: 'Priorizar para el siguiente turno',
      exact: true,
    })
    await confirm.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await expect(
      page.getByText(`${priority.displayName} tendrá prioridad en la siguiente asignación disponible.`, { exact: true }),
    ).toHaveCount(1)
  }

  const passCalled = async (code: string, successorName: string) => {
    const manage = await manageEntry(page, code)
    await manage.getByRole('button', { name: 'Pasar turno', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Pasar turno', exact: true })
    await confirm.getByRole('button', { name: 'Pasar turno', exact: true }).click()
    const toast = `Turno pasado. Hemos avisado a ${successorName}.`
    await expect(page.getByText(toast, { exact: true })).toHaveCount(1)
    await page.waitForTimeout(700)
    await expect(page.getByText(toast, { exact: true })).toHaveCount(1)
  }

  await passCalled(initial.code, 'Prioridad Uno')
  entries = await readStaffEntries(page, f.queue)
  expect(entries.find((entry) => entry.id === initial.id)?.status).toBe('waiting')
  expect(entries.find((entry) => entry.id === priorityOne.id)?.status).toBe('called')
  expect(entries.find((entry) => entry.id === priorityTwo.id)?.status).toBe('waiting')
  expect(entries.find((entry) => entry.id === otherSubtype.id)?.status).toBe('waiting')

  await passCalled(priorityOne.code, 'Prioridad Dos')
  entries = await readStaffEntries(page, f.queue)
  expect(entries.find((entry) => entry.id === priorityTwo.id)?.status).toBe('called')
  expect(entries.find((entry) => entry.id === otherSubtype.id)?.status).toBe('waiting')
  expect(entries.filter((entry) => entry.status === 'called')).toHaveLength(1)
})

test('selecting an older compatible restaurant candidate is local until Confirmar; a concurrent call conflicts without duplication', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000)
  const f = await setup(page, request, baseURL!, 'restaurant')
  await addStaffEntries(page, f.queue, f.headers, [
    { displayName: 'Anterior de tres', partySize: 3 },
    { displayName: 'Anterior de dos', partySize: 2 },
    { displayName: 'Mesa para cuatro', partySize: 4 },
  ])
  const entries = await readStaffEntries(page, f.queue)
  const older = entries.find((entry) => entry.displayName === 'Anterior de tres')!
  const secondOlder = entries.find((entry) => entry.displayName === 'Anterior de dos')!
  const target = entries.find((entry) => entry.displayName === 'Mesa para cuatro')!
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Gestionar lista', exact: true })
  await expect(drawer.getByText('Mesa para cuatro', { exact: true })).toBeVisible()

  // Preserve the captured screen state while the independent operator wins.
  await page.route(
    `**/api/v1/staff/queues/${f.queue}/entries`,
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(entries),
      }),
  )

  let commandPosts = 0
  await page.route(`**/api/v1/staff/queues/${f.queue}/commands`, async (route) => {
    commandPosts += 1
    await route.continue()
  })
  const manage = await manageEntry(page, target.code)
  await manage.getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
  const warning = page.getByRole('dialog', {
    name: 'Hay turnos esperando desde antes',
    exact: true,
  })
  const candidateRows = warning.getByRole('list', {
    name: 'Turnos compatibles anteriores',
  })
  await expect(candidateRows.getByText('Anterior de tres', { exact: true })).toBeVisible()
  await expect(candidateRows.getByText('Anterior de dos', { exact: true })).toBeVisible()
  await candidateRows
    .getByRole('button', { name: 'Asignar →', exact: true })
    .first()
    .click()
  const assignment = page.getByRole('dialog', {
    name: 'Asignar turno',
    exact: true,
  })
  await expect(assignment.getByText('Anterior de tres', { exact: true })).toBeVisible()
  expect(commandPosts).toBe(0)
  expect((await readStaffEntries(page, f.queue)).every((entry) => entry.status === 'waiting')).toBe(true)

  const competingCall = await page.request.post(
    `/api/v1/staff/queues/${f.queue}/commands`,
    {
      headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        action: 'call',
        entryId: older.id,
        version: older.version,
        arrivalMode: 'notify',
        seating: { mode: 'confirmed', spaceId: 'terrace', seats: 4 },
      },
    },
  )
  expect(competingCall.ok(), await competingCall.text()).toBeTruthy()
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/queues/${f.queue}/commands`) &&
      response.request().method() === 'POST',
  )
  await assignment.getByRole('button', { name: 'Asignar turno', exact: true }).click()
  const conflict = await responsePromise
  expect(conflict.status()).toBe(409)
  await expect(assignment.getByRole('alert')).toBeVisible()
  expect(commandPosts).toBe(1)
  expect(await page.getByText('Turno asignado.', { exact: true }).count()).toBe(0)

  const afterConflict = await readStaffEntries(page, f.queue)
  expect(afterConflict.find((entry) => entry.id === older.id)?.status).toBe('called')
  expect(afterConflict.find((entry) => entry.id === secondOlder.id)?.status).toBe('waiting')
  expect(afterConflict.find((entry) => entry.id === target.id)?.status).toBe('waiting')
})

test('reconciles cycle state and entries after a second authenticated operator acts while offline', async ({
  page,
  request,
  baseURL,
  browser,
}, info) => {
  test.setTimeout(90_000)
  const f = await setup(page, request, baseURL!, 'reception')
  const dashboardUrl = page.url()
  const queue = (
    (await (
      await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
    ).json()) as QueueSummary[]
  )[0]!
  const configured = await page.request.patch(
    `/api/v1/staff/queues/${f.queue}`,
    {
      headers: f.headers,
      data: {
        ...queue.config,
        automaticAssignmentEnabled: true,
        version: queue.version,
        open: !!queue.open,
        graceMinutes: 5,
      },
    },
  )
  expect(configured.ok(), await configured.text()).toBeTruthy()

  for (const name of ['Offline primero', 'Offline segundo']) {
    const response = await page.request.post(
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
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  const readEntries = async () =>
    (await (
      await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)
    ).json()) as StaffEntry[]
  const readAutomation = async () =>
    (await (
      await page.request.get(`/api/v1/staff/queues/${f.queue}/automation`)
    ).json()) as { activeCycles: number }
  const initialEntries = await readEntries()
  expect(initialEntries).toHaveLength(2)

  const automationRequests: string[] = []
  await page.route(`**/api/v1/staff/queues/${f.queue}/automation**`, async (route) => {
    automationRequests.push(route.request().url())
    await route.continue()
  })

  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const primaryDrawer = page.getByRole('dialog', {
    name: 'Gestionar lista',
    exact: true,
  })
  await expect(
    primaryDrawer.getByText('Gestión automática pausada'),
  ).toBeVisible()

  const secondaryContext = await newClientContext(
    browser,
    info,
    'arrival-offline-secondary-operator',
    { storageState: await page.context().storageState() },
  )
  try {
    const secondaryPage = await secondaryContext.newPage()
    await secondaryPage.goto(dashboardUrl)
    await expect(
      secondaryPage.getByRole('heading', {
        name: 'Queue Verification',
        exact: true,
      }),
    ).toBeVisible()
    await secondaryPage
      .getByRole('button', { name: 'Ver lista', exact: true })
      .click()
    const secondaryDrawer = secondaryPage.getByRole('dialog', {
      name: 'Gestionar lista',
      exact: true,
    })
    await expect(
      secondaryDrawer.getByText('Gestión automática pausada'),
    ).toBeVisible()

    await page.context().setOffline(true)
    await secondaryDrawer
      .getByRole('button', { name: 'Asignar próximo turno', exact: true })
      .click()
    await expect(
      secondaryDrawer.getByText('Gestión automática activa'),
    ).toBeVisible()
    await expect
      .poll(async () => (await readAutomation()).activeCycles)
      .toBe(1)
    const activeEntries = await readEntries()
    expect(activeEntries).toHaveLength(2)
    expect(activeEntries.filter((entry) => entry.status === 'called')).toHaveLength(1)
    expect(activeEntries.filter((entry) => entry.status === 'waiting')).toHaveLength(1)
    const called = activeEntries.find((entry) => entry.status === 'called')!
    const calledRow = secondaryDrawer.locator(
      `li[data-entry-code="${called.code}"]`,
    )
    await expect(calledRow.getByText('Pendiente de llegada')).toBeVisible()

    await calledRow
      .getByRole('button', { name: `Gestionar turno ${called.code}` })
      .click()
    await secondaryPage
      .getByRole('dialog', { name: 'Gestionar turno', exact: true })
      .getByRole('button', { name: 'Pasar turno', exact: true })
      .click()
    await secondaryPage
      .getByRole('dialog', { name: 'Pasar turno', exact: true })
      .getByRole('button', { name: 'Pasar turno', exact: true })
      .click()
    const passToast = 'Turno pasado. Hemos avisado a Offline segundo.'
    await expect(secondaryPage.getByText(passToast, { exact: true })).toHaveCount(1)
    await expect
      .poll(async () => (await readAutomation()).activeCycles)
      .toBe(1)
    const passedEntries = await readEntries()
    expect(passedEntries.find((entry) => entry.id === called.id)?.status).toBe('waiting')
    const calledAfterPass = passedEntries.find((entry) => entry.status === 'called')!
    expect(calledAfterPass.id).not.toBe(called.id)
    const historyResponse = await page.request.get(
      `/api/v1/staff/queues/${f.queue}/automation?after=0`,
    )
    expect(historyResponse.ok(), await historyResponse.text()).toBeTruthy()
    expect((await historyResponse.json()).events).toEqual(
      expect.arrayContaining([expect.objectContaining({ cause: 'staff_pass' })]),
    )

    automationRequests.length = 0
    await page.context().setOffline(false)
    await page.bringToFront()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(
      primaryDrawer.getByText('Gestión automática activa'),
    ).toBeVisible()
    await expect(
      primaryDrawer.getByText('1 asignación activa.', { exact: true }),
    ).toBeVisible()
    const primaryCalledRow = primaryDrawer.locator(
      `li[data-entry-code="${calledAfterPass.code}"]`,
    )
    await expect(
      primaryCalledRow.getByText('Pendiente de llegada'),
    ).toBeVisible()
    await expect
      .poll(() => automationRequests.length > 0)
      .toBe(true)
    expect(automationRequests.some((url) => !new URL(url).searchParams.has('after'))).toBe(true)
    const replayToast = page.getByText(passToast, { exact: true })
    await expect(replayToast).toHaveCount(0)
    // The API history contains an offline event, but reconnect/foreground only
    // reconciles state and establishes a new high-water baseline.
    await page.waitForTimeout(5_500)
    await expect(replayToast).toHaveCount(0)
    expect(automationRequests.some((url) => !new URL(url).searchParams.has('after'))).toBe(true)
    await expect(primaryDrawer.getByText('Gestión automática activa')).toBeVisible()
    await expect(primaryDrawer.getByText('1 asignación activa.', { exact: true })).toBeVisible()
    await expect(primaryDrawer.locator(`li[data-entry-code="${called.code}"]`)).toBeVisible()

    const successorManage = await manageEntry(page, calledAfterPass.code)
    await successorManage
      .getByRole('button', { name: 'Confirmar llegada', exact: true })
      .click()
    await expect
      .poll(async () => (await readAutomation()).activeCycles)
      .toBe(0)
    await expect
      .poll(async () =>
        (await readEntries()).find((entry) => entry.id === calledAfterPass.id)?.status,
      )
      .toBe('completed')
    await page.context().setOffline(false)
    await expect(
      primaryDrawer.getByText('Gestión automática pausada'),
    ).toBeVisible()
    await primaryDrawer
      .getByRole('tab', { name: 'Completados', exact: true })
      .click()
    const completedRow = primaryDrawer.locator(
      `li[data-entry-code="${calledAfterPass.code}"]`,
    )
    await expect(completedRow).toHaveCount(1)
    await expect(completedRow.getByText('Completado', { exact: true })).toBeVisible()
    const finalEntries = await readEntries()
    expect(finalEntries).toHaveLength(2)
    expect(finalEntries.filter((entry) => entry.status === 'called')).toHaveLength(0)
    expect(finalEntries.filter((entry) => entry.status === 'completed')).toHaveLength(1)
    expect(await readAutomation()).toMatchObject({ activeCycles: 0 })
  } finally {
    if (!page.isClosed()) await page.context().setOffline(false)
    if (secondaryContext.pages().some((secondary) => !secondary.isClosed()))
      await secondaryContext.close()
  }
})
