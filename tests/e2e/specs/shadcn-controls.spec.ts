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
  const phone = page.getByLabel('Phone number with international prefix')
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

test('release group popup preserves its Sheet and restores focus after submitting the selected tuple', async ({
  page,
}) => {
  const { gear, commands, mocks } = await openControlFixture(page, {
    commands: 1,
    patches: 0,
  })
  await gear.click()
  await expect(gear).toHaveAttribute('aria-expanded', 'true')
  const serviceMenu = page.getByRole('menu')
  await expect(serviceMenu).toBeVisible()
  await serviceMenu
    .getByRole('menuitem', { name: 'Mesa libre', exact: true })
    .click()
  const sheet = page.getByRole('dialog', {
    name: 'Mesa libre · Control restaurant',
    exact: true,
  })
  const trigger = sheet.getByRole('combobox', { name: 'Grupo de mesas' })
  await expect(trigger.locator('[data-slot=select-value]')).toHaveText(
    'Terraza · 4 plazas',
  )
  await trigger.focus()
  await trigger.press('Enter')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(sheet).toBeVisible()
  await trigger.press('Enter')
  await page.getByRole('option', { name: 'Salón · 4 plazas' }).click()
  await expect(trigger.locator('[data-slot=select-value]')).toHaveText(
    'Salón · 4 plazas',
  )
  await expect(sheet).toBeVisible()
  expect(commands).toHaveLength(0)
  await sheet
    .getByRole('button', { name: 'Liberar una mesa', exact: true })
    .click()
  await expect(sheet).toHaveCount(0)
  expect(commands).toEqual([
    {
      action: 'release_unit',
      contextToken: 'control-context',
      spaceId: 'salon',
      seats: 4,
    },
  ])
  await expect(gear).toBeFocused()
  await mocks.assertComplete()
})

test('adjustment type popup preserves metadata and submits duration and availability payloads', async ({
  page,
}) => {
  const { gear, saved, config, mocks } = await openControlFixture(page, {
    commands: 0,
    patches: 2,
    openingContext: 0,
  })
  for (const mode of ['duration', 'availability'] as const) {
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
    await advanced
      .getByRole('button', { name: 'Opciones de operación', exact: true })
      .click()
    const trigger = advanced.getByRole('combobox', { name: 'Tipo de ajuste' })
    const options = page.getByRole('listbox')
    await expect(trigger.locator('[data-slot=select-value]')).toHaveText(
      'Duración estimada',
    )
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(options).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(options).toBeVisible()
    await options
      .getByRole('option', { name: 'Bloquear disponibilidad hasta caducidad' })
      .click()
    await expect(advanced.getByLabel('Duración temporal (min)')).toHaveCount(0)
    await expect(advanced.getByLabel('Motivo', { exact: true })).toHaveValue(
      'Cleaning',
    )
    if (mode === 'duration') {
      await trigger.click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      await expect(options).toBeVisible()
      await options
        .getByRole('option', { name: 'Duración estimada', exact: true })
        .click()
      await expect(advanced.getByLabel('Duración temporal (min)')).toHaveValue(
        '30',
      )
    }
    await advanced
      .getByRole('button', { name: 'Confirmar', exact: true })
      .click()
    await expect(advanced).toHaveCount(0)
    await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await drawer.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await drawer.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await expect(drawer).toHaveCount(0)
    const adjustment = saved.at(-1)!.adjustments[0]!
    expect(adjustment).toMatchObject({
      kind: mode,
      spaceId: 'terrace',
      seats: 4,
      reason: 'Cleaning',
      expiresAt: config.adjustments[0]!.expiresAt,
    })
    if (mode === 'duration') expect(adjustment.minutes).toBe(30)
    else expect(adjustment).not.toHaveProperty('minutes')
    await expect(gear).toBeFocused()
  }
  await mocks.assertComplete()
})
