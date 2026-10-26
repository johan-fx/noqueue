import { test, expect } from '../fixtures.js'
import { setup } from '../helpers/queue-actions.js'
type QueueSummary = { config: Record<string, unknown>; version: number }
type StaffEntry = { id: string; code: string; displayName: string | null; status: string; automationCycle: { id: string; capacity: number; state: string; reason: string | null } | null }
type QueueAutomation = { attention: Array<{ id: string; capacity: number; entry: { id: string } }> }

// Isolated local API/DB and simulated providers; no staging data or notifications.
test.use({ serviceWorkers: 'block' })
test.skip(process.env.NOQUEUE_E2E_AUTO_REPLACEMENT !== 'true', 'Requires the isolated automatic-assignment worker')

test('Snack bar: Pepe 2 expires, Alberto 4 requires the durable sheet and a confirmed new cycle', async ({ page, request, baseURL }, info) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await setup(page, request, baseURL!, 'restaurant')
  const current = ((await (await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)).json()) as QueueSummary[])[0]!
  const configured = await page.request.patch(`/api/v1/staff/queues/${f.queue}`, {
    headers: f.headers,
    data: { ...current.config, name: 'Snack bar', version: current.version, open: true, graceMinutes: 1, automaticAssignmentEnabled: true,
      spaces: [{ id: 'inside', name: 'Interior', tables: 8, tableTypes: [{ seats: 2, count: 2, averageMinutes: 5 }, { seats: 4, count: 6, averageMinutes: 8 }] }],
    },
  })
  expect(configured.ok(), await configured.text()).toBeTruthy()
  for (const [displayName, partySize] of [['Pepe', 2], ['Alberto', 4]] as const) {
    const joined = await page.request.post(`/api/v1/staff/queues/${f.queue}/entries`, {
      headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
      data: { displayName, partySize, locale: 'es', preferredSpaceId: 'inside', whatsapp: { consent: false } },
    })
    expect(joined.ok(), await joined.text()).toBeTruthy()
  }
  const entries = async (): Promise<StaffEntry[]> => (await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)).json()
  const automation = async (): Promise<QueueAutomation> => (await page.request.get(`/api/v1/staff/queues/${f.queue}/automation`)).json()
  const initial = await entries()
  const pepe = initial.find(e => e.displayName === 'Pepe')!, alberto = initial.find(e => e.displayName === 'Alberto')!
  const posts: unknown[] = []
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(`/queues/${f.queue}/commands`)) posts.push(req.postDataJSON()) })
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  await page.getByRole('button', { name: `Gestionar turno ${pepe.code}`, exact: true }).click()
  await page.getByRole('dialog', { name: 'Gestionar turno', exact: true }).getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
  const assign = page.getByRole('dialog', { name: 'Asignar turno', exact: true })
  await assign.getByRole('button', { name: 'Asignar turno', exact: true }).click()
  await expect(assign).toHaveCount(0)
  expect(posts).toHaveLength(1)
  const originalCycle = (await entries()).find(e => e.id === pepe.id)!.automationCycle!.id
  const sheet = page.getByRole('dialog', { name: 'No hay un turno compatible', exact: true })
  // Wait for the real alarm/deadline, not a mocked expiry or fabricated feed.
  await expect(sheet).toBeVisible({ timeout: 85_000 })
  await expect(sheet.getByText('Pepe', { exact: true })).toBeVisible()
  await expect(sheet.getByText('2 personas · Interior', { exact: true })).toBeVisible()
  await expect(sheet.getByRole('alert')).toHaveText(/nueva asignación manual/)
  await expect(sheet.getByText('Alberto', { exact: true })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Asignar', exact: true })).toBeEnabled()
  await expect(sheet.getByRole('button', { name: 'Ahora no', exact: true })).toBeInViewport()
  const row = sheet.getByRole('list', { name: 'Turnos pendientes para asignación manual' }).locator('li')
  const [text, action] = await Promise.all([row.locator(':scope > div').boundingBox(), row.getByRole('button', { name: 'Asignar' }).boundingBox()])
  expect(text && action && action.x >= text.x + text.width && action.x + action.width <= 390).toBeTruthy()
  await page.screenshot({ path: info.outputPath('snackbar-discrepancy-sheet-mobile.png'), fullPage: false, animations: 'disabled' })
  expect((await entries()).find(e => e.id === alberto.id)).toMatchObject({ status: 'waiting' })
  expect((await automation()).attention).toMatchObject([{ id: originalCycle, entry: { id: pepe.id }, capacity: 2 }])
  await sheet.getByRole('button', { name: 'Ahora no' }).click()
  await expect(sheet).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Requiere revisión', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const review = page.getByRole('button', { name: /Asignación manual pendiente.*Revisar/ })
  await expect(review).toBeVisible()
  await expect(sheet).toHaveCount(0)
  expect(posts).toHaveLength(1)
  await review.click()
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Asignar', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Asignar turno', exact: true })
  await expect(confirmation.getByRole('button', { name: 'Confirmar', exact: true })).toBeEnabled()
  await expect(confirmation.getByText('Alberto', { exact: true })).toBeVisible()
  expect(posts).toHaveLength(1)
  expect((await entries()).find(e => e.id === alberto.id)?.status).toBe('waiting')
  const response = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith(`/queues/${f.queue}/commands`))
  await confirmation.getByRole('button', { name: 'Confirmar', exact: true }).click()
  expect((await response).ok()).toBeTruthy()
  await expect(confirmation).toHaveCount(0)
  expect(posts).toHaveLength(2)
  expect(posts[1]).toMatchObject({ action: 'call', entryId: alberto.id, attentionId: originalCycle, seating: { mode: 'confirmed', spaceId: 'inside', seats: 4 } })
  const after = await entries()
  expect(after.find(e => e.id === pepe.id)).toMatchObject({ status: 'expired', automationCycle: { id: originalCycle, capacity: 2, state: 'stopped', reason: 'no_candidate' } })
  expect(after.find(e => e.id === alberto.id)).toMatchObject({ status: 'called', automationCycle: { capacity: 4, state: 'active' } })
  expect(after.find(e => e.id === alberto.id)!.automationCycle!.id).not.toBe(originalCycle)
  expect((await automation()).attention).toEqual([])
  await expect(review).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('snackbar-alberto-assigned-mobile.png'), fullPage: false, animations: 'disabled' })
})
