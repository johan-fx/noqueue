import { test, expect, newClientContext } from '../fixtures.js'
import { fixture } from './fixtures.js'
import { fillPublicWhatsAppConsent } from '../helpers/queue-actions.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import type { Entry } from '../../../packages/contracts/src/queue.js'

type StaffSnapshot = {
  arrivalDeadlineAt?: number | null
  waitEstimate?: { predictedAt: number | null; estimateQuality: string }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('real waiting and arrival countdowns match customer, with the delay above turn status', async ({ browser, request, baseURL }, info) => {
  const root = process.env.QUEUE_DEMO_DIR!
  await mkdir(`${root}/raw`, { recursive: true, mode: 0o700 })
  await mkdir(`${root}/frames`, { recursive: true, mode: 0o700 })
  const opts = { baseURL: baseURL!, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    serviceWorkers: 'block' as const, recordVideo: { dir: `${root}/raw`, size: { width: 390, height: 844 } } }
  const sc = await newClientContext(browser, info, 'countdowns-staff', opts)
  const cc = await newClientContext(browser, info, 'countdowns-customer', opts)
  const staff = await sc.newPage(), client = await cc.newPage()
  let start = 0, token = ''
  const removed: number[] = []
  const evidence = { id: 'ui-countdowns', status: 'running', duration: 0,
    moments: [] as { event: string; caption: string; at: number; hold: number }[],
    waits: [] as { start: number; end: number; speed: number }[],
    assertions: [] as { key: string; actual: unknown; expected: unknown }[],
    videos: [] as { role: string; path: string; afterMarker: number }[], errors: [] as string[] }
  const at = () => (performance.now() - start) / 1000
  const check = (key: string, actual: unknown, expected: unknown) => {
    evidence.assertions.push({ key, actual, expected })
    expect(actual, key).toEqual(expected)
  }
  const moment = async (event: string, caption: string) => {
    evidence.moments.push({ event, caption, at: at(), hold: 5 })
    console.log(`${event} at ${at().toFixed(1)}s`)
    await Promise.all([staff, client].map((p, i) => p.screenshot({ path: `${root}/frames/${event}-${i}.png` })))
    await sleep(5000)
  }
  try {
    // One minute is fixture configuration, not a sped-up browser or server clock.
    const f = await fixture(staff, request, baseURL!, 'restaurant', 'expiration',
      { interval: 1, tables: 1, approach: 0 })
    await client.goto(`/q/${f.queue}`)
    await client.getByLabel('Nombre', { exact: true }).fill('María Cliente')
    await client.getByRole('button', { name: 'Más comensales' }).click()
    await client.getByRole('radio', { name: 'Terraza', exact: true }).click()
    await fillPublicWhatsAppConsent(client)
    await Promise.all([staff, client].map(p => p.evaluate(() => {
      const m = document.createElement('div'); m.id = 'queue-demo-marker'
      m.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647'
      document.body.append(m)
    })))
    await sleep(1200)
    await Promise.all([staff, client].map(async (p, i) => {
      await p.evaluate(() => document.getElementById('queue-demo-marker')!.remove())
      removed[i] = performance.now()
    }))
    await sleep(1000); start = performance.now()
    await client.getByRole('button', { name: 'Ponerme en lista' }).click()
    await expect(client).toHaveURL(/\/t\//)
    token = new URL(client.url()).pathname.split('/').at(-1)!
    const snapshot = async () => await (await client.request.get(`/api/v1/public/entries/${token}`)).json() as Entry
    const staffEntry = async () => (await (await staff.request.get(`/api/v1/staff/queues/${f.queue}/entries`)).json() as StaffSnapshot[])[0]!
    const drawer = staff.getByRole('dialog', { name: 'Gestionar lista', exact: true })
    const row = drawer.getByRole('listitem').filter({ hasText: 'María Cliente' })
    const badge = row.getByTitle(/^Espera (provisional|estimada)$/)
    await expect(badge).toHaveText(/^\d+:\d{2}$/)
    const initial = await snapshot()
    check('same-wait-deadline', (await staffEntry()).waitEstimate?.predictedAt, initial.predictedAt)
    const firstText = await badge.innerText()
    await expect(badge).not.toHaveText(firstText)
    await moment('waiting', 'Ambos relojes avanzan por segundos · Referencia de esta prueba = 1 minuto')
    const from = at()
    await expect.poll(async () => (await snapshot()).delay?.reason,
      { timeout: 65000, intervals: [1000] }).toBe('safety')
    evidence.waits.push({ start: from, end: at(), speed: 12 })
    const delay = client.getByText('La espera se ha prolongado').locator('..')
    const green = client.getByText('¡Ya estás en lista de espera!').locator('..').locator('..')
    await expect(delay).toBeVisible()
    check('delay-directly-before-status', await delay.evaluate(el =>
      el.nextElementSibling?.textContent?.includes('¡Ya estás en lista de espera!')), true)
    const revised = await snapshot()
    check('extension-is-in-future', revised.predictedAt! > initial.predictedAt!, true)
    check('same-revised-deadline', (await staffEntry()).waitEstimate?.predictedAt, revised.predictedAt)
    // scrollIntoViewIfNeeded considers the viewport, not an overlapping sticky footer.
    // Use the real page scroll to reveal the entire lower message block.
    await client.mouse.wheel(0, 600)
    await expect.poll(async () => {
      const footer = await client.locator('footer').boundingBox(), status = await green.boundingBox()
      return status!.y + status!.height <= footer!.y + 1
    }).toBe(true)
    const footer = await client.locator('footer').boundingBox(), status = await green.boundingBox()
    check('status-not-covered-by-footer', status!.y + status!.height <= footer!.y + 1, true)
    await moment('delay', 'La prórroga queda justo encima del estado · Ambos relojes reciben la nueva previsión')
    await client.screenshot({ path: `${root}/frames/customer-delay-full.png`, fullPage: true })
    await client.reload()
    await expect(client.getByText('La espera se ha prolongado')).toBeVisible()
    check('delay-survives-reload', await client.getByText('La espera se ha prolongado').count(), 1)
    await row.getByRole('button', { name: /Acciones del turno/ }).click()
    await row.getByRole('button', { name: 'Asignar turno', exact: true }).click()
    await staff.getByRole('dialog', { name: 'Asignar turno', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
    await expect(client.getByRole('heading', { name: '¡Es tu turno!', exact: true })).toBeVisible()
    const arrival = row.getByTitle('Tiempo restante para llegar', { exact: true })
    await expect(arrival).toHaveText(/^\d+:\d{2}$/)
    const called = await snapshot(), staffCalled = await staffEntry()
    check('same-arrival-deadline', staffCalled.arrivalDeadlineAt, called.customer?.arrivalDeadlineAt)
    check('no-wait-estimate-after-call', staffCalled.waitEstimate === undefined, true)
    const before = await arrival.innerText()
    await expect(arrival).not.toHaveText(before)
    await moment('arrival', 'Turno asignado · El segundo countdown muestra el plazo real para llegar')
    await row.getByRole('button', { name: /Acciones del turno/ }).click()
    await row.getByRole('button', { name: 'Confirmar llegada', exact: true }).click()
    await expect(client.getByRole('heading', { name: 'Se ha confirmado tu llegada' })).toBeVisible()
    await moment('arrived', 'Llegada confirmada · Sin cambios en las reglas de asignación ni expiración')
    evidence.status = 'passed'
  } catch (error) {
    evidence.status = 'failed'; evidence.errors.push(String(error)); throw error
  } finally {
    evidence.duration = start ? at() : 0
    await Promise.all([sc.close(), cc.close()])
    evidence.videos = await Promise.all([staff, client].map(async (p, i) => ({
      role: i ? 'customer' : 'staff', path: await p.video()!.path(),
      afterMarker: start ? (start - removed[i]!) / 1000 : 0,
    })))
    await writeFile(`${root}/adaptive-ui-countdowns.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
  }
})
