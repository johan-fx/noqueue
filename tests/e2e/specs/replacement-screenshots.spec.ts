import { mkdir } from 'node:fs/promises'
import { resolveFixtureLocation } from '../helpers/location.js'
import { test, expect } from '../fixtures.js'
import { setup } from '../helpers/queue-actions.js'
import type { Page } from '@playwright/test'

test.skip(
  !process.env.REPLACEMENT_SCREENSHOTS,
  'Explicit local visual capture only',
)
const root = process.env.REPLACEMENT_SCREENSHOTS ?? '/tmp/arrival-cycles'
const capturedFigmaNodes = new Set<string>()

type VisualQueue = {
  id: string
  version: number
  open: number | boolean
  config: Record<string, unknown> & { type: string }
}

async function capture(page: Page, scenario: string, state: string) {
  await mkdir(root, { recursive: true })
  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.waitForTimeout(400)
    await page.screenshot({
      path: `${root}/${scenario}-${state}-${viewport.name}.png`,
      animations: 'disabled',
      fullPage: true,
    })
  }
  await page.setViewportSize({ width: 390, height: 844 })
}

async function captureFigmaNode(page: Page, node: string, fast = false) {
  if (capturedFigmaNodes.has(node))
    throw new Error(`Figma screenshot node ${node} was already captured`)
  capturedFigmaNodes.add(node)
  await mkdir(root, { recursive: true })
  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    if (!fast) await page.waitForTimeout(100)
    await page.screenshot({
      path: `${root}/figma-${node}-${viewport.name}.png`,
      animations: 'disabled',
      fullPage: true,
    })
  }
  await page.setViewportSize({ width: 390, height: 844 })
}

test('restaurant: captures configured, active and completed automatic-assignment cycle states', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await setup(page, request, baseURL!, 'restaurant')
  const dashboardUrl = page.url()
  const summary = (
    (await (
      await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
    ).json()) as {
      version: number
      open: number
      config: Record<string, unknown>
    }[]
  )[0]!
  const saved = await page.request.patch(`/api/v1/staff/queues/${f.queue}`, {
    headers: f.headers,
    data: {
      ...summary.config,
      automaticAssignmentEnabled: true,
      version: summary.version,
      open: !!summary.open,
      graceMinutes: 1,
    },
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()

  for (const [name, partySize] of [
    ['Grupo inicial', 4],
    ['Grupo menor', 2],
    ['Primer grupo compatible', 3],
    ['Segundo grupo compatible', 3],
  ] as const) {
    const joined = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/entries`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          displayName: name,
          partySize,
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
    ).json()) as {
      id: string
      code: string
      status: string
      version: number
      arrivalDeadlineAt: number | null
      automaticReplacement: { result: string } | null
      automationCycle: { capacity: number | null; state: string } | null
    }[]
  const entries = await readEntries()

  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const drawer = page.getByRole('dialog', {
    name: 'Gestionar lista',
    exact: true,
  })
  await expect(drawer.getByText('Gestión automática pausada')).toBeVisible()
  await capture(page, 'restaurant', '01-configurada-sin-ciclos')

  const first = drawer.locator(`li[data-entry-code="${entries[0]!.code}"]`)
  await first
    .getByRole('button', { name: `Gestionar turno ${entries[0]!.code}` })
    .click()
  await page
    .getByRole('dialog', { name: 'Gestionar turno', exact: true })
    .getByRole('button', { name: 'Asignar próximo turno', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Asignar turno', exact: true }),
  ).toBeVisible()
  await capture(page, 'restaurant', '02-asignacion-manual')
  await page.keyboard.press('Escape')
  const called = await page.request.post(
    `/api/v1/staff/queues/${f.queue}/commands`,
    {
      headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        action: 'call',
        entryId: entries[0]!.id,
        version: entries[0]!.version,
        seating: { mode: 'confirmed', spaceId: 'terrace', seats: 4 },
      },
    },
  )
  expect(called.ok(), await called.text()).toBeTruthy()
  const initialDeadline = (await readEntries()).find(
    (entry) => entry.id === entries[0]!.id,
  )!.arrivalDeadlineAt!
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Gestionar lista', exact: true }).getByText(
      'Gestión automática activa',
    ),
  ).toBeVisible()
  await expect(
    page.getByText('1 asignación activa.', { exact: true }),
  ).toBeVisible()
  await capture(page, 'restaurant', '03-ciclo-activo')

  await page.goto('about:blank')
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, initialDeadline - Date.now()) + 300),
  )
  await expect
    .poll(async () => {
      const rows = await readEntries()
      return rows.find((entry) => entry.id === entries[2]!.id)?.status
    })
    .toBe('called')
  const afterExpiry = await readEntries()
  expect(afterExpiry.find((entry) => entry.id === entries[0]!.id)).toMatchObject({
    status: 'expired',
    automationCycle: { capacity: 4, state: 'active' },
    automaticReplacement: { result: 'replaced' },
  })
  expect(afterExpiry.find((entry) => entry.id === entries[1]!.id)?.status).toBe(
    'waiting',
  )
  expect(afterExpiry.find((entry) => entry.id === entries[2]!.id)).toMatchObject({
    status: 'called',
    automationCycle: { capacity: 4, state: 'active' },
  })

  await page.goto(dashboardUrl)
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Elige otro turno', exact: true }),
  ).toHaveCount(0)
  await capture(page, 'restaurant', '04-sustitucion-automatica-sin-decision')
  const successor = page.locator(`li[data-entry-code="${entries[2]!.code}"]`)
  await successor
    .getByRole('button', { name: `Gestionar turno ${entries[2]!.code}` })
    .click()
  await page
    .getByRole('dialog', { name: 'Gestionar turno', exact: true })
    .getByRole('button', { name: 'Confirmar llegada', exact: true })
    .click()
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/v1/staff/queues/${f.queue}/automation`,
      )
      return (await response.json()).activeCycles
    })
    .toBe(0)
  await capture(page, 'restaurant', '05-ciclo-finalizado')
})

test('captures opt-in surfaces and reception/pool automatic-assignment footers', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const owner = `owner_${suffix}`
  const sales = `sales_${suffix}`
  const password = 'arrival-screenshots-password-long'
  const headers = { Origin: baseURL! }
  const pilot = {
    'X-NoQueue-Pilot-Token': 'test-pilot-access-at-least-32-characters',
  }
  const identity = await request.post('/api/v1/experiments/local/staff/identity', {
    headers: pilot,
    data: { username: sales, password },
  })
  expect(identity.ok(), await identity.text()).toBeTruthy()
  const salesLogin = await request.post('/api/v1/auth/sign-in/username', {
    headers,
    data: { username: sales, password },
  })
  expect(salesLogin.ok(), await salesLogin.text()).toBeTruthy()

  const common = {
    capacity: 40,
    averageMinutes: 20,
    graceMinutes: 1,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    spaces: [],
    receptionServices: [],
  }
  const created = await request.post('/api/v1/staff/commercial/organizations', {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      ...(await resolveFixtureLocation(request, baseURL!)),
      organizationName: 'Arrival screenshot fixtures',
      slug: `arrival-screens-${suffix}`,
      venueName: 'Arrival Screenshot Hotel',
      timezone: 'Europe/Madrid',
      ownerName: 'Owner',
      ownerUsername: owner,
      ownerPassword: password,
      services: [
        {
          ...common,
          name: 'Restaurante',
          type: 'restaurant',
          spaces: [
            {
              id: 'terrace',
              name: 'Terraza',
              tables: 1,
              tableTypes: [{ seats: 4, count: 1 }],
            },
          ],
        },
        {
          ...common,
          name: 'Recepción',
          type: 'reception',
          stations: 2,
          receptionServices: ['check_in', 'check_out', 'other'],
        },
        { ...common, name: 'Bar piscina', type: 'pool' },
      ],
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { venueId } = (await created.json()) as { venueId: string }

  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Arrival Screenshot Hotel', exact: true }),
  ).toBeVisible()

  const queues = (await (
    await page.request.get(`/api/v1/staff/venues/${venueId}/queues`)
  ).json()) as VisualQueue[]
  for (const queue of queues) {
    const saved = await page.request.patch(`/api/v1/staff/queues/${queue.id}`, {
      headers,
      data: {
        ...queue.config,
        automaticAssignmentEnabled: true,
        version: queue.version,
        open: !!queue.open,
      },
    })
    expect(saved.ok(), await saved.text()).toBeTruthy()
  }
  const restaurant = queues.find((queue) => queue.config.type === 'restaurant')!
  const opening = await page.request.get(
    `/api/v1/staff/queues/${restaurant.id}/opening-context`,
  )
  const { contextToken } = (await opening.json()) as { contextToken: string }
  const opened = await page.request.post(
    `/api/v1/staff/queues/${restaurant.id}/lifecycle`,
    {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: { action: 'declare_full', contextToken },
    },
  )
  expect(opened.ok(), await opened.text()).toBeTruthy()
  await page.reload()

  const restaurantCard = page.getByRole('article', {
    name: 'Servicio Restaurante',
    exact: true,
  })
  await expect(
    restaurantCard.getByText('Gestión automática', { exact: true }),
  ).toBeVisible()
  await capture(page, 'opt-in', '01-badge-card-servicio')

  await restaurantCard
    .getByRole('button', { name: 'Opciones del servicio' })
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
  await expect(
    advanced.getByRole('switch', { name: 'Modo de gestión automática' }),
  ).toHaveAttribute('aria-checked', 'true')
  await capture(page, 'opt-in', '02-switch-configuracion')
  await advanced.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await config.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await config.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(config.getByText('Gestión automática activa')).toBeVisible()
  await capture(page, 'opt-in', '03-badge-resumen-configuracion')
  await config.getByRole('button', { name: 'Confirmar', exact: true }).click()

  for (const service of [
    {
      type: 'reception',
      name: 'Recepción',
      entryName: 'Recepción visual',
      receptionService: 'check_in',
      scenario: 'recepcion',
    },
    {
      type: 'pool',
      name: 'Bar piscina',
      entryName: 'Piscina visual',
      scenario: 'piscina',
    },
  ] as const) {
    const queue = queues.find((candidate) => candidate.config.type === service.type)!
    const entryResponse = await page.request.post(
      `/api/v1/staff/queues/${queue.id}/entries`,
      {
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          displayName: service.entryName,
          partySize: 1,
          locale: 'es',
          whatsapp: { consent: false },
          ...(service.type === 'reception'
            ? { receptionService: service.receptionService }
            : {}),
        },
      },
    )
    expect(entryResponse.ok(), await entryResponse.text()).toBeTruthy()
    await page.reload()
    const card = page.getByRole('article', {
      name: `Servicio ${service.name}`,
      exact: true,
    })
    await card.getByRole('button', { name: 'Ver lista', exact: true }).click()
    const drawer = page.getByRole('dialog', {
      name: 'Gestionar lista',
      exact: true,
    })
    await expect(drawer.getByText('Gestión automática pausada')).toBeVisible()
    await expect(
      drawer.getByRole('button', { name: 'Asignar próximo turno', exact: true }),
    ).toBeEnabled()
    await capture(page, service.scenario, '01-footer-pausado')
    await drawer
      .getByRole('button', { name: 'Asignar próximo turno', exact: true })
      .click()
    await expect(drawer.getByText('Gestión automática activa')).toBeVisible()
    await capture(page, service.scenario, '02-footer-activo')
    await page.keyboard.press('Escape')
  }
})

test('captures all reception call, cancel, pass, priority and expiry Figma states in mobile and desktop viewports', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await setup(page, request, baseURL!, 'reception')
  const queues = (await (
    await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
  ).json()) as VisualQueue[]
  const queue = queues.find((candidate) => candidate.id === f.queue)!
  const configured = await page.request.patch(`/api/v1/staff/queues/${f.queue}`, {
    headers: f.headers,
    data: {
      ...queue.config,
      automaticAssignmentEnabled: true,
      receptionServices: ['check_in', 'check_out', 'other'],
      graceMinutes: 1,
      version: queue.version,
      open: !!queue.open,
    },
  })
  expect(configured.ok(), await configured.text()).toBeTruthy()

  const names = [
    ['Inicio visual', 'check_in'],
    ['Segundo compatible', 'check_in'],
    ['Tercero compatible', 'check_in'],
    ['Check-out distinto', 'check_out'],
    ['Prioridad visual', 'check_in'],
    ['Espera para expiración', 'check_in'],
  ] as const
  for (const [displayName, receptionService] of names) {
    const joined = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/entries`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          displayName,
          partySize: 1,
          receptionService,
          locale: 'es',
          whatsapp: { consent: false },
        },
      },
    )
    expect(joined.ok(), await joined.text()).toBeTruthy()
  }
  type ReceptionEntry = {
    id: string
    code: string
    displayName: string
    version: number
    status: string
    arrivalDeadlineAt: number | null
  }
  const readEntries = async () =>
    (await (
      await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)
    ).json()) as ReceptionEntry[]
  const manage = async (code: string) => {
    await page
      .locator(`li[data-entry-code="${code}"]`)
      .getByRole('button', { name: `Gestionar turno ${code}` })
      .click()
    return page.getByRole('dialog', { name: 'Gestionar turno', exact: true })
  }

  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Gestionar lista', exact: true })
  let entries = await readEntries()
  const first = entries.find((entry) => entry.displayName === 'Inicio visual')!
  const second = entries.find((entry) => entry.displayName === 'Segundo compatible')!
  const third = entries.find((entry) => entry.displayName === 'Tercero compatible')!
  const outOfSubtype = entries.find((entry) => entry.displayName === 'Check-out distinto')!
  const priority = entries.find((entry) => entry.displayName === 'Prioridad visual')!
  const expiryWaiting = entries.find((entry) => entry.displayName === 'Espera para expiración')!

  const waitingOtherManage = await manage(second.code)
  await expect(
    waitingOtherManage.getByRole('button', {
      name: 'Priorizar para siguiente turno',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    waitingOtherManage.getByRole('button', { name: 'Pasar turno', exact: true }),
  ).toHaveCount(0)
  await captureFigmaNode(page, '1822-34572')
  await waitingOtherManage.getByRole('button', { name: 'Volver', exact: true }).click()

  await manage(first.code)
  await expect(
    page
      .getByRole('dialog', { name: 'Gestionar turno', exact: true })
      .getByRole('button', { name: 'Asignar próximo turno', exact: true }),
  ).toBeVisible()
  await captureFigmaNode(page, '1826-35806')
  await page
    .getByRole('dialog', { name: 'Gestionar turno', exact: true })
    .getByRole('button', { name: 'Volver', exact: true })
    .click()

  await drawer.getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
  const callToast = page.getByText('Turno asignado. Seguimiento automático activo.', { exact: true })
  await expect(callToast).toHaveCount(1)
  await captureFigmaNode(page, '1826-37115', true)
  // Reload clears the transient call toast without replaying historical feedback.
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  entries = await readEntries()
  const calledFirst = entries.find((entry) => entry.id === first.id)!
  expect(calledFirst.status).toBe('called')
  const firstRow = page.locator(`li[data-entry-code="${first.code}"]`)
  await expect(firstRow.getByText('Automático · Intento 1')).toBeVisible()
  await captureFigmaNode(page, '1826-36227')

  const calledManage = await manage(first.code)
  await captureFigmaNode(page, '1822-34635')
  await calledManage.getByRole('button', { name: 'Cancelar turno', exact: true }).click()
  const cancelConfirm = page.getByRole('dialog', {
    name: '¿Confirmas que quieres cancelar el turno?',
    exact: true,
  })
  await captureFigmaNode(page, '1822-34669')
  await cancelConfirm.getByRole('button', { name: 'Cancelar turno', exact: true }).click()
  const cancelToast = page.getByText('Turno cancelado. El ciclo ha finalizado.', { exact: true })
  await expect(cancelToast).toHaveCount(1)
  await captureFigmaNode(page, '1826-36886', true)

  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const activeDrawer = page.getByRole('dialog', { name: 'Gestionar lista', exact: true })
  await activeDrawer.getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
  await expect(page.getByText('Turno asignado. Seguimiento automático activo.', { exact: true })).toHaveCount(1)
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  entries = await readEntries()
  const calledSecond = entries.find((entry) => entry.id === second.id)!
  expect(calledSecond.status).toBe('called')
  const secondManage = await manage(second.code)
  await secondManage.getByRole('button', { name: 'Pasar turno', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Pasar turno', exact: true })
    .getByRole('button', { name: 'Pasar turno', exact: true })
    .click()
  const passToast = page.getByText('Turno pasado. Hemos avisado a Tercero compatible.', { exact: true })
  await expect(passToast).toHaveCount(1)
  await captureFigmaNode(page, '1826-37281', true)
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const thirdManage = await manage(third.code)
  await thirdManage.getByRole('button', { name: 'Confirmar llegada', exact: true }).click()
  await expect.poll(async () => (await readEntries()).find((entry) => entry.id === third.id)?.status).toBe('completed')
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()

  const priorityManage = await manage(priority.code)
  await priorityManage
    .getByRole('button', { name: 'Priorizar para siguiente turno', exact: true })
    .click()
  const priorityConfirm = page.getByRole('dialog', {
    name: 'Priorizar para el siguiente turno',
    exact: true,
  })
  await captureFigmaNode(page, '1822-34597')
  await priorityConfirm.getByRole('button', { name: 'Confirmar', exact: true }).click()
  const priorityToast = page.getByText(
    'Prioridad visual tendrá prioridad en la siguiente asignación disponible.',
    { exact: true },
  )
  await expect(priorityToast).toHaveCount(1)
  await captureFigmaNode(page, '1826-37158', true)

  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const priorityRowManage = await manage(priority.code)
  await priorityRowManage.getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Asignar turno', exact: true })
    .click()
  entries = await readEntries()
  const calledPriority = entries.find((entry) => entry.id === priority.id)!
  expect(calledPriority.status).toBe('called')
  const expiryDeadline = calledPriority.arrivalDeadlineAt!
  const staleCalledSnapshot = await readEntries()
  expect(staleCalledSnapshot.find((entry) => entry.id === priority.id)?.status).toBe('called')
  // Keep the staff UI's already-open call snapshot stale while the real Worker
  // expires the deadline and assigns the successor. The following arrival
  // confirmation must then surface the automatic-processing conflict.
  await page.route(
    `**/api/v1/staff/queues/${f.queue}/entries`,
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(staleCalledSnapshot),
      }),
  )
  await expect.poll(async () => (await readEntries()).find((entry) => entry.id === priority.id)?.status, { timeout: 85_000 }).toBe('expired')
  const expiryToast = page.getByText(
    'El turno de Prioridad visual ha expirado. Se ha avisado a Segundo compatible.',
    { exact: true },
  )
  await expect(expiryToast).toHaveCount(1, { timeout: 85_000 })
  expect(expiryDeadline).toBeGreaterThan(Date.now() - 90_000)
  await captureFigmaNode(page, '1861-33817', true)
  const stalePriorityManage = await manage(priority.code)
  await stalePriorityManage
    .getByRole('button', { name: 'Confirmar llegada', exact: true })
    .click()
  const processedConflict = page.getByRole('dialog', {
    name: 'Turno ya procesado',
    exact: true,
  })
  await expect(processedConflict).toBeVisible()
  await expect(
    processedConflict.getByText(
      'El sistema ya ha asignado este turno y ha avisado al siguiente cliente. La cola se actualizará automáticamente.',
      { exact: true },
    ),
  ).toBeVisible()
  await captureFigmaNode(page, '1822-34622')
  expect((await readEntries()).find((entry) => entry.id === outOfSubtype.id)?.status).toBe('waiting')
  expect((await readEntries()).find((entry) => entry.id === second.id)?.status).toBe('called')
  expect((await readEntries()).find((entry) => entry.id === expiryWaiting.id)?.status).toBe('waiting')
})

test('captures older compatible selection and stale conflict Figma states in mobile and desktop viewports', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await setup(page, request, baseURL!, 'restaurant')
  for (const entry of [
    { displayName: 'Candidato anterior de tres', partySize: 3 },
    { displayName: 'Candidato anterior de dos', partySize: 2 },
    { displayName: 'Asignación para cuatro', partySize: 4 },
  ]) {
    const response = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/entries`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          ...entry,
          locale: 'es',
          whatsapp: { consent: false },
        },
      },
    )
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  const entries = (await (
    await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)
  ).json()) as {
    id: string
    code: string
    displayName: string
    version: number
    status: string
  }[]
  const older = entries.find((entry) => entry.displayName === 'Candidato anterior de tres')!
  const secondOlder = entries.find((entry) => entry.displayName === 'Candidato anterior de dos')!
  const target = entries.find((entry) => entry.displayName === 'Asignación para cuatro')!
  await page.reload()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Gestionar lista', exact: true })
  await expect(drawer.getByText('Asignación para cuatro', { exact: true })).toBeVisible()

  await page.route(
    `**/api/v1/staff/queues/${f.queue}/entries`,
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(entries),
      }),
  )
  const targetRow = page.locator(`li[data-entry-code="${target.code}"]`)
  await targetRow.getByRole('button', { name: `Gestionar turno ${target.code}` }).click()
  await page
    .getByRole('dialog', { name: 'Gestionar turno', exact: true })
    .getByRole('button', { name: 'Asignar próximo turno', exact: true })
    .click()
  const warning = page.getByRole('dialog', {
    name: 'Hay turnos esperando desde antes',
    exact: true,
  })
  await expect(warning).toBeVisible()
  const earlierCandidates = warning.getByRole('list', {
    name: 'Turnos compatibles anteriores',
  })
  await expect(earlierCandidates.getByText('Candidato anterior de tres')).toBeVisible()
  await expect(earlierCandidates.getByText('Candidato anterior de dos')).toBeVisible()
  const confirmSelection = warning.getByRole('button', {
    name: 'Confirmar',
    exact: true,
  })
  const confirmBox = await confirmSelection.boundingBox()
  expect(confirmBox).not.toBeNull()
  expect(confirmBox!.y).toBeGreaterThanOrEqual(0)
  expect(confirmBox!.y + confirmBox!.height).toBeLessThanOrEqual(844)
  await captureFigmaNode(page, '1826-37166')
  await warning
    .getByRole('list', { name: 'Turnos compatibles anteriores' })
    .getByRole('button', { name: 'Asignar →', exact: true })
    .first()
    .click()
  const assignment = page.getByRole('dialog', {
    name: 'Asignar turno',
    exact: true,
  })
  await expect(assignment.getByText('Candidato anterior de tres', { exact: true })).toBeVisible()

  const competed = await page.request.post(
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
  expect(competed.ok(), await competed.text()).toBeTruthy()
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/queues/${f.queue}/commands`) &&
      response.request().method() === 'POST',
  )
  await assignment.getByRole('button', { name: 'Asignar turno', exact: true }).click()
  expect((await responsePromise).status()).toBe(409)
  await expect(assignment.getByRole('alert')).toBeVisible()
  expect((await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`).then((r) => r.json()) as typeof entries).find((entry) => entry.id === secondOlder.id)?.status).toBe('waiting')
})
