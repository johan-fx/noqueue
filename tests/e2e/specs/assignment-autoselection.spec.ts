import { test, expect } from '../fixtures.js'
import { setup } from '../helpers/queue-actions.js'

test.use({ serviceWorkers: 'block' })
test.skip(process.env.NOQUEUE_E2E_AUTO_REPLACEMENT !== 'true', 'Requires the isolated local worker with automation enabled')

type Entry = { id: string; code: string; displayName: string; partySize: number; status: string; assignedSeating?: { spaceId: string; seats: number }; automationCycle?: { state: string; capacity: number } }

for (const selectedSize of [4, 1, 3]) {
  test(`autoselection: confirm party ${selectedSize} from the older-turn warning without assigning the others`, async ({ page, request, baseURL }, info) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 390, height: 844 })
    const f = await setup(page, request, baseURL!, 'restaurant')
    const queues = await (await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)).json() as { id: string; version: number; config: Record<string, unknown> }[]
    const queue = queues.find((row) => row.id === f.queue)!
    const configured = await page.request.patch(`/api/v1/staff/queues/${f.queue}`, {
      headers: f.headers,
      data: {
        ...queue.config, version: queue.version, open: true, automaticAssignmentEnabled: true,
        spaces: [
          { id: 'inside', name: 'Interior', tables: 1, tableTypes: [{ seats: 6, count: 1 }] },
          { id: 'outside', name: 'Terraza', tables: 3, tableTypes: [1, 3, 4].map((seats) => ({ seats, count: 1 })) },
        ],
      },
    })
    expect(configured.ok(), await configured.text()).toBeTruthy()
    for (const partySize of [1, 3, 4]) {
      const joined = await page.request.post(`/api/v1/staff/queues/${f.queue}/entries`, {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: { displayName: `Grupo de ${partySize}`, partySize, locale: 'es', whatsapp: { consent: false } },
      })
      expect(joined.ok(), await joined.text()).toBeTruthy()
    }
    const readEntries = async (): Promise<Entry[]> => (await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)).json()
    const initial = await readEntries()
    const target = initial.find((entry) => entry.partySize === 4)!
    const selected = initial.find((entry) => entry.partySize === selectedSize)!
    const posts: unknown[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith(`/queues/${f.queue}/commands`)) posts.push(req.postDataJSON())
    })
    await page.reload()
    await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
    await page.getByRole('button', { name: `Gestionar turno ${target.code}`, exact: true }).click()
    await page.getByRole('dialog', { name: 'Gestionar turno', exact: true }).getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
    const warning = page.getByRole('dialog', { name: 'Hay turnos esperando desde antes', exact: true })
    await expect(warning.getByText('Terraza · Mesa para 4', { exact: true })).toBeVisible()
    await expect(warning.getByRole('button', { name: 'Confirmar', exact: true })).toBeEnabled()
    await expect(warning.getByRole('group', { name: 'Espacio', exact: true })).toHaveCount(0)
    await expect(warning.getByRole('group', { name: 'Mesa para', exact: true })).toHaveCount(0)
    const candidates = warning.getByRole('list', { name: 'Turnos compatibles anteriores' })
    for (const size of [1, 3]) {
      const row = candidates.locator('li').filter({ hasText: `Grupo de ${size}` })
      const button = row.getByRole('button', { name: 'Asignar', exact: true })
      await expect(button).toBeVisible()
      // Text may wrap; the action remains in the right column, centered on the whole row.
      await expect.poll(async () => {
        const [left, right] = await Promise.all([row.locator(':scope > div').boundingBox(), button.boundingBox()])
        return left !== null && right !== null && right.x >= left.x + left.width && Math.abs((right.y + right.height / 2) - (left.y + left.height / 2)) < 2 && right.x + right.width <= 390
      }).toBe(true)
    }
    await page.screenshot({ path: info.outputPath('autoselection-warning-mobile.png'), fullPage: true, animations: 'disabled' })
    let confirmation = warning.getByRole('button', { name: 'Confirmar', exact: true })
    if (selectedSize !== 4) {
      await candidates.locator('li').filter({ hasText: `Grupo de ${selectedSize}` }).getByRole('button', { name: 'Asignar', exact: true }).click()
      if (selectedSize === 1) {
        const assignment = page.getByRole('dialog', { name: 'Asignar turno', exact: true })
        await expect(assignment.getByText('Grupo de 1', { exact: true })).toBeVisible()
        await expect(assignment.getByRole('button', { name: 'Mesa para 1 persona', exact: true })).toHaveAttribute('aria-pressed', 'true')
        confirmation = assignment.getByRole('button', { name: 'Asignar turno', exact: true })
      } else {
        await expect(warning.getByText('Terraza · Mesa para 3', { exact: true })).toBeVisible()
      }
    }
    expect(posts).toHaveLength(0)
    expect((await readEntries()).every((entry) => entry.status === 'waiting')).toBe(true)
    await expect(confirmation).toBeEnabled()
    const response = page.waitForResponse((res) => res.request().method() === 'POST' && res.url().endsWith(`/queues/${f.queue}/commands`))
    await confirmation.click()
    expect((await response).ok()).toBe(true)
    await expect(confirmation).toHaveCount(0)
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ action: 'call', entryId: selected.id, arrivalMode: 'notify', seating: { mode: 'confirmed', spaceId: 'outside', seats: selectedSize } })
    const after = await readEntries()
    expect(after.find((entry) => entry.id === selected.id)).toMatchObject({ status: 'called', partySize: selectedSize, assignedSeating: { spaceId: 'outside', seats: selectedSize }, automationCycle: { state: 'active', capacity: selectedSize } })
    expect(after.filter((entry) => entry.id !== selected.id).map((entry) => entry.status)).toEqual(['waiting', 'waiting'])
    await page.reload()
    await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
    const assignedRow = page.locator(`li[data-entry-code="${selected.code}"]`)
    await expect(assignedRow.getByText('Terraza', { exact: true })).toBeVisible()
    expect((await readEntries()).find((entry) => entry.id === selected.id)?.status).toBe('called')
    await page.screenshot({ path: info.outputPath(`assigned-party-${selectedSize}-mobile.png`), fullPage: true, animations: 'disabled' })
  })
}
