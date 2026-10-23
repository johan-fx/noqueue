import {
  resolveFixtureLocation,
  confirmFixtureLocation,
} from '../helpers/location.js'
import {
  setup as setupQueue,
} from '../helpers/queue-actions.js'
import {
  clientIpAddress,
  newClientContext,
  test,
  expect,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '../fixtures.js'

type FixtureService = {
  name: string
  type: 'restaurant'
  capacity: number
  averageMinutes: number
  graceMinutes: number
  cutoffMinutes: number
  twentyFourHours: boolean
  schedules: never[]
  receptionServices: never[]
  assignmentPreference: 'fastest'
  spaces: {
    id: string
    name: string
    tables: number
    tableTypes: { seats: number; count: number; averageMinutes: number }[]
  }[]
}

const pilot = 'test-pilot-access-at-least-32-characters'
const password = 'e2e-only-password-12345'

function restaurantService(
  spaces: FixtureService['spaces'] = [
    {
      id: 'terrace',
      name: 'Terrace',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1, averageMinutes: 35 }],
    },
  ],
): FixtureService {
  return {
    name: 'Restaurant E2E',
    type: 'restaurant',
    capacity: 99,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: [],
    assignmentPreference: 'fastest',
    spaces,
  }
}

function fourSpaceService() {
  return restaurantService([
    {
      id: 'terrace',
      name: 'Terrace',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1, averageMinutes: 35 }],
    },
    {
      id: 'salon',
      name: 'Salon',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1, averageMinutes: 25 }],
    },
    {
      id: 'patio',
      name: 'Patio exterior junto a la piscina',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }],
    },
    {
      id: 'events',
      name: 'Sala para eventos privados',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }],
    },
  ])
}

async function provisionVenue(
  request: APIRequestContext,
  origin: string,
  service: FixtureService = restaurantService(),
) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  const sales = 'sales_' + suffix
  const owner = 'owner_' + suffix
  const seed = await request.post('/api/v1/experiments/local/staff/identity', {
    headers: { 'X-NoQueue-Pilot-Token': pilot },
    data: { username: sales, password },
  })
  expect(seed.ok(), await seed.text()).toBeTruthy()
  const login = await request.post('/api/v1/auth/sign-in/username', {
    headers: { Origin: origin },
    data: { username: sales, password },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const response = await request.post(
    '/api/v1/staff/commercial/organizations',
    {
      headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        ...(await resolveFixtureLocation(request, origin)),
        organizationName: 'Staff test ' + suffix,
        slug: 'staff-test-' + suffix,
        venueName: 'Staff Venue ' + suffix,
        timezone: 'Europe/Madrid',
        ownerName: 'Owner E2E',
        ownerUsername: owner,
        ownerPassword: password,
        services: [service],
      },
    },
  )
  expect(response.ok(), await response.text()).toBeTruthy()
  const { venueId } = (await response.json()) as { venueId: string }
  return {
    owner,
    password,
    suffix,
    venueId,
    venueName: 'Staff Venue ' + suffix,
  }
}

async function signInOwner(
  page: Page,
  owner: string,
  ownerPassword: string,
  venueName: string,
) {
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(owner)
  await page.getByLabel('Contraseña', { exact: true }).fill(ownerPassword)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: venueName, exact: true }),
  ).toBeVisible()
}

async function openServiceConfig(page: Page) {
  await page
    .getByRole('button', { name: 'Opciones del servicio' })
    .first()
    .click()
  await page
    .getByRole('menuitem', { name: 'Configurar servicio', exact: true })
    .click()
  return page.getByRole('dialog', {
    name: 'Configuración restaurante',
    exact: true,
  })
}

async function openServiceAdvanced(page: Page) {
  const drawer = await openServiceConfig(page)
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer
    .getByRole('button', { name: 'Configuración avanzada', exact: true })
    .click()
  return {
    drawer,
    advanced: page.getByRole('dialog', {
      name: 'Configuración avanzada',
      exact: true,
    }),
  }
}

test.describe('commercial provisioning save retry', () => {
  test.use({ serviceWorkers: 'block' })

  test('sales provisions an owner account that can sign in directly', async ({
    page,
    request,
  }, testInfo) => {
    // This full wizard/retry/reload/two-login journey takes ~30s in CI WebKit.
    // Keep assertion deadlines unchanged; budget the whole journey explicitly.
    test.setTimeout(60_000)
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 18)
    const sales = 'sales_' + suffix
    const owner = 'owner_' + suffix
    const seed = await request.post('/api/v1/experiments/local/staff/identity', {
      headers: { 'X-NoQueue-Pilot-Token': pilot },
      data: { username: sales, password },
    })
    expect(seed.ok(), await seed.text()).toBeTruthy()
    await page.goto('/login')
    await page.getByLabel('Usuario o email').fill(sales)
    await page.getByLabel('Contraseña', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Administración', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('tab', { name: 'Establecimientos', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Crear nuevo' }).click()
    await expect(
      page.getByRole('heading', {
        name: 'Cliente y administrador',
        exact: true,
      }),
    ).toBeVisible()
    await page.getByLabel('Empresa / organización').fill('Borrador cancelado')
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByRole('cell', { name: 'Borrador cancelado' }),
    ).toHaveCount(0)

    await page.getByRole('button', { name: 'Crear nuevo' }).click()
    await expect(page.getByLabel('Empresa / organización')).toHaveValue('')
    await page.getByLabel('Empresa / organización').fill('Hotel E2E')
    await expect(
      page.getByLabel('Identificador único (sin espacios)'),
    ).toHaveCount(0)
    await expect(page.getByLabel('Zona horaria IANA')).toHaveCount(0)
    await page
      .getByLabel('Hotel / establecimiento', { exact: true })
      .fill('Hotel Madrid E2E')
    await page.getByLabel('Nombre del administrador').fill('Owner E2E')
    await page.getByLabel('Usuario del administrador').fill(owner)
    await page
      .getByLabel('Contraseña inicial (mínimo 15 caracteres)')
      .fill(password)
    await page.getByLabel('Confirmar contraseña').fill(password)
    await confirmFixtureLocation(page)
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()

    const creationService = page.getByRole('dialog', {
      name: 'Configuración restaurante',
    })
    await expect(creationService).toBeVisible()
    await page.getByLabel('Nombre del servicio').fill('Restaurante E2E')
    const serviceBack = creationService.getByRole('button', {
      name: 'Volver', exact: true,
    })
    // WebKit can briefly report a stable but partially clipped button while the
    // drawer enters. Wait for the full hit target, not just DOM visibility.
    await expect(serviceBack).toBeInViewport({ ratio: 1 })
    await serviceBack.click()
    await expect(creationService).toBeHidden()
    await expect(page.getByLabel('Usuario del administrador')).toHaveValue(owner)
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await creationService
      .getByLabel('Nombre del servicio')
      .fill('Restaurante E2E')
    const openingSchedule = creationService.getByRole('region', {
      name: 'Horario 1',
      exact: true,
    })
    for (const day of [
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ]) {
      const dayButton = openingSchedule.getByRole('button', {
        name: day,
        exact: true,
      })
      if ((await dayButton.getAttribute('aria-pressed')) !== 'true')
        await dayButton.click()
      await expect(dayButton).toHaveAttribute('aria-pressed', 'true')
    }
    const allDay = openingSchedule.getByRole('switch', {
      name: 'Abierto 24 horas',
      exact: true,
    })
    if ((await allDay.getAttribute('aria-checked')) !== 'true')
      await allDay.click()
    await expect(allDay).toHaveAttribute('aria-checked', 'true')
    await openingSchedule.getByRole('button', { name: 'Listo', exact: true }).click()
    await creationService.getByRole('button', { name: 'Siguiente' }).click()
    await creationService
      .getByRole('button', { name: 'Configuración avanzada' })
      .click()
    const spaceConfig = page.getByRole('dialog', {
      name: 'Configuración avanzada',
    })
    await spaceConfig
      .getByRole('button', { name: 'De 4', exact: true })
      .click()
    await spaceConfig
      .getByRole('button', { name: 'Confirmar', exact: true })
      .click()
    await expect(spaceConfig).toHaveCount(0)
    for (let step = 0; step < 3; step++)
      await creationService.getByRole('button', { name: 'Siguiente' }).click()

    await page.setViewportSize({ width: 390, height: 844 })
    const save = creationService.getByRole('button', {
      name: 'Confirmar',
      exact: true,
    })
    await expect(save).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath('commercial-drawer-mobile.png'),
      fullPage: true,
    })

    let firstKey = ''
    let organizationPosts = 0
    await page.route(
      '**/api/v1/staff/commercial/organizations',
      async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        const body = route.request().postDataJSON() as {
          services: {
            scheduleGroups: { days: number[]; twentyFourHours: boolean }[]
          }[]
        }
        expect(body.services[0]!.scheduleGroups).toHaveLength(1)
        const schedule = body.services[0]!.scheduleGroups[0]!
        expect([...schedule.days].sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
        expect(schedule.twentyFourHours).toBe(true)
        organizationPosts++
        if (!firstKey) {
          firstKey = route.request().headers()['idempotency-key']!
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'temporarily_unavailable' }),
          })
        }
        expect(route.request().headers()['idempotency-key']).toBe(firstKey)
        await route.continue()
      },
    )
    await save.click()
    await expect(creationService.getByRole('alert')).toContainText(
      'Servicio temporalmente no disponible',
    )
    await expect(creationService).toBeVisible()
    await save.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(organizationPosts).toBe(2)
    await expect(
      page.getByRole('link', { name: /Hotel Madrid E2E/ }),
    ).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Establecimiento creado')

    const createdVenue = page.getByRole('link', { name: /Hotel Madrid E2E/ })
    const detailUrl = new URL((await createdVenue.getAttribute('href'))!, page.url()).href
    await createdVenue.click()
    await expect(page).toHaveURL(detailUrl)
    await expect(
      page.getByRole('heading', { name: 'Hotel Madrid E2E', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Opciones del servicio' }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Opciones del servicio' }),
    ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('commercial-created-venue.png'),
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
    const signedOut = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/auth/sign-out' &&
        response.request().method() === 'POST',
    )
    await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
    expect((await signedOut).ok()).toBe(true)
    // Do not interrupt the asynchronous logout with signInOwner's navigation.
    await expect(page).toHaveURL(/\/login$/)
    await signInOwner(page, owner, password, 'Hotel Madrid E2E')
    await expect(
      page.getByRole('button', { name: 'Opciones del servicio' }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Listado de servicios' }).getByRole('article'),
    ).toHaveCount(1)
  })
})

test('owner manages nested staff access, roles and password recovery', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  const venue = await provisionVenue(request, baseURL!)
  await signInOwner(page, venue.owner, venue.password, venue.venueName)

  await page.getByRole('button', { name: 'Accesos', exact: true }).click()
  const accessDrawer = page.getByRole('dialog', { name: 'Gestionar accesos' })
  await expect(accessDrawer).toBeVisible()
  await expect(accessDrawer.getByText(venue.owner, { exact: true })).toBeVisible()
  await accessDrawer
    .getByRole('button', { name: 'Añadir usuario', exact: true })
    .click()
  const createDrawer = page.getByRole('dialog', {
    name: 'Crear usuario',
    exact: true,
  })
  await expect(createDrawer).toBeVisible()
  await createDrawer.getByLabel('Nombre', { exact: true }).fill('Personal E2E')
  await createDrawer
    .getByLabel('Usuario', { exact: true })
    .fill('staff_' + venue.suffix)
  await createDrawer
    .getByLabel('Contraseña inicial (mínimo 15 caracteres)')
    .fill(venue.password)
  await createDrawer
    .getByRole('combobox', { name: 'Servicios a gestionar' })
    .click()
  await page.getByRole('option', { name: 'Restaurant E2E', exact: true }).click()
  await page.getByRole('combobox', { name: 'Buscar servicios' }).press('Escape')
  await createDrawer
    .getByRole('button', { name: 'Crear acceso', exact: true })
    .click()
  await expect(createDrawer).toHaveCount(0)
  await expect(accessDrawer).toBeVisible()
  const memberRow = accessDrawer
    .getByRole('row')
    .filter({ hasText: 'Personal E2E' })
  await expect(memberRow).toBeVisible()
  await memberRow
    .getByRole('button', { name: 'Acciones de Personal E2E' })
    .click()
  await page.getByRole('menuitem', { name: 'Revocar acceso' }).click()
  await expect(
    memberRow.getByText('Acceso revocado', { exact: true }),
  ).toBeVisible()
  await memberRow
    .getByRole('button', { name: 'Acciones de Personal E2E' })
    .click()
  await page.getByRole('menuitem', { name: 'Restaurar acceso' }).click()
  await expect(
    memberRow.getByText('Acceso revocado', { exact: true }),
  ).toHaveCount(0)
  await memberRow
    .getByRole('button', { name: 'Acciones de Personal E2E' })
    .click()
  await page.getByRole('menuitem', { name: 'Restablecer contraseña' }).click()
  const resetDialog = page.getByRole('dialog', {
    name: 'Restablecer contraseña',
  })
  await expect(resetDialog).toBeVisible()
  await resetDialog
    .getByLabel('Nueva contraseña (mínimo 15 caracteres)')
    .fill('reset-staff-e2e-password-12345')
  await resetDialog
    .getByRole('button', { name: 'Confirmar restablecimiento' })
    .click()
  await expect(resetDialog).toHaveCount(0)
  await expect(accessDrawer).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    accessDrawer.getByRole('button', { name: 'Cerrar', exact: true }),
  ).toBeInViewport()
  await page.screenshot({
    path: testInfo.outputPath('access-drawer-mobile.png'),
    fullPage: true,
  })
  await accessDrawer
    .getByRole('button', { name: 'Cerrar', exact: true })
    .click()
  await expect(accessDrawer).toHaveCount(0)
  await expect(page.getByLabel('Usuario', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Accesos', exact: true }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Accesos', exact: true }).click()
  await expect(accessDrawer.getByLabel('Usuario', { exact: true })).toHaveCount(0)
  await expect(
    accessDrawer.getByText('staff_' + venue.suffix, { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(accessDrawer).toHaveCount(0)
})

test.describe('service setup retry and persistence', () => {
  test.use({ serviceWorkers: 'block' })

  test('owner can add services and retry a failed configuration save', async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    const venue = await provisionVenue(request, baseURL!)
    await signInOwner(page, venue.owner, venue.password, venue.venueName)
    const services = page.getByRole('region', { name: 'Listado de servicios' })
    await expect(services.getByRole('article')).toHaveCount(1)

    const addService = page.getByRole('button', {
      name: 'Añadir servicio',
      exact: true,
    })
    await addService.click()
    const newService = page.getByRole('dialog', {
      name: 'Configuración restaurante',
      exact: true,
    })
    await newService.getByLabel('Nombre del servicio').fill('Borrador')
    await newService.getByRole('button', { name: 'Volver', exact: true }).click()
    await expect(newService).toHaveCount(0)
    await expect(services.getByRole('article')).toHaveCount(1)
    await addService.click()
    await expect(newService.getByLabel('Nombre del servicio')).toHaveValue('')
    await newService
      .getByRole('button', { name: 'Siguiente', exact: true })
      .click()
    await expect(newService).toBeVisible()
    await newService
      .getByLabel('Nombre del servicio')
      .fill('Segundo restaurante')
    for (let step = 0; step < 4; step++)
      await newService
        .getByRole('button', { name: 'Siguiente', exact: true })
        .click()
    await newService
      .getByRole('button', { name: 'Confirmar', exact: true })
      .click()
    await expect(newService).toHaveCount(0)
    await expect(services.getByRole('article')).toHaveCount(2)
    await expect(
      services.getByRole('article', { name: 'Servicio Segundo restaurante' }),
    ).toBeVisible()

    const restaurant = services.getByRole('article', {
      name: 'Servicio Restaurant E2E',
    })
    const configDrawer = await openServiceConfig(page)
    await expect(configDrawer.getByLabel('Nombre del servicio')).toHaveValue(
      'Restaurant E2E',
    )
    await configDrawer
      .getByLabel('Nombre del servicio')
      .fill('Borrador cancelado')
    await configDrawer.getByRole('button', { name: 'Volver' }).click()
    await expect(configDrawer).toHaveCount(0)

    await expect(restaurant.getByText('Servicio abierto')).toBeVisible()
    await restaurant.getByRole('switch', { name: 'Activar lista' }).click()
    await expect(
      restaurant.getByRole('switch', { name: 'Cerrar lista' }),
    ).toBeChecked()
    const config = await openServiceConfig(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: testInfo.outputPath('service-config-mobile.png'),
      fullPage: true,
    })
    await config.getByRole('button', { name: 'Siguiente' }).click()
    await config.getByRole('button', { name: 'Siguiente' }).click()
    await config
      .getByLabel('Intervalo inicial estimado entre turnos')
      .fill('45')
    for (let step = 0; step < 2; step++)
      await config.getByRole('button', { name: 'Siguiente' }).click()

    const queueConfigRoute = '**/api/v1/staff/queues/*'
    let patchHits = 0
    await page.route(queueConfigRoute, async (route) => {
      if (route.request().method() === 'PATCH') {
        patchHits++
        if (patchHits === 1) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'temporary_failure' }),
          })
          return
        }
      }
      await route.continue()
    })
    await page.getByRole('button', { name: 'Confirmar' }).click()
    await expect(config.getByRole('alert')).toBeVisible()
    expect(patchHits).toBe(1)
    await expect(
      config.getByText('Intervalo inicial estimado entre turnos: 45 min'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Confirmar' }).click()
    await expect(config).toHaveCount(0)
    await expect.poll(() => patchHits).toBe(2)
    await page.unroute(queueConfigRoute)

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.reload()
    const reopened = await openServiceConfig(page)
    await reopened.getByRole('button', { name: 'Siguiente' }).click()
    await reopened.getByRole('button', { name: 'Siguiente' }).click()
    await expect(
      reopened.getByLabel('Intervalo inicial estimado entre turnos'),
    ).toHaveValue('45')
  })
})

test('owner can assign from the queue without releasing inventory and arrival finalizes the turn', async ({
  page,
  request,
  browser,
  baseURL,
}, testInfo) => {
  const { queue, venueId } = await setupQueue(page, request, baseURL!, 'restaurant')
  const initialContextResponse = await page.request.get(
    '/api/v1/staff/queues/' + queue + '/opening-context',
  )
  expect(initialContextResponse.ok()).toBeTruthy()
  const initialContext = (await initialContextResponse.json()) as {
    contextToken: string
  }
  expect(initialContext.contextToken).toBeTruthy()

  const queueDrawer = page.getByRole('dialog', {
    name: 'Gestionar lista',
    exact: true,
  })
  const occupiedPoll = await page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes(`/api/v1/staff/queues/${queue}/entries`) &&
      response.ok(),
  )
  expect(await occupiedPoll.json()).toEqual([])
  const guestIp = clientIpAddress(testInfo, 'staff-lifecycle-guest')
  const guestContext = await newClientContext(
    browser,
    testInfo,
    'staff-lifecycle-guest',
    { baseURL: baseURL!, viewport: { width: 390, height: 844 } },
  )
  try {
    const guestJoin = await request.post(
      `/api/v1/public/services/${queue}/entries`,
      {
        headers: {
          Origin: baseURL!,
          'CF-Connecting-IP': guestIp,
          'Idempotency-Key': crypto.randomUUID(),
        },
        data: {
          displayName: 'Cliente Staff E2E',
          partySize: 1,
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
    expect(guestJoin.ok()).toBeTruthy()
    const { recoveryToken } = (await guestJoin.json()) as {
      recoveryToken: string
    }
    expect(recoveryToken).toMatch(/^[a-f0-9]{64}$/)
    const guest = await guestContext.newPage()
    await guest.goto(`/t/${recoveryToken}`)
    await expect(
      guest.getByRole('progressbar').getByText(/^minutos:segundos\s*provisional$/),
    ).toBeVisible()
    const provisional = await guest.request.get(`/api/v1/public/entries/${recoveryToken}`)
    expect(await provisional.json()).toMatchObject({
      etaMinutes: 50,
      estimateQuality: 'provisional',
      customer: { phase: 'waiting' },
    })
    await page.waitForResponse(async (response) => {
      if (
        response.request().method() !== 'GET' ||
        !response.url().includes(`/api/v1/staff/queues/${queue}/entries`) ||
        !response.ok()
      )
        return false
      const rows = (await response.json()) as {
        displayName?: string
        status?: string
        assignment?: { available?: boolean }
      }[]
      return rows.some(
        (entry) =>
          entry.displayName === 'Cliente Staff E2E' &&
          entry.status === 'waiting' &&
          entry.assignment?.available === true,
      )
    })
    await expect(
      queueDrawer.getByText('Cliente Staff E2E', { exact: true }),
    ).toBeVisible()

    const staffEntryRow = queueDrawer
      .locator('li')
      .filter({ hasText: 'Cliente Staff E2E' })
    await staffEntryRow
      .getByRole('button', { name: /^Gestionar turno/ })
      .click()
    await page
      .getByRole('dialog', { name: 'Gestionar turno', exact: true })
      .getByRole('button', { name: 'Asignar próximo turno', exact: true })
      .click()
    const assignment = page.getByRole('dialog', {
      name: 'Asignar turno',
      exact: true,
    })
    const confirmAssignment = assignment.getByRole('button', {
      name: 'Asignar turno',
      exact: true,
    })
    await expect(confirmAssignment).toBeEnabled()
    await confirmAssignment.click()
    await expect(
      queueDrawer.getByText('Pendiente de llegada', { exact: true }),
    ).toBeVisible()
    const assignedSnapshot = (await (
      await guest.request.get(`/api/v1/public/entries/${recoveryToken}`)
    ).json()) as { customer?: { arrivalDeadlineAt?: number | null } }
    const originalArrivalDeadline = assignedSnapshot.customer?.arrivalDeadlineAt
    expect(originalArrivalDeadline).toEqual(expect.any(Number))

    await guest.reload()
    await expect(guest.getByRole('heading', { name: '¡Es tu turno!' })).toBeVisible()
    await expect(guest.getByText('Acércate al restaurante.')).toBeVisible()
    const reloadedSnapshot = (await (
      await guest.request.get(`/api/v1/public/entries/${recoveryToken}`)
    ).json()) as { customer?: { arrivalDeadlineAt?: number | null } }
    expect(reloadedSnapshot.customer?.arrivalDeadlineAt).toBe(
      originalArrivalDeadline,
    )
    await staffEntryRow
      .getByRole('button', { name: /^Gestionar turno/ })
      .click()
    await page
      .getByRole('dialog', { name: 'Gestionar turno', exact: true })
      .getByRole('button', { name: 'Confirmar llegada', exact: true })
      .click()
    await queueDrawer
      .getByRole('tab', { name: 'Completados', exact: true })
      .click()
    await expect(
      queueDrawer.getByRole('tab', { name: 'Completados', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(queueDrawer.getByText('Completado', { exact: true })).toBeVisible()
    await guest.reload()
    await expect(
      guest.getByRole('heading', { name: 'Se ha confirmado tu llegada' }),
    ).toBeVisible()

    await queueDrawer.getByRole('tab', { name: 'Cancelados', exact: true }).click()
    await expect(
      queueDrawer.getByText('No hay turnos cancelados ni ausentes.'),
    ).toBeVisible()
    await queueDrawer.getByRole('tab', { name: 'Lista', exact: true }).click()
    await expect(
      queueDrawer
        .getByRole('list', { name: 'Lista de espera' })
        .getByRole('listitem'),
    ).toHaveCount(0)
    await queueDrawer.getByRole('button', { name: 'Volver', exact: true }).click()
    await expect(queueDrawer).toHaveCount(0)
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('queue-completed.png'),
      fullPage: true,
    })
  } finally {
    await guestContext.close()
  }
})

test('owner updates account details, verifies a new email and changes password', async ({
  page,
  request,
  baseURL,
}) => {
  const venue = await provisionVenue(request, baseURL!)
  await signInOwner(page, venue.owner, venue.password, venue.venueName)
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ajustes', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Cambiar email', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Nombre', { exact: true }).fill('Owner Updated')
  await page.getByRole('button', { name: 'Guardar cambios' }).first().click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Cambios guardados.' }),
  ).toBeVisible()
  const newEmail = 'real-' + venue.suffix + '@example.com'
  await page.getByLabel('Email', { exact: true }).fill(newEmail)
  await page.getByRole('button', { name: 'Guardar cambios' }).last().click()
  await expect(
    page.getByText('Revisa el nuevo email', { exact: false }),
  ).toBeVisible()
  const mail = await request.get(
    '/api/v1/experiments/local/staff/mail?email=' + encodeURIComponent(newEmail),
    { headers: { 'X-NoQueue-Pilot-Token': pilot } },
  )
  expect(mail.ok(), await mail.text()).toBeTruthy()
  const mailContent = (await mail.json()) as { text: string }
  const verificationURL = mailContent.text.match(/http:\/\/[^\s]+/)?.[0]
  expect(verificationURL).toBeTruthy()
  expect(new URL(verificationURL!).pathname).toBe('/api/v1/auth/verify-email')
  await page.goto(verificationURL!)
  await expect(page).toHaveURL(/\/settings\/account/)
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(newEmail)

  await page.getByRole('tab', { name: /seguridad/i }).click()
  await page.getByLabel('Contraseña actual', { exact: true }).fill(venue.password)
  const nextPassword = 'changed-e2e-password-12345'
  await page.getByLabel('Nueva contraseña', { exact: true }).fill(nextPassword)
  await page.getByLabel('Confirmar contraseña', { exact: true }).fill(nextPassword)
  await page
    .getByRole('tabpanel', { name: 'Seguridad' })
    .getByRole('button', { name: 'Guardar cambios' })
    .click()
  await expect(
    page.getByText('Cambios guardados.', { exact: true }),
  ).toBeVisible()
})

test('settings requires authentication', async ({ page }) => {
  await page.goto('/settings/account')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByLabel('Usuario o email')).toBeVisible()
})

test('advanced service drafts are discarded and space tabs remain keyboard accessible', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  const venue = await provisionVenue(request, baseURL!, fourSpaceService())
  await signInOwner(page, venue.owner, venue.password, venue.venueName)
  const { drawer, advanced } = await openServiceAdvanced(page)
  await expect(advanced.getByLabel('Plazo de llegada (minutos)')).toHaveValue('5')
  await expect(
    advanced.getByLabel('Minutos restantes para aviso de acercamiento', {
      exact: true,
    }),
  ).toHaveValue('10')
  await expect(
    advanced.getByLabel('Mejora mínima para avisar (min)'),
  ).toHaveValue('5')
  await expect(
    advanced.getByLabel('Intervalo mínimo entre avisos de mejora (min)'),
  ).toHaveValue('10')

  await page.setViewportSize({ width: 390, height: 844 })
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await advanced.getByLabel('Terrace · 4 plazas (min)').fill('99')
  await advanced.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(advanced).toHaveCount(0)
  await expect(
    drawer.getByRole('button', {
      name: 'Configuración avanzada',
      exact: true,
    }),
  ).toBeFocused()
  await drawer
    .getByRole('button', { name: 'Configuración avanzada', exact: true })
    .click()
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(advanced.getByLabel('Terrace · 4 plazas (min)')).toHaveValue(
    '35',
  )

  await advanced.getByRole('tab', { name: 'Terrace', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(
    advanced.getByRole('tab', { name: 'Salon', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    advanced.getByRole('tab', { name: 'Salon', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    advanced.getByRole('tabpanel', { name: 'Salon', exact: true }),
  ).toBeVisible()
  await expect(
    advanced.getByRole('tabpanel', { name: 'Terrace', exact: true }),
  ).toBeHidden()

  await advanced
    .getByRole('heading', { name: 'Configuración avanzada', exact: true })
    .hover()
  await advanced.getByRole('tab', { name: 'Terrace', exact: true }).focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  const lastTab = advanced.getByRole('tab', {
    name: 'Sala para eventos privados',
    exact: true,
  })
  await expect(lastTab).toBeInViewport()
  await expect(lastTab).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect(
    advanced.getByRole('tab', { name: 'Terrace', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({
    path: testInfo.outputPath('queue-advanced-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })

  await page.keyboard.press('Escape')
  await expect(advanced).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('per-space durations remain drafts until confirmation and persist after reload', async ({
  page,
  request,
  baseURL,
}) => {
  const venue = await provisionVenue(request, baseURL!, fourSpaceService())
  await signInOwner(page, venue.owner, venue.password, venue.venueName)
  const { drawer, advanced } = await openServiceAdvanced(page)
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await advanced.getByLabel('Terrace · 4 plazas (min)').fill('70')
  await advanced.getByRole('tab', { name: 'Salon', exact: true }).click()
  const salonPanel = advanced.getByRole('tabpanel', {
    name: 'Salon',
    exact: true,
  })
  await salonPanel
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await salonPanel.getByLabel('Salon · 4 plazas (min)').fill('20')
  await advanced.getByRole('tab', { name: 'Terrace', exact: true }).click()
  await advanced.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(advanced).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Terrace', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(drawer).toHaveCount(0)

  await page.reload()
  const reopened = await openServiceAdvanced(page)
  await reopened.advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(
    reopened.advanced.getByLabel('Terrace · 4 plazas (min)'),
  ).toHaveValue('70')
  await reopened.advanced
    .getByRole('tab', { name: 'Salon', exact: true })
    .click()
  const reopenedSalonPanel = reopened.advanced.getByRole('tabpanel', {
    name: 'Salon',
    exact: true,
  })
  await reopenedSalonPanel
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(
    reopenedSalonPanel.getByLabel('Salon · 4 plazas (min)'),
  ).toHaveValue('20')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
})

test('estimate reference and arrival deadline persist without inventory adjustment settings', async ({
  page,
  request,
  baseURL,
}) => {
  const venue = await provisionVenue(request, baseURL!, fourSpaceService())
  await signInOwner(page, venue.owner, venue.password, venue.venueName)
  const { drawer, advanced } = await openServiceAdvanced(page)
  const grace = advanced.getByLabel('Plazo de llegada (minutos)')
  await expect(grace).toHaveValue('5')
  await grace.fill('8')
  await expect(
    advanced.getByRole('button', { name: 'Opciones de operación', exact: true }),
  ).toHaveCount(0)
  await advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  const interval = advanced.getByLabel('Terrace · 4 plazas (min)')
  await interval.fill('42')
  await advanced.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Terrace', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(drawer).toHaveCount(0)

  await page.reload()
  const reopened = await openServiceAdvanced(page)
  await expect(
    reopened.advanced.getByLabel('Plazo de llegada (minutos)'),
  ).toHaveValue('8')
  await expect(
    reopened.advanced.getByRole('button', {
      name: 'Opciones de operación',
      exact: true,
    }),
  ).toHaveCount(0)
  await reopened.advanced
    .getByRole('button', { name: 'Mesas de 4', exact: true })
    .click()
  await expect(
    reopened.advanced.getByLabel('Terrace · 4 plazas (min)'),
  ).toHaveValue('42')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
})

test('configuration drafts reject concurrent changes even after catalogue polling', async ({
  page, request, baseURL,
}) => {
  const venue = await provisionVenue(request, baseURL!)
  await signInOwner(page, venue.owner, venue.password, venue.venueName)
  const drawer = await openServiceConfig(page)
  await drawer.getByLabel('Nombre del servicio').fill('Local draft')
  const rows = await (await page.request.get(`/api/v1/staff/venues/${venue.venueId}/queues`)).json()
  const queueId = rows[0].id as string
  const path = `/api/v1/staff/queues/${queueId}`
  // Another editor uses its own snapshot, while the first form remains open.
  const context = await (await page.request.get(`${path}/configuration-context`)).json()
  const competing = await page.request.patch(path, {
    headers: { Origin: baseURL! },
    data: { ...context.config, name: 'Concurrent edit', version: context.version, open: !!context.open },
  })
  expect(competing.status(), await competing.text()).toBe(200)
  const refreshed = page.waitForResponse((response) => response.url().endsWith(`/venues/${venue.venueId}/queues`)
    && response.request().method() === 'GET')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect((await (await refreshed).json())[0].config.name).toBe('Concurrent edit')
  await expect(drawer.getByLabel('Nombre del servicio')).toHaveValue('Local draft')
  for (let step = 0; step < 4; step++)
    await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  const rejected = page.waitForResponse((response) => response.url().endsWith(`/queues/${queueId}`)
    && response.request().method() === 'PATCH')
  await drawer.getByRole('button', { name: 'Confirmar', exact: true }).click()
  expect((await rejected).status()).toBe(409)
  await expect(drawer.getByRole('alert')).toContainText('Otra persona ha modificado')
  const persisted = await (await page.request.get(`${path}/configuration-context`)).json()
  expect(persisted.config.name).toBe('Concurrent edit')
  expect(persisted.version).toBe(context.version + 1)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  const reopened = await openServiceConfig(page)
  await expect(reopened.getByLabel('Nombre del servicio')).toHaveValue('Concurrent edit')
})
