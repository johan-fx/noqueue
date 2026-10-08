import { test, expect, newClientContext, type Page } from '../fixtures.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { fixture, supportEntry, serviceNames, type ChapterId, type QueueOpeningContext } from './fixtures.js'
import { assertVisiblePhase, ensureRowsInViewport, phaseHeading, type CustomerPhase } from './visible-proof.js'
import { fillPublicWhatsAppConsent } from '../helpers/queue-actions.js'
import type { Entry } from '../../../packages/contracts/src/queue.js'
type StaffEntry = { displayName: string; status: string; partySize: number; preferredSpaceId: string; sequence: number }

type Assertion = { key: string; actual: unknown; expected: unknown }
type Moment = { event: string; caption: string; at: number; hold: number }
type Chapter = { screenProofs: { phase: CustomerPhase; heading: string; countdown: string | null }[]; viewportProofs: { event: string; boxes: { x: number; y: number; width: number; height: number }[] }[]; id: ChapterId; fixture?: { queueId: string; venueId: string; graceMinutes: number }; duration: number; moments: Moment[]; assertions: Assertion[]; cuts: { start: number; end: number; label: string }[]; videos: { role: string; path: string; afterMarker: number; offset: number }[] }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

for (const type of ['restaurant', 'reception', 'pool'] as const) {
  test(`record ${type} customer and staff journeys`, async ({ browser, request, baseURL }, info) => {
    test.skip(Boolean(process.env.QUEUE_DEMO_SERVICES) && !process.env.QUEUE_DEMO_SERVICES!.split(',').includes(type), 'Only explicitly selected services are recorded')
    const root = process.env.QUEUE_DEMO_DIR!
    await mkdir(`${root}/raw`, { recursive: true, mode: 0o700 })
    await mkdir(`${root}/frames`, { recursive: true, mode: 0o700 })
    const chapters: Chapter[] = [], assertions: Assertion[] = []
    let passed = false
    const assert = (key: string, actual: unknown, expected: unknown, chapter: Chapter) => {
      expect(actual, key).toEqual(expected)
      const proof = { key, actual, expected }
      chapter.assertions.push(proof); assertions.push(proof)
    }
    try {
      for (const id of ['main', 'alternatives', 'expiration'] as const) {
        const chapter: Chapter = { screenProofs: [], viewportProofs: [], id, duration: 0, moments: [], assertions: [], cuts: [], videos: [] }
        chapters.push(chapter)
        const options = { baseURL: baseURL!, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' as const, recordVideo: { dir: `${root}/raw`, size: { width: 390, height: 844 } } }
        const staffContext = await newClientContext(browser, info, `${id}-staff`, options)
        const guest = await newClientContext(browser, info, `${id}-customer`, options)
        staffContext.setDefaultTimeout(15_000)
        guest.setDefaultTimeout(15_000)
        const staff = await staffContext.newPage(), client = await guest.newPage()
        let start = 0
        const removed: number[] = []
        const at = () => (performance.now() - start) / 1000
        const moment = async (event: string, caption: string, hold = 6) => {
          await Promise.all([staff, client].map(async (page, i) => {
            await page.mouse.move(0, 0)
            await page.evaluate(() => document.fonts.ready)
            await page.screenshot({ path: `${root}/frames/${type}-${id}-${chapter.moments.length}-${i}.png` })
          }))
          chapter.moments.push({ event, caption, at: at(), hold })
          console.log(`${type}/${id}: ${event}`)
          await delay(hold * 1000)
        }
        try {
          const t = await fixture(staff, request, baseURL!, type, id)
          chapter.fixture = { queueId: t.queue, venueId: t.venueId, graceMinutes: t.graceMinutes }
          const name = id === 'main' ? 'María Cliente' : id === 'alternatives' ? 'Ana Cliente' : 'Luis Cliente'
          const predecessors = id === 'expiration' ? [] : ['Carlos Previo', 'Elena Previa', 'Diego Previo']
          for (const predecessor of predecessors) await supportEntry(guest.request, baseURL!, t.queue, type, predecessor)
          await staff.reload()
          await staff.getByRole('button', { name: 'Ver lista', exact: true }).click()
          await client.goto(id === 'main' ? '/' : `/q/${t.queue}`)
          await expect(client.getByRole('heading').first()).toBeVisible()
          // Calibration and staff authentication/setup are trimmed independently in every raw clip.
          await Promise.all([staff, client].map(page => page.evaluate(() => {
            const marker = document.createElement('div'); marker.id = 'queue-demo-marker'
            marker.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647'
            document.body.append(marker)
          })))
          await delay(1200)
          await Promise.all([staff, client].map(async (page, i) => {
            await page.evaluate(() => document.getElementById('queue-demo-marker')!.remove())
            removed[i] = performance.now()
          }))
          await delay(1000)
          start = performance.now()
          await moment('chapter', `${serviceNames[type]} · ${id === 'main' ? '1. Unirse y llegar' : id === 'alternatives' ? '2. Alternativas del cliente' : '3. Llamado sin llegada'}`)
          if (id === 'main') {
            await expect(client.getByRole('heading', { name: '¿Dónde quieres unirte a la lista de espera?' })).toBeVisible()
            await client.getByRole('button', { name: 'Busca un establecimiento', exact: true }).click()
            await expect(client).toHaveURL(/\/search/)
            await expect(client.getByRole('heading', { name: 'Busca tu establecimiento' })).toBeVisible()
            await moment('search', 'Buscar el establecimiento por nombre · Sin utilizar GPS')
            await client.getByRole('textbox', { name: 'Hotel, restaurante o local' }).fill(t.venueName)
            const result = client.getByRole('region', { name: 'Servicios' }).getByRole('link', { name: new RegExp(serviceNames[type]) })
            await expect(result).toBeVisible()
            await moment('result', 'El resultado lleva directamente a la lista del servicio')
            await result.click()
            await expect(client).toHaveURL(new RegExp(`/q/${t.queue}`))
            assert('discovery', { root: true, search: true, directQueue: true, gps: false }, { root: true, search: true, directQueue: true, gps: false }, chapter)
          }
          await client.getByLabel('Nombre', { exact: true }).fill(name)
          if (type === 'restaurant') {
            await client.getByRole('button', { name: 'Más comensales' }).click()
            await client.getByRole('radio', { name: 'Terraza', exact: true }).click()
          } else {
            await expect(client.getByRole('button', { name: 'Más comensales' })).toHaveCount(0)
            await expect(client.getByRole('radio', { name: 'Terraza', exact: true })).toHaveCount(0)
            if (type === 'reception') {
              for (const service of ['Check-in', 'Check-out', 'Otros temas']) await expect(client.getByRole('radio', { name: service, exact: true })).toBeVisible()
              await client.getByRole('radio', { name: 'Check-in', exact: true }).click()
            } else await expect(client.getByRole('radio')).toHaveCount(0)
          }
          await client.evaluate(() => window.scrollTo(0, 0))
          await moment('form-fields', type === 'restaurant' ? 'Formulario real · 2 comensales y preferencia Terraza' : type === 'reception' ? 'Formulario real · Check-in, Check-out y Otros temas' : 'Formulario real del bar piscina · Sin reserva de hamacas')
          await fillPublicWhatsAppConsent(client)
          await expect(client.getByRole('checkbox')).toBeChecked()
          await expect(client.getByRole('button', { name: 'Ponerme en lista' })).toBeEnabled()
          assert('form', { type, optIn: true, restaurantFields: type === 'restaurant', receptionChoice: type === 'reception' ? 'check_in' : null }, { type, optIn: true, restaurantFields: type === 'restaurant', receptionChoice: type === 'reception' ? 'check_in' : null }, chapter)
          await moment('form', type === 'restaurant' ? 'Nombre, 2 comensales, terraza y consentimiento WhatsApp' : type === 'reception' ? 'Nombre, gestión Check-in y consentimiento WhatsApp' : 'Nombre y consentimiento WhatsApp · Sin campos de restaurante')
          await client.getByRole('button', { name: 'Ponerme en lista' }).click()
          await expect(client).toHaveURL(/\/t\//)
          const token = new URL(client.url()).pathname.split('/').at(-1)!
          const snapshot = async () => await (await guest.request.get(`/api/v1/public/entries/${token}`)).json() as Entry
          const entries = async () => await (await staff.request.get(`/api/v1/staff/queues/${t.queue}/entries`)).json() as StaffEntry[]
          const phase = async (value: CustomerPhase) => {
            const visible = await assertVisiblePhase(client, value, t.venueName)
            chapter.screenProofs.push({ phase: value, ...visible })
            assert(`heading:${value}`, visible.heading, phaseHeading(value, t.venueName), chapter)
            if (value === 'called') assert('countdown:rendered', /^\d+:\d{2}$/.test(visible.countdown ?? ''), true, chapter)
            await expect.poll(async () => (await snapshot()).customer?.phase).toBe(value)
            await client.evaluate(() => window.scrollTo(0, 0))
            assert(`phase:${value}`, (await snapshot()).customer!.phase, value, chapter)
          }
          const drawer = staff.getByRole('dialog', { name: 'Gestionar lista', exact: true })
          const row = (n: string) => drawer.locator('li').filter({ hasText: n })
          const call = async (n: string, visible = false) => {
            await drawer.getByRole('tab', { name: 'Lista', exact: true }).click()
            if (type === 'restaurant') {
              await row(n).getByRole('button', { name: /Acciones del turno/ }).click()
              await row(n).getByRole('button', { name: 'Asignar turno', exact: true }).click()
              await expect(staff.getByRole('dialog', { name: 'Asignar turno', exact: true })).toBeVisible()
              if (visible) await moment('assign-dialog', 'El personal confirma la mesa compatible que va a asignar')
              await staff.getByRole('dialog', { name: 'Asignar turno', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
            } else await drawer.getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
            await expect(row(n).getByText('Pendiente de llegada', { exact: true })).toBeVisible()
            await expect.poll(async () => (await entries()).find(e => e.displayName === n)?.status).toBe('called')
          }
          const arrive = async (n: string) => {
            await row(n).getByRole('button', { name: /Acciones del turno/ }).click()
            await row(n).getByRole('button', { name: 'Confirmar llegada', exact: true }).click()
            await expect(row(n)).toHaveCount(0)
            await drawer.getByRole('tab', { name: 'Completados', exact: true }).click()
            await expect(row(n)).toBeVisible()
            await expect.poll(async () => (await entries()).find(e => e.displayName === n)?.status).toBe('completed')
          }
          const release = async (n: string, visible = false) => {
            if (type === 'restaurant') {
              await row(n).getByRole('button', { name: /Acciones del turno/ }).click()
              await row(n).getByRole('button', { name: 'Liberar recurso', exact: true }).click()
              await expect(staff.getByRole('dialog', { name: 'Liberar recurso', exact: true })).toBeVisible()
              if (visible) await moment('release-dialog', 'Liberar la mesa es una acción del personal · No cancela la llegada')
              await staff.getByRole('dialog', { name: 'Liberar recurso', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
            }
            await drawer.getByRole('tab', { name: 'Lista', exact: true }).click()
          }
          if (id === 'main') {
            await phase('waiting')
            const initial = await snapshot()
            assert('initial-position', initial.position, 4, chapter)
            assert('initial-eta', initial.etaMinutes > 10, true, chapter)
            await expect(client.getByText('3 turnos', { exact: true })).toBeVisible()
            await expect(row(name)).toBeVisible()
            await ensureRowsInViewport([row(name)])
            await moment('waiting', 'En espera · 3 turnos por delante · Estimación superior a 10 minutos')
            for (let i = 0; i < predecessors.length; i++) {
              const n = predecessors[i]!
              await call(n, i === 0)
              if (i === 0) { await phase('approaching'); await moment('approaching', 'Ya casi es tu turno · El personal avanza los turnos anteriores') }
              await arrive(n)
              await moment(`predecessor-${i}`, `Llegada confirmada del turno anterior ${i + 1}`)
              await release(n)
            }
            await call(name, true)
            await phase('called')
            const called = await snapshot()
            assert('deadline', called.customer!.arrivalDeadlineAt! - called.customer!.calledAt!, t.graceMinutes * 60000, chapter)
            await moment('called', `Es tu turno · Plazo de llegada configurado a ${t.graceMinutes} minutos`)
            await arrive(name)
            await phase('arrived')
            await moment('arrived', 'El personal confirma la llegada · Cliente y personal ven el resultado')
            await release(name, true)
            if (type === 'restaurant') {
              const publicState = await snapshot()
              const released = (await entries()).find(e => e.displayName === name)!
              const inventory = await (await staff.request.get(`/api/v1/staff/queues/${t.queue}/opening-context`)).json() as QueueOpeningContext
              assert('resource:released', { phase: publicState.customer!.phase, staffStatus: released.status, occupied: inventory.groups.map(g => g.occupied), allocated: inventory.groups.map(g => g.allocated) }, { phase: 'arrived', staffStatus: 'served', occupied: [0], allocated: [0] }, chapter)
              await moment('released', 'Mesa liberada por el personal · El cliente conserva llegada confirmada')
            }
          } else if (id === 'alternatives') {
            await phase('waiting')
            await expect(row(name)).toBeVisible()
            await ensureRowsInViewport([row(name)])
            await moment('waiting', 'Capítulo independiente · El cliente puede cambiar de plan')
            if (type === 'restaurant') {
              await client.getByRole('button', { name: 'Modificar', exact: true }).click()
              await expect(client.getByRole('dialog')).toBeVisible()
              await moment('edit-menu', 'Modificar el turno · Comensales o sala preferida')
              await client.getByRole('button', { name: 'Modificar número de comensales' }).click()
              await client.getByRole('button', { name: 'Más comensales' }).click()
              await moment('edit-party', 'Añadir un comensal · De 2 a 3')
              await client.getByRole('button', { name: 'Continuar', exact: true }).click()
              await moment('edit-confirm', 'Revisar el cambio antes de confirmarlo')
              await client.getByRole('button', { name: 'Confirmar', exact: true }).click()
              await expect(client.getByRole('dialog')).not.toBeVisible()
              assert('edit:party', (await snapshot()).customer!.partySize, 3, chapter)
              await client.getByRole('button', { name: 'Modificar', exact: true }).click()
              await client.getByRole('button', { name: 'Modificar sala', exact: true }).click()
              await client.getByRole('radio', { name: 'Interior', exact: true }).click()
              await moment('edit-space', 'Elegir Interior · La sala también admite 3 comensales')
              await client.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
              await expect(client.getByRole('dialog')).not.toBeVisible()
              assert('edit:space', (await snapshot()).customer!.preferredSpaceId, 'interior', chapter)
              await expect.poll(async () => { const e = (await entries()).find(e => e.displayName === name)!; return { size: e.partySize, space: e.preferredSpaceId } }).toEqual({ size: 3, space: 'interior' })
              await expect(row(name).getByText('Interior · Preferido', { exact: true })).toBeVisible()
              await ensureRowsInViewport([row(name)])
              await moment('edited', 'Cambio confirmado en ambas vistas · 3 comensales e Interior')
            } else await expect(client.getByRole('button', { name: 'Modificar', exact: true })).toHaveCount(0)
            await supportEntry(guest.request, baseURL!, t.queue, type, 'Sucesor Compatible', type === 'restaurant' ? 'interior' : 'terrace')
            const before = (await snapshot()).position
            if (type === 'restaurant') {
              await client.getByRole('button', { name: 'Modificar', exact: true }).click()
              await client.getByRole('button', { name: 'Pasar turno', exact: true }).click()
            } else await client.getByRole('button', { name: 'Pasar turno', exact: true }).click()
            await expect(client.getByRole('dialog')).toBeVisible()
            await moment('yield-dialog', 'Pasar turno · Ceder la posición al siguiente turno compatible')
            await client.getByRole('button', { name: 'Sí, pasar turno' }).click()
            await expect(client.getByRole('dialog')).not.toBeVisible()
            await expect.poll(async () => (await snapshot()).position).toBe(before + 1)
            await expect(client.getByText(`${before} turnos`, { exact: true })).toBeVisible()
            const ordered = (await entries()).filter(e => e.status === 'waiting').sort((a,b) => a.sequence - b.sequence).map(e => e.displayName)
            assert('yield', ordered, [...predecessors, 'Sucesor Compatible', name], chapter)
            await expect(row('Sucesor Compatible').getByLabel(`Posición ${before}`)).toBeVisible()
            await expect(row(name).getByLabel(`Posición ${before + 1}`)).toBeVisible()
            const visibleRows = await ensureRowsInViewport([row('Sucesor Compatible'), row(name)])
            await expect(row('Sucesor Compatible').getByLabel(`Posición ${before}`)).toBeInViewport({ ratio: 1 })
            await expect(row(name).getByLabel(`Posición ${before + 1}`)).toBeInViewport({ ratio: 1 })
            assert('viewport:yielded', visibleRows.map(box => box.y >= 0 && box.y + box.height <= 844 && box.x >= 0 && box.x + box.width <= 390), [true, true], chapter)
            chapter.viewportProofs.push({ event: 'yielded', boxes: visibleRows })
            await moment('yielded', 'Orden actualizado · El sucesor queda antes y el cliente espera un turno más')
            await client.getByRole('button', { name: 'Abandonar la lista' }).click()
            await expect(client.getByRole('dialog')).toBeVisible()
            await moment('cancel-dialog', 'Abandonar la lista · Confirmar para no perder el turno por error')
            await client.getByRole('button', { name: 'Sí, abandonar la lista de espera' }).click()
            await phase('cancelled')
            await drawer.getByRole('tab', { name: 'Cancelados', exact: true }).click()
            await expect(row(name)).toBeVisible()
            assert('cancel', (await entries()).find(e => e.displayName === name)!.status, 'cancelled', chapter)
            await moment('cancelled', 'Baja confirmada · El turno aparece en Cancelados para el personal')
          } else {
            await call(name, true)
            await phase('called')
            const called = await snapshot()
            assert('expiration-grace', called.customer!.arrivalDeadlineAt! - called.customer!.calledAt!, 60000, chapter)
            await moment('deadline', 'Capítulo independiente · Plazo de demo 1 minuto · Sin confirmar llegada')
            const cutStart = at()
            await expect.poll(async () => (await snapshot()).customer?.phase, { timeout: 90000, intervals: [1000] }).toBe('expired')
            const cutEnd = at()
            expect(cutEnd - cutStart).toBeLessThan(90)
            await phase('expired')
            await drawer.getByRole('tab', { name: 'Cancelados', exact: true }).click()
            await expect(row(name).getByText('Caducado', { exact: true })).toBeVisible()
            assert('server-expiration', (await entries()).find(e => e.displayName === name)!.status, 'expired', chapter)
            if (type === 'restaurant') {
              const inventory = await (await staff.request.get(`/api/v1/staff/queues/${t.queue}/opening-context`)).json() as QueueOpeningContext
              assert('expiration-resource:released', inventory.groups.map(g => ({ occupied: g.occupied, allocated: g.allocated })), [{ occupied: 0, allocated: 0 }], chapter)
            }
            if (cutEnd - cutStart > 5) chapter.cuts.push({ start: cutStart, end: cutEnd, label: 'Ha transcurrido el plazo · Demo configurada a 1 minuto' })
            await moment('expired', 'Turno caducado por el servidor · Sin llegada confirmada', 8)
          }
          chapter.duration = at()
        } finally {
          await Promise.all([staffContext.close(), guest.close()])
          chapter.videos = await Promise.all([staff, client].map(async (page, i) => ({ role: i === 0 ? 'staff' : 'customer', path: await page.video()!.path(), afterMarker: start ? (start - removed[i]!) / 1000 : 0, offset: 0 })))
        }
      }
      passed = true
    } finally {
      await writeFile(`${root}/${type}.json`, JSON.stringify({ status: passed ? 'passed' : 'failed', type, chapters, assertions, clock: 'Real server deadlines; monotonic capture timeline; editorial alignment, not latency measurement' }, null, 2), { mode: 0o600 })
    }
  })
}
