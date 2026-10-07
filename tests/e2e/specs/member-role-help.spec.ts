import { test, expect, type Page, type Locator } from '@playwright/test'

async function clickOutsideHelp(page: Page, drawer: Locator, help: Locator) {
  const outer = (await drawer.boundingBox())!,
    popup = (await help.boundingBox())!
  const x = outer.x + outer.width - 4,
    y = outer.y + 4
  expect(
    x < popup.x ||
      x > popup.x + popup.width ||
      y < popup.y ||
      y > popup.y + popup.height,
  ).toBe(true)
  await page.mouse.click(x, y)
}

async function openMembers(page: Page) {
  const writes: string[] = []
  await page.route('**/api/v1/staff/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
    if (request.method() !== 'GET') writes.push(path)
    const body = path.endsWith('/me')
      ? {
          user: { id: 'actor', username: 'owner', email: 'owner@example.test' },
          commercial: false,
          platformAdmin: false,
          venues: [
            {
              id: 'role-help',
              name: 'Role Help Hotel',
              role: 'owner',
              organizationId: 'org',
              organizationName: 'Test',
            },
          ],
        }
      : path.endsWith('/members')
      ? {
          members: [
            {
              id: 'owner',
              name: 'Owner',
              username: 'owner',
              role: 'owner',
              active: 1,
              canEditDetails: false,
            },
            {
              id: 'staff',
              name: 'Staff',
              username: 'staff',
              role: 'queue_staff',
              active: 1,
              canEditDetails: true,
            },
            {
              id: 'viewer',
              name: 'Viewer',
              username: 'viewer',
              role: 'viewer',
              active: 0,
              canEditDetails: true,
            },
          ],
        }
      : path.endsWith('/queues')
      ? []
      : {}
    await route.fulfill({ json: body })
  })
  await page.goto('/staff')
  await page.getByRole('button', { name: 'Accesos', exact: true }).click()
  const parent = page.getByRole('dialog', {
    name: 'Gestionar accesos',
    exact: true,
  })
  await expect(parent.getByText('Owner', { exact: true })).toBeVisible()
  return { parent, writes }
}
for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 600 },
]) {
  test(`role help native overlay stack and viewport bounds at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const { parent, writes } = await openMembers(page)
    const ownerHelp = parent.getByRole('button', {
      name: 'Ver permisos de Owner',
      exact: true,
    })
    await ownerHelp.click()
    let help = page.getByRole('dialog', {
      name: 'Permisos · Administrador',
      exact: true,
    })
    await expect(help).toBeVisible()
    const box = (await help.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(15)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 15)
    expect(box.y).toBeGreaterThanOrEqual(15)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 15)
    await page.screenshot({ path: testInfo.outputPath('parent-role-help.png') })
    await page.keyboard.press('Escape')
    await expect(help).toHaveCount(0)
    await expect(parent).toBeVisible()
    await expect(ownerHelp).toBeFocused()
    await parent
      .getByRole('button', { name: 'Ver permisos de Staff', exact: true })
      .click()
    help = page.getByRole('dialog', {
      name: 'Permisos · Personal de lista',
      exact: true,
    })
    await expect(help).toBeVisible()
    await clickOutsideHelp(page, parent, help)
    await expect(help).toHaveCount(0)
    await expect(parent).toBeVisible()
    await parent
      .getByRole('button', { name: 'Acciones de Staff', exact: true })
      .click()
    await page
      .getByRole('menuitem', { name: 'Editar usuario', exact: true })
      .click()
    const child = page.getByRole('dialog', {
      name: 'Editar usuario',
      exact: true,
    })
    await expect(child).toBeVisible()
    const role = child.getByRole('combobox', { name: 'Rol', exact: true })
    await role.click()
    await page
      .getByRole('option', { name: 'Solo lectura', exact: true })
      .click()
    await expect(child).toContainText(
      'Consulta los servicios y las listas sin modificar datos.',
    )
    const childHelp = child.getByRole('button', {
      name: 'Ver permisos de Solo lectura',
      exact: true,
    })
    await childHelp.click()
    help = page.getByRole('dialog', {
      name: 'Permisos · Solo lectura',
      exact: true,
    })
    await expect(help).toBeVisible()
    const childBox = (await help.boundingBox())!
    expect(childBox.x).toBeGreaterThanOrEqual(15)
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(viewport.width - 15)
    expect(childBox.y).toBeGreaterThanOrEqual(15)
    expect(childBox.y + childBox.height).toBeLessThanOrEqual(
      viewport.height - 15,
    )
    await page.screenshot({ path: testInfo.outputPath('child-role-help.png') })
    await page.keyboard.press('Escape')
    await expect(help).toHaveCount(0)
    await expect(child).toBeVisible()
    await expect(childHelp).toBeFocused()
    await childHelp.click()
    await expect(help).toBeVisible()
    await clickOutsideHelp(page, child, help)
    await expect(help).toHaveCount(0)
    await expect(child).toBeVisible()
    await role.click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await expect(
      page.getByRole('option', { name: 'Administrador', exact: true }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(child).toBeVisible()
    await child.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(child).toHaveCount(0)
    await expect(parent).toBeVisible()
    await expect(
      parent.getByRole('button', { name: 'Acciones de Staff', exact: true }),
    ).toBeFocused()
    expect(writes).toEqual([])
  })
}
