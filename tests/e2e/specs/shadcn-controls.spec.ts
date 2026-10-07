import { test, expect } from '@playwright/test'

test('demo selects and consent work with keyboard, Escape and busy state', async ({
  page,
}) => {
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
  await consent.focus()
  await consent.press('Space')
  await expect(consent).toBeChecked()
  await expect(page.getByLabel('Phone with country code')).toBeVisible()
  await consent.press('Space')
  await expect(consent).not.toBeChecked()
  await expect(page.getByLabel('Phone with country code')).toHaveCount(0)
  await consent.click()
  await page.getByLabel('Phone with country code').fill('+34600000000')
  await page.getByLabel('Pilot access code').fill('local-fixture')
  let finish: (() => void) | undefined
  let body: unknown
  await page.route(
    '**/api/v1/public/queues/demo-queue/entries',
    async (route) => {
      body = route.request().postDataJSON()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      })
    },
  )
  await page.getByRole('button', { name: 'Join waiting list' }).click()
  await expect(consent).toBeDisabled()
  await expect(english).toBeDisabled()
  expect(body).toMatchObject({
    locale: 'en',
    whatsapp: { consent: true, phone: '+34600000000' },
  })
  finish!()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(english).toBeEnabled()
})

async function openControlFixture(page: import('@playwright/test').Page) {
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
  await page.route('**/api/v1/staff/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'PATCH')
      saved.push(route.request().postDataJSON())
    if (path.endsWith('/lifecycle'))
      commands.push(route.request().postDataJSON())
    const body = path.endsWith('/me')
      ? {
          user: {
            id: 'u',
            username: 'controls',
            email: 'controls@example.test',
          },
          commercial: false,
          platformAdmin: false,
          venues: [{ id: 'venue', name: 'Control venue', role: 'owner' }],
        }
      : path.endsWith('/queues')
      ? [
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
        ]
      : path.endsWith('/opening-context')
      ? {
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
        }
      : path.endsWith('/entries')
      ? []
      : {}
    await route.fulfill({ json: body })
  })
  await page.goto('/staff')
  const gear = page.getByRole('button', { name: 'Opciones del servicio' })
  await expect(gear).toBeVisible()
  return { gear, commands, saved, config }
}

test('release group popup preserves its Sheet and restores focus after submitting the selected tuple', async ({
  page,
}) => {
  const { gear, commands } = await openControlFixture(page)
  await gear.click()
  await page.getByRole('menuitem', { name: 'Mesa libre', exact: true }).click()
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
})

test('adjustment type popup preserves metadata and submits duration and availability payloads', async ({
  page,
}) => {
  const { gear, saved, config } = await openControlFixture(page)
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
    await expect(trigger.locator('[data-slot=select-value]')).toHaveText(
      'Duración estimada',
    )
    await trigger.focus()
    await trigger.press('Enter')
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await page
      .getByRole('option', { name: 'Bloquear disponibilidad hasta caducidad' })
      .click()
    await expect(advanced.getByLabel('Duración temporal (min)')).toHaveCount(0)
    await expect(advanced.getByLabel('Motivo', { exact: true })).toHaveValue(
      'Cleaning',
    )
    if (mode === 'duration') {
      await trigger.click()
      await page
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
})
