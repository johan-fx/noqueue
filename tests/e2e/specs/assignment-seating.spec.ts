import { test, expect } from '../fixtures.js'
import { setup } from '../helpers/queue-actions.js'
type QueueSummary = { id: string; version: number; config: Record<string, unknown> & { spaces: { id?: string }[] } }
type StaffEntry = { id: string; version: number }

test('staff confirms a larger table with buttons; the actual context survives reload and catalogue removal', async ({
  page,
  request,
  baseURL,
}, info) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await setup(page, request, baseURL!)
  const readQueue = async () =>
    (
      (await (
        await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
      ).json()) as QueueSummary[]
    )[0]!
  const readEntries = async () =>
    (await (
      await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)
    ).json()) as StaffEntry[]
  let queue = await readQueue()
  const outside = 'Terraza exterior junto a los jardines del hotel'
  const configured = await page.request.patch(
    `/api/v1/staff/queues/${f.queue}`,
    {
      headers: f.headers,
      data: {
        ...queue.config,
        version: queue.version,
        open: true,
        spaces: [
          {
            id: 'inside',
            name: 'Interior',
            tables: 2,
            tableTypes: [
              { seats: 3, count: 1 },
              { seats: 4, count: 1 },
            ],
          },
          {
            id: 'outside',
            name: outside,
            tables: 1,
            tableTypes: [{ seats: 4, count: 1 }],
          },
        ],
      },
    },
  )
  expect(configured.ok(), await configured.text()).toBeTruthy()
  const joined = await page.request.post(
    `/api/v1/staff/queues/${f.queue}/entries`,
    {
      headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        displayName: 'Grupo de prueba',
        partySize: 2,
        preferredSpaceId: 'inside',
        locale: 'es',
        whatsapp: { consent: false },
      },
    },
  )
  expect(joined.ok(), await joined.text()).toBeTruthy()
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const drawer = page.getByRole('dialog', {
    name: 'Gestionar lista',
    exact: true,
  })
  await drawer.getByRole('button', { name: /Acciones del turno/ }).click()
  await drawer
    .getByRole('button', { name: 'Asignar turno', exact: true })
    .click()
  const sheet = page.getByRole('dialog', { name: 'Asignar turno', exact: true })
  await expect(
    sheet.getByText(/^Grupo de 2 personas/),
  ).toBeVisible()
  await expect(
    sheet.getByRole('button', { name: 'Mesa para 3 personas', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(await sheet.getByRole('combobox').count()).toBe(0)
  expect(await sheet.getByRole('checkbox').count()).toBe(0)
  const four = sheet.getByRole('button', {
    name: 'Mesa para 4 personas',
    exact: true,
  })
  await four.focus()
  await page.keyboard.press('Enter')
  await expect(four).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({
    path: info.outputPath('assignment-multiple-options-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await sheet.getByRole('button', { name: outside, exact: true }).click()
  await expect(sheet.getByRole('status')).toContainText(
    'El cliente pidió Interior',
  )
  await expect(four).toHaveCount(0)
  await expect(sheet.getByText('Mesa para 4', { exact: true })).toBeVisible()
  for (const button of await sheet
    .getByRole('group')
    .getByRole('button')
    .all()) {
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  }
  await page.screenshot({
    path: info.outputPath('assignment-buttons-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  const sent = page.waitForRequest(
    (req) =>
      req.method() === 'POST' &&
      req.url().endsWith(`/queues/${f.queue}/commands`),
  )
  await sheet
    .getByRole('button', { name: 'Asignar turno', exact: true })
    .click()
  expect((await sent).postDataJSON()).toMatchObject({
    seating: { mode: 'confirmed', spaceId: 'outside', seats: 4 },
  })
  await expect(sheet).toHaveCount(0)
  await expect(
    drawer.getByText(`· ${outside} · Mesa para 4`, { exact: true }),
  ).toBeVisible()
  const assigned = (await readEntries())[0]!
  expect(assigned).toMatchObject({
    partySize: 2,
    preferredSpaceId: 'inside',
    status: 'called',
    assignedSeating: { spaceId: 'outside', spaceName: outside, seats: 4 },
  })
  // Confirm arrival without changing the context, then remove its catalogue zone.
  const arrived = await page.request.post(
    `/api/v1/staff/queues/${f.queue}/commands`,
    {
      headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        action: 'complete',
        entryId: assigned.id,
        version: assigned.version,
      },
    },
  )
  expect(arrived.ok()).toBeTruthy()
  queue = await readQueue()
  const removed = await page.request.patch(`/api/v1/staff/queues/${f.queue}`, {
    headers: f.headers,
    data: {
      ...queue.config,
      version: queue.version,
      open: true,
      spaces: queue.config.spaces.filter((s) => s.id !== 'outside'),
    },
  })
  expect(removed.ok(), await removed.text()).toBeTruthy()
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  await drawer.getByRole('tab', { name: 'Completados', exact: true }).click()
  await expect(
    drawer.getByText('· Espacio ya no configurado · Mesa para 4', {
      exact: true,
    }),
  ).toBeVisible()
  expect((await readEntries())[0]).toMatchObject({
    status: 'completed',
    assignedSeating: {
      spaceId: 'outside',
      spaceName: 'Espacio ya no configurado',
      seats: 4,
    },
  })
})

test('a single compatible combination is informative and still saves confirmed seating', async ({
  page,
  request,
  baseURL,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await setup(page, request, baseURL!)
  const [queue] = (await (
    await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
  ).json()) as QueueSummary[]
  const configured = await page.request.patch(`/api/v1/staff/queues/${f.queue}`, {
    headers: f.headers,
    data: {
      ...queue!.config,
      version: queue!.version,
      open: true,
      spaces: [{
        id: 'terrace',
        name: 'Terraza',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1 }],
      }],
    },
  })
  expect(configured.ok(), await configured.text()).toBeTruthy()
  const joined = await page.request.post(`/api/v1/staff/queues/${f.queue}/entries`, {
    headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      displayName: 'Grupo de prueba',
      partySize: 2,
      locale: 'es',
      whatsapp: { consent: false },
    },
  })
  expect(joined.ok(), await joined.text()).toBeTruthy()
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Gestionar lista', exact: true })
  await drawer.getByRole('button', { name: /Acciones del turno/ }).click()
  await drawer.getByRole('button', { name: 'Asignar turno', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Asignar turno', exact: true })
  await expect(sheet.getByText('Terraza · Mesa para 4', { exact: true })).toBeVisible()
  await expect(sheet.getByRole('group', { name: 'Espacio', exact: true })).toHaveCount(0)
  await expect(sheet.getByRole('group', { name: 'Mesa para', exact: true })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Terraza', exact: true })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Mesa para 4 personas' })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Asignar turno', exact: true })).toBeEnabled()
  await page.screenshot({
    path: info.outputPath('assignment-single-summary-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  const sent = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith(`/queues/${f.queue}/commands`),
  )
  await sheet.getByRole('button', { name: 'Asignar turno', exact: true }).click()
  expect((await sent).postDataJSON()).toMatchObject({
    seating: { mode: 'confirmed', spaceId: 'terrace', seats: 4 },
  })
  await expect(sheet).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  await expect(drawer.getByText('· Terraza · Mesa para 4', { exact: true })).toBeVisible()
})
