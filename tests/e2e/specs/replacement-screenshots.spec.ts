import { mkdir } from 'node:fs/promises'
import { test, expect } from '../fixtures.js'
import { setup } from '../helpers/queue-actions.js'
import type { Page } from '@playwright/test'

test.skip(
  !process.env.REPLACEMENT_SCREENSHOTS,
  'Explicit local visual comparison only',
)
const baseline = process.env.REPLACEMENT_BASELINE === 'true'
const root =
  process.env.REPLACEMENT_SCREENSHOTS ?? '/tmp/replacement-screenshots'
async function capture(page: Page, scenario: string, state: string) {
  await mkdir(root, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await page.screenshot({
    path: `${root}/${
      baseline ? 'main' : 'rama'
    }-${scenario}-${state}-mobile.png`,
    animations: 'disabled',
  })
}
for (const scenario of ['alternatives', 'empty', 'missing-context'] as const) {
  test(`restaurant ${scenario}: real deadline and local decision`, async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(150_000)
    await page.setViewportSize({ width: 390, height: 844 })
    const f = await setup(page, request, baseURL!, 'restaurant')
    const url = page.url()
    const summary = (
      await (
        await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
      ).json()
    )[0]
    const configured = await page.request.patch(
      `/api/v1/staff/queues/${f.queue}`,
      {
        headers: f.headers,
        data: {
          ...summary.config,
          name: 'Restaurante',
          version: summary.version,
          open: !!summary.open,
          graceMinutes: 1,
        },
      },
    )
    expect(configured.ok(), await configured.text()).toBeTruthy()
    const people =
      scenario === 'empty'
        ? [['Grupo de Ana', 4]]
        : [
            ['Grupo de Ana', scenario === 'missing-context' ? 6 : 4],
            ['Grupo de Luis', 2],
            ['Grupo de Marta', 3],
            ['Grupo de Elena', 3],
          ]
    for (const [name, size] of people) {
      const added = await page.request.post(
        `/api/v1/staff/queues/${f.queue}/entries`,
        {
          headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            displayName: name,
            partySize: size,
            locale: 'es',
            whatsapp: { consent: false },
          },
        },
      )
      expect(added.ok(), await added.text()).toBeTruthy()
    }
    const read = async () =>
      await (
        await page.request.get(`/api/v1/staff/queues/${f.queue}/entries`)
      ).json()
    const waiting = await read()
    await page.reload()
    await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
    const first = page.locator(`li[data-entry-code="${waiting[0].code}"]`)
    await first
      .getByRole('button', { name: `Acciones del turno ${waiting[0].code}` })
      .click()
    await first
      .getByRole('button', { name: 'Asignar turno', exact: true })
      .last()
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Asignar turno', exact: true }),
    ).toBeVisible()
    await capture(page, scenario, '01-asignar')
    await page.keyboard.press('Escape')
    const called = await page.request.post(
      `/api/v1/staff/queues/${f.queue}/commands`,
      {
        headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
        data: {
          action: 'call',
          entryId: waiting[0].id,
          version: waiting[0].version,
          seating:
            scenario === 'missing-context'
              ? { mode: 'unspecified' }
              : { mode: 'confirmed', spaceId: 'terrace', seats: 4 },
        },
      },
    )
    expect(called.ok(), await called.text()).toBeTruthy()
    await page.reload()
    await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
    await capture(page, scenario, '02-llamado')
    const deadline = (await read()).find(
      (e: { id: string }) => e.id === waiting[0].id,
    ).arrivalDeadlineAt
    await page.goto('about:blank')
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, deadline - Date.now()) + 300),
    )
    expect(
      (await read()).find((e: { id: string }) => e.id === waiting[0].id).status,
    ).toBe('expired')
    await page.goto(url)
    await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
    if (!baseline) {
      const sheet = page.getByRole('dialog', {
        name: 'Elige otro turno',
        exact: true,
      })
      await expect(sheet).toBeVisible()
      await capture(page, scenario, '03-aviso')
      if (scenario === 'alternatives') {
        await expect(
          sheet.getByText('Grupo de Marta', { exact: true }),
        ).toBeVisible()
        await sheet
          .getByRole('button', { name: 'Elegir otro turno', exact: true })
          .click()
        await capture(page, scenario, '04-elegir')
      } else {
        await expect(
          sheet.getByRole('button', { name: /Asignar grupo de/ }),
        ).toHaveCount(0)
      }
      await sheet.getByRole('button', { name: 'Ahora no', exact: true }).click()
      await expect(sheet).not.toBeVisible()
      await capture(page, scenario, '05-pendiente')
      // Polling does not reopen a closed notice or add any pending-access control.
      await page.waitForTimeout(5500)
      await expect(
        page.getByText(/Asignaciones pendientes|Reintentar avisos pendientes/),
      ).toHaveCount(0)
      await expect(sheet).not.toBeVisible()
    } else {
      await capture(page, scenario, '05-pendiente')
    }
    const drawer = page.getByRole('dialog', {
      name: 'Gestionar lista',
      exact: true,
    })
    await drawer.getByRole('tab', { name: 'Cancelados', exact: true }).click()
    await capture(page, scenario, '06-caducado')
    await expect(
      drawer.getByText('Ver turno sucesor', { exact: false }),
    ).toHaveCount(0)
    if (!baseline && scenario === 'alternatives') {
      await drawer.getByRole('tab', { name: 'Lista', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(drawer).not.toBeVisible()
      await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
      await expect(
        page.getByRole('dialog', { name: 'Elige otro turno', exact: true }),
      ).toBeVisible()
      await page
        .getByRole('button', { name: 'Asignar grupo de 3', exact: true })
        .click()
      await expect(
        page.getByRole('dialog', { name: 'Elige otro turno', exact: true }),
      ).not.toBeVisible()
      await expect
        .poll(
          async () =>
            (await read()).find((e: { id: string }) => e.id === waiting[2].id)
              .status,
        )
        .toBe('called')
      expect(
        (await read()).find((e: { id: string }) => e.id === waiting[1].id)
          .status,
      ).toBe('waiting')
      await capture(page, scenario, '07-sustituto')
      const entry = page.locator(`li[data-entry-code="${waiting[2].code}"]`)
      await entry
        .getByRole('button', { name: `Acciones del turno ${waiting[2].code}` })
        .click()
      await expect(
        entry
          .getByRole('button', { name: 'Confirmar llegada', exact: true })
          .last(),
      ).toBeVisible()
      await capture(page, scenario, '08-confirmar-llegada')
    }
  })
}
for (const type of ['reception', 'pool'] as const) {
  test(`${type}: quick assignment and stale-screen protection`, async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 390, height: 844 })
    const f = await setup(page, request, baseURL!, 'reception')
    if (type === 'pool') {
      const q = (
        await (
          await page.request.get(`/api/v1/staff/venues/${f.venueId}/queues`)
        ).json()
      )[0]
      const patched = await page.request.patch(
        `/api/v1/staff/queues/${f.queue}`,
        {
          headers: f.headers,
          data: {
            ...q.config,
            name: 'Bar piscina',
            type: 'pool',
            receptionServices: [],
            version: q.version,
            open: !!q.open,
          },
        },
      )
      expect(patched.ok(), await patched.text()).toBeTruthy()
    }
    for (const name of ['Ana', 'Luis']) {
      const joined = await page.request.post(
        `/api/v1/staff/queues/${f.queue}/entries`,
        {
          headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
          data: {
            displayName: name,
            partySize: 1,
            locale: 'es',
            whatsapp: { consent: false },
            ...(type === 'reception' ? { receptionService: 'check_in' } : {}),
          },
        },
      )
      expect(joined.ok(), await joined.text()).toBeTruthy()
    }
    await page.reload()
    await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
    await capture(page, type, '01-lista')
    await page.route(
      `**/api/v1/staff/queues/${f.queue}/commands`,
      async (route) => {
        const other = await page.request.post(
          `/api/v1/staff/queues/${f.queue}/commands`,
          {
            headers: { ...f.headers, 'Idempotency-Key': crypto.randomUUID() },
            data: route.request().postDataJSON(),
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
    expect((await response).status()).toBe(baseline ? 200 : 409)
    if (!baseline)
      await expect(
        page.getByRole('alert').filter({ hasText: 'La lista ha cambiado.' }),
      ).toBeVisible()
    await capture(page, type, '02-conflicto')
  })
}
