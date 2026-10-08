import { expect, type Locator, type Page } from '@playwright/test'

export type CustomerPhase = 'waiting' | 'approaching' | 'called' | 'arrived' | 'cancelled' | 'expired'
export function phaseHeading(phase: CustomerPhase, venueName: string) {
  return {
    waiting: `Estás en la lista de espera de ${venueName}`,
    approaching: 'Ya casi es tu turno',
    called: '¡Es tu turno!',
    arrived: 'Se ha confirmado tu llegada',
    cancelled: 'Ya no estás en la lista de espera',
    expired: `Lo sentimos, tu turno en ${venueName} ha expirado`,
  }[phase]
}

/** The stepper label is persistent: only the exact phase h1 proves the current screen. */
export async function assertVisiblePhase(page: Page, phase: CustomerPhase, venueName: string, timeout = 12_000) {
  const heading = page.getByRole('heading', { level: 1, name: phaseHeading(phase, venueName), exact: true })
  await expect(heading).toBeVisible({ timeout })
  await heading.scrollIntoViewIfNeeded()
  await expect(heading).toBeInViewport({ ratio: 1, timeout })
  let countdown: string | null = null
  if (phase === 'called') {
    const counter = page.getByText(/^\d+:\d{2}$/, { exact: true })
    const label = page.getByText('minutos para llegar', { exact: true })
    await expect(counter).toBeVisible({ timeout })
    await expect(counter).toBeInViewport({ ratio: 1, timeout })
    await expect(label).toBeInViewport({ ratio: 1, timeout })
    countdown = await counter.innerText()
  }
  return { heading: await heading.innerText(), countdown }
}

/** Scroll the last row once, then prove all adjacent rows fit simultaneously, unclipped. */
export async function ensureRowsInViewport(rows: Locator[], timeout = 12_000) {
  if (!rows.length) throw new Error('At least one row is required for viewport proof')
  await rows.at(-1)!.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
  const boxes = []
  for (const row of rows) {
    await expect(row).toBeVisible({ timeout })
    await expect(row).toBeInViewport({ ratio: 1, timeout })
    const box = await row.boundingBox()
    if (!box) throw new Error('Missing recorded row bounds')
    const viewport = row.page().viewportSize()
    if (!viewport || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height || box.height < 48 || box.width < 200) {
      throw new Error('Recorded row must be fully contained and readable in the mobile viewport')
    }
    boxes.push(box)
  }
  return boxes
}
