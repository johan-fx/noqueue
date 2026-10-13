import { test, expect } from '../fixtures.js'
import { strictApiMocks } from '../helpers/api-mocks.js'

test.use({ serviceWorkers: 'block' })

test('demo selects and consent work with keyboard, Escape and busy state', async ({
  page,
}) => {
  let finish: (() => void) | undefined
  let body: unknown
  const mocks = await strictApiMocks(page, [
    {
      method: 'POST',
      path: '/api/v1/public/queues/demo-queue/entries',
      expectedHits: 1,
      respond: async (request) => {
        body = request.postDataJSON()
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return { status: 503, json: {} }
      },
    },
  ])
  await page.goto('/q/demo-queue')
  const locale = page.getByRole('combobox', { name: 'Idioma' })
  await expect(locale).toHaveAttribute('data-slot', 'select-trigger')
  await locale.focus()
  await locale.press('Enter')
  await page.getByRole('option', { name: 'English' }).click()
  const english = page.getByRole('combobox', { name: 'Language' })
  await english.focus()
  await english.press('Enter')
  await page.keyboard.press('Escape')
  await expect(english).toBeFocused()
  const consent = page.getByRole('checkbox')
  await expect(consent).toHaveAttribute('data-slot', 'checkbox')
  const phone = page.getByLabel('Phone number')
  await expect(phone).toHaveAttribute('data-slot', 'input')
  await expect(phone).toBeVisible()
  const join = page.getByRole('button', { name: 'Join waiting list' })
  await phone.fill('600000000')
  await expect(join).toBeDisabled()
  await phone.fill('+34600000000')
  await expect(join).toBeDisabled()
  await consent.focus()
  await consent.press('Space')
  await expect(consent).toBeChecked()
  await expect(phone).toBeVisible()
  await expect(join).toBeEnabled()
  await consent.press('Space')
  await expect(consent).not.toBeChecked()
  await expect(phone).toBeVisible()
  await expect(join).toBeDisabled()
  await consent.press('Space')
  await page.getByLabel('Pilot access code').fill('local-fixture')
  await expect(join).toBeEnabled()
  await join.click()
  await expect(consent).toBeDisabled()
  await expect(english).toBeDisabled()
  expect(body).toMatchObject({
    locale: 'en',
    whatsapp: {
      consent: true,
      phone: '+34600000000',
      version: 'whatsapp-public-service-updates-v1',
    },
  })
  finish!()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(english).toBeEnabled()
  await mocks.assertComplete()
})

async function openControlFixture(
  page: import('@playwright/test').Page,
  expected: { commands: number; patches: number; openingContext?: number } = {
    commands: 0,
    patches: 0,
    openingContext: 1,
  },
) {
  const config = {
    name: 'Control restaurant',
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
        name: 'Terraza',
        tables: 2,
        tableTypes: [{ seats: 4, count: 2 }],
      },
      {
        id: 'salon',
        name: 'Salón',
        tables: 2,
        tableTypes: [{ seats: 4, count: 2 }],
      },
    ],
    adjustments: [
      {
        spaceId: 'terrace',
        seats: 4,
        kind: 'duration',
        minutes: 15,
        reason: 'Cleaning',
        expiresAt: Date.now() + 3600000,
      },
    ],
  }
  const commands: unknown[] = []
  const saved: (typeof config)[] = []
  const mocks = await strictApiMocks(page, [
    {
      method: 'GET',
      path: '/api/v1/staff/me',
      expectedHits: { min: 1 },
      respond: () => ({
        json: {
          user: {
            id: 'u',
            username: 'controls',
            email: 'controls@example.test',
          },
          commercial: false,
          platformAdmin: false,
          venues: [{ id: 'venue', name: 'Control venue', role: 'owner' }],
        },
      }),
    },
    {
      method: 'GET',
      path: '/api/v1/staff/venues/venue/queues',
      expectedHits: { min: 1 },
      respond: () => ({
        json: [
          {
            id: 'controls',
            venueId: 'venue',
            name: config.name,
            open: 1,
            serviceOpen: true,
            queueState: 'active',
            inventoryConfirmed: true,
            capacity: 20,
            averageMinutes: 30,
            version: 1,
            readiness: { state: 'ready', reasons: [] },
            config,
          },
        ],
      }),
    },
    {
      method: 'GET',
      path: '/api/v1/staff/queues/controls/opening-context',
      expectedHits:
        expected.openingContext === 0
          ? { min: 0, max: 0 }
          : { min: expected.openingContext ?? 1 },
      respond: () => ({
        json: {
          open: true,
          version: 1,
          contextToken: 'control-context',
          pendingCount: 0,
          untrackedCount: 0,
          readiness: { state: 'ready', reasons: [] },
          groups: [
            {
              spaceId: 'terrace',
              spaceName: 'Terraza',
              seats: 4,
              count: 2,
              allocated: 0,
              occupied: 1,
            },
            {
              spaceId: 'salon',
              spaceName: 'Salón',
              seats: 4,
              count: 2,
              allocated: 0,
              occupied: 1,
            },
          ],
        },
      }),
    },
    {
      method: 'GET',
      path: '/api/v1/staff/queues/controls/entries',
      expectedHits: { min: 1 },
      respond: () => ({ json: [] }),
    },
    {
      method: 'GET',
      path: '/api/v1/staff/venues/venue/location',
      expectedHits: { min: 1 },
      respond: () => ({ json: { version: 1, confirmedAt: null, location: null } }),
    },
    {
      method: 'POST',
      path: '/api/v1/staff/queues/controls/lifecycle',
      expectedHits: expected.commands,
      respond: (request) => {
        commands.push(request.postDataJSON())
        return { json: { ok: true } }
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/staff/queues/controls',
      expectedHits: expected.patches,
      respond: (request) => {
        saved.push(request.postDataJSON())
        return { json: { ok: true } }
      },
    },
  ])
  await page.goto('/staff')
  const gear = page.getByRole('button', { name: 'Opciones del servicio' })
  await expect(gear).toBeVisible()
  return { gear, commands, saved, config, mocks }
}

test('queue options omit physical inventory actions and restore focus after dismissal', async ({
  page,
}) => {
  const { gear, commands, mocks } = await openControlFixture(page, {
    commands: 0,
    patches: 0,
    openingContext: 0,
  })
  await gear.click()
  await expect(gear).toHaveAttribute('aria-expanded', 'true')
  const serviceMenu = page.getByRole('menu')
  await expect(serviceMenu).toBeVisible()
  await expect(
    serviceMenu.getByRole('menuitem', { name: 'Mesa libre', exact: true }),
  ).toHaveCount(0)
  await expect(
    serviceMenu.getByRole('menuitem', {
      name: 'Desglose y correcciones de ocupación',
      exact: true,
    }),
  ).toHaveCount(0)
  expect(commands).toHaveLength(0)
  await page.keyboard.press('Escape')
  await expect(gear).toBeFocused()
  await mocks.assertComplete()
})

test('queue configuration saves estimate reference and arrival deadline without inventory controls', async ({
  page,
}) => {
  const { gear, saved, mocks } = await openControlFixture(page, {
    commands: 0,
    patches: 1,
    openingContext: 0,
  })
  await gear.click()
  await page
    .getByRole('menuitem', { name: 'Configurar servicio', exact: true })
    .click()
  const drawer = page.getByRole('dialog', {
    name: 'Configuración restaurante',
    exact: true,
  })
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer
    .getByRole('button', { name: 'Configuración avanzada', exact: true })
    .click()
  const advanced = page.getByRole('dialog', {
    name: 'Configuración avanzada',
    exact: true,
  })
  await expect(
    advanced.getByRole('button', { name: 'Opciones de operación', exact: true }),
  ).toHaveCount(0)
  await expect(advanced.getByRole('combobox', { name: 'Tipo de ajuste' })).toHaveCount(0)
  await expect(advanced.getByLabel('Plazo de llegada (minutos)')).toHaveValue('5')
  await advanced.getByLabel('Plazo de llegada (minutos)').fill('8')
  await advanced.getByRole('button', { name: 'Mesas de 4', exact: true }).click()
  const interval = advanced.getByLabel('Terraza · 4 plazas (min)')
  await interval.fill('42')
  await advanced.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(advanced).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await drawer.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(drawer).toHaveCount(0)
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ graceMinutes: 8 })
  expect(saved[0]!.spaces).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'terrace',
        tableTypes: expect.arrayContaining([
          expect.objectContaining({ seats: 4, averageMinutes: 42 }),
        ]),
      }),
    ]),
  )
  await expect(gear).toBeFocused()
  await mocks.assertComplete()
})
