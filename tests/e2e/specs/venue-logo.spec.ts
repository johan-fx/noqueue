import {
  test,
  expect,
  newClientContext,
  type APIRequestContext,
  type Page,
} from '../fixtures.js'
import {
  confirmFixtureLocation,
  resolveFixtureLocation,
} from '../helpers/location.js'

const pilot = 'test-pilot-access-at-least-32-characters'
const password = 'e2e-only-password-12345'

type VenueFixture = {
  venueId: string
  venueName: string
  owner: string
  suffix: string
}

const logoPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC',
  'base64',
)
const logoSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12" viewBox="0 0 24 12"><rect width="24" height="12" rx="2" fill="#2563eb"/></svg>',
)

async function createVenue(
  request: APIRequestContext,
  origin: string,
): Promise<VenueFixture> {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  const sales = `sales_${suffix}`
  const owner = `owner_${suffix}`
  const seeded = await request.post('/api/v1/experiments/local/staff/identity', {
    headers: { 'X-NoQueue-Pilot-Token': pilot },
    data: { username: sales, password },
  })
  expect(seeded.ok(), await seeded.text()).toBeTruthy()

  const signedIn = await request.post('/api/v1/auth/sign-in/username', {
    headers: { Origin: origin },
    data: { username: sales, password },
  })
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy()

  const location = await resolveFixtureLocation(request, origin)
  const venueName = `Logo Venue ${suffix}`
  const response = await request.post(
    '/api/v1/staff/commercial/organizations',
    {
      headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        ...location,
        organizationName: `Logo Organization ${suffix}`,
        slug: `logo-${suffix}`,
        venueName,
        timezone: 'Europe/Madrid',
        ownerName: 'Logo Owner E2E',
        ownerUsername: owner,
        ownerPassword: password,
        services: [
          {
            name: 'Restaurant E2E',
            type: 'restaurant',
            capacity: 20,
            averageMinutes: 30,
            graceMinutes: 5,
            cutoffMinutes: 0,
            twentyFourHours: true,
            schedules: [],
            receptionServices: [],
            assignmentPreference: 'fastest',
            spaces: [
              {
                id: 'terrace',
                name: 'Terrace',
                tables: 1,
                tableTypes: [
                  { seats: 4, count: 1, averageMinutes: 30 },
                ],
              },
            ],
          },
        ],
      },
    },
  )
  expect(response.ok(), await response.text()).toBeTruthy()
  const result = (await response.json()) as { venueId: string }
  return { venueId: result.venueId, venueName, owner, suffix }
}

async function signIn(
  page: Page,
  username: string,
  venueName: string,
) {
  await page.goto('/login')
  await page.getByLabel('Usuario o email').fill(username)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: venueName, exact: true }),
  ).toBeVisible()
}

async function seedCommercial(request: APIRequestContext, username: string) {
  const response = await request.post('/api/v1/experiments/local/staff/identity', {
    headers: { 'X-NoQueue-Pilot-Token': pilot },
    data: { username, password },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

test.describe('venue logos', () => {
  test.use({ serviceWorkers: 'block' })

  test('owner edits logo with preview and cancel; venue manager cannot edit', async ({
    page,
    request,
    baseURL,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'firefox', 'Touch profile is tested in Chromium and WebKit')
    const origin = baseURL!
    const venue = await createVenue(request, origin)
    await signIn(page, venue.owner, venue.venueName)

    const editButton = page.getByRole('button', {
      name: `Editar logotipo de ${venue.venueName}`,
      exact: true,
    })
    await expect(editButton).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 844 })
    await expect(editButton).toBeInViewport()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(editButton).toBeVisible()
    await expect(editButton).toBeInViewport()
    const touchContext = await newClientContext(
      browser,
      testInfo,
      'logo-touch',
      {
        baseURL: origin,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      },
    )
    try {
      const touchPage = await touchContext.newPage()
      await signIn(touchPage, venue.owner, venue.venueName)
      await expect(
        touchPage.getByRole('button', {
          name: `Editar logotipo de ${venue.venueName}`,
          exact: true,
        }),
      ).toBeVisible()
    } finally {
      await touchContext.close()
    }

    await editButton.click()
    const dialog = page.getByRole('dialog', {
      name: `Editar logotipo de ${venue.venueName}`,
      exact: true,
    })
    await expect(dialog).toBeVisible()
    const fileInput = page.locator(
      'input[type="file"][aria-label="Archivo de logotipo"]',
    )
    await fileInput.setInputFiles({
      name: 'brand.png',
      mimeType: 'image/png',
      buffer: logoPng,
    })
    await expect(dialog.getByText('brand.png', { exact: true })).toBeVisible()
    await testInfo.attach('logo-editor-mobile', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    const displayedLogo = page.locator(
      `img[src*="/api/v1/venue-logos/${venue.venueId}/"]`,
    )
    await expect(displayedLogo).toBeVisible()
    await expect(displayedLogo).toHaveCSS('width', '48px')
    await expect(displayedLogo).toHaveCSS('height', '48px')
    await page.setViewportSize({ width: 1280, height: 844 })
    await testInfo.attach('logo-dashboard-desktop', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    const savedUrl = await displayedLogo.getAttribute('src')
    expect(savedUrl).toBeTruthy()
    const saved = await page.request.get(
      `/api/v1/staff/venues/${venue.venueId}/logo`,
    )
    expect(saved.ok(), await saved.text()).toBeTruthy()
    const savedState = (await saved.json()) as {
      logo: { name: string } | null
      logoVersion: number
      canEditLogo: boolean
    }
    expect(savedState).toMatchObject({
      logo: { name: 'brand.png' },
      logoVersion: 1,
      canEditLogo: true,
    })

    // SVG input is accepted, but the public image is the normalized PNG.
    await editButton.click()
    const vectorDialog = page.getByRole('dialog', {
      name: `Editar logotipo de ${venue.venueName}`,
      exact: true,
    })
    await vectorDialog.locator('input[type="file"][aria-label="Archivo de logotipo"]').setInputFiles({
      name: 'brand-vector.svg',
      mimeType: 'image/svg+xml',
      buffer: logoSvg,
    })
    await expect(vectorDialog.getByText('brand-vector.svg', { exact: true })).toBeVisible()
    await vectorDialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(vectorDialog).toHaveCount(0)
    await expect(displayedLogo).toBeVisible()
    await expect(displayedLogo).toHaveCSS('width', '48px')
    await expect(displayedLogo).toHaveCSS('height', '48px')
    const vectorSaved = await page.request.get(
      `/api/v1/staff/venues/${venue.venueId}/logo`,
    )
    expect(vectorSaved.ok(), await vectorSaved.text()).toBeTruthy()
    expect(await vectorSaved.json()).toMatchObject({
      logo: { name: 'brand-vector.png', type: 'image/png' },
      logoVersion: 2,
      canEditLogo: true,
    })
    const vectorSavedUrl = await displayedLogo.getAttribute('src')

    // A staged removal is discarded on Cancel and leaves the server copy intact.
    await editButton.click()
    const cancelDialog = page.getByRole('dialog', {
      name: `Editar logotipo de ${venue.venueName}`,
      exact: true,
    })
    await cancelDialog.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await cancelDialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(cancelDialog).toHaveCount(0)
    await expect(displayedLogo).toHaveAttribute('src', vectorSavedUrl!)
    const afterCancel = await page.request.get(
      `/api/v1/staff/venues/${venue.venueId}/logo`,
    )
    expect(afterCancel.ok(), await afterCancel.text()).toBeTruthy()
    expect(await afterCancel.json()).toMatchObject({
      logo: { name: 'brand-vector.png', type: 'image/png' },
      logoVersion: 2,
    })

    const manager = `manager_${venue.suffix}`
    const createManager = await page.request.post(
      `/api/v1/staff/venues/${venue.venueId}/members`,
      {
        headers: { Origin: origin },
        data: {
          name: 'Venue Manager E2E',
          username: manager,
          password,
          role: 'venue_manager',
        },
      },
    )
    expect(createManager.status(), await createManager.text()).toBe(201)

    await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
    await signIn(page, manager, venue.venueName)
    await expect(
      page.getByRole('button', {
        name: `Editar logotipo de ${venue.venueName}`,
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(displayedLogo).toBeVisible()

    const managerStateResponse = await page.request.get(
      `/api/v1/staff/venues/${venue.venueId}/logo`,
    )
    expect(managerStateResponse.ok(), await managerStateResponse.text()).toBeTruthy()
    const managerState = (await managerStateResponse.json()) as {
      logoVersion: number
    }
    const denied = await page.request.put(
      `/api/v1/staff/venues/${venue.venueId}/logo`,
      {
        headers: {
          Origin: origin,
          'Idempotency-Key': crypto.randomUUID(),
        },
        multipart: {
          version: String(managerState.logoVersion),
          file: { name: 'denied.png', mimeType: 'image/png', buffer: logoPng },
        },
      },
    )
    expect(denied.status(), await denied.text()).toBe(403)
  })

  test('commercial can retry a failed logo upload without repeating establishment provisioning', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = baseURL!
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    const sales = `sales_retry_${suffix}`
    const owner = `owner_retry_${suffix}`
    await seedCommercial(request, sales)

    await page.goto('/login')
    await page.getByLabel('Usuario o email').fill(sales)
    await page.getByLabel('Contraseña', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Administración', exact: true }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Crear nuevo' }).click()
    await page.getByLabel('Empresa / organización').fill(`Logo retry ${suffix}`)
    await page
      .getByLabel('Hotel / establecimiento', { exact: true })
      .fill(`Logo retry venue ${suffix}`)
    await page.locator('input[type="file"][aria-label="Archivo de logotipo"]').setInputFiles({
      name: 'retry.png',
      mimeType: 'image/png',
      buffer: logoPng,
    })
    await expect(page.getByText('retry.png', { exact: true })).toBeVisible()
    await page.getByLabel('Nombre del administrador').fill('Retry Owner E2E')
    await page.getByLabel('Usuario del administrador').fill(owner)
    await page
      .getByLabel('Contraseña inicial (mínimo 15 caracteres)')
      .fill(password)
    await page.getByLabel('Confirmar contraseña').fill(password)
    await confirmFixtureLocation(page)
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()

    const config = page.getByRole('dialog', {
      name: 'Configuración restaurante',
    })
    await expect(config).toBeVisible()
    await config.getByLabel('Nombre del servicio').fill('Restaurant retry E2E')
    const openingSchedule = config.getByRole('region', {
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
      const toggle = openingSchedule.getByRole('button', { name: day, exact: true })
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    }
    const allDay = openingSchedule.getByRole('switch', {
      name: 'Abierto 24 horas',
      exact: true,
    })
    if ((await allDay.getAttribute('aria-checked')) !== 'true') await allDay.click()
    await expect(allDay).toHaveAttribute('aria-checked', 'true')
    await openingSchedule.getByRole('button', { name: 'Listo', exact: true }).click()
    await config.getByRole('button', { name: 'Siguiente' }).click()
    await config.getByRole('button', { name: 'Configuración avanzada' }).click()
    const advanced = page.getByRole('dialog', {
      name: 'Configuración avanzada',
    })
    await advanced.getByRole('button', { name: 'De 4', exact: true }).click()
    await advanced.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await expect(advanced).toHaveCount(0)
    for (let step = 0; step < 3; step++)
      await config.getByRole('button', { name: 'Siguiente' }).click()

    let organizationPosts = 0
    let logoUploads = 0
    const organizationKeys: string[] = []
    const logoKeys: string[] = []
    await page.route(
      '**/api/v1/staff/commercial/organizations',
      async (route) => {
        if (route.request().method() === 'POST') {
          organizationPosts++
          organizationKeys.push(route.request().headers()['idempotency-key'] ?? '')
        }
        await route.continue()
      },
    )
    await page.route('**/api/v1/staff/venues/*/logo', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      logoUploads++
      logoKeys.push(route.request().headers()['idempotency-key'] ?? '')
      if (logoUploads === 1)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'temporarily_unavailable' }),
        })
      return route.continue()
    })

    await config.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const pendingStatus = page
      .getByRole('status')
      .filter({ hasText: 'El establecimiento se ha creado' })
    await expect(pendingStatus).toContainText('logotipo queda pendiente')
    await expect(
      page.getByRole('button', {
        name: 'Reintentar subida del logotipo',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Continuar sin logo', exact: true }),
    ).toBeVisible()
    expect(organizationPosts).toBe(1)
    expect(logoUploads).toBe(1)

    await page
      .getByRole('button', {
        name: 'Reintentar subida del logotipo',
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', {
        name: 'Reintentar subida del logotipo',
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: 'logotipo guardado' }),
    ).toBeVisible()
    expect(organizationPosts).toBe(1)
    expect(logoUploads).toBe(2)
    expect(organizationKeys).toHaveLength(1)
    expect(logoKeys).toHaveLength(2)
    expect(logoKeys[0]).toBeTruthy()
    expect(logoKeys[1]).toBe(logoKeys[0])
  })
})
