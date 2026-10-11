import { test, expect, newClientContext } from '../fixtures.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fixture, supportEntry } from './fixtures.js'
import { fillPublicWhatsAppConsent } from '../helpers/queue-actions.js'
import { assertVisiblePhase, type CustomerPhase } from './visible-proof.js'
import type { Entry } from '../../../packages/contracts/src/queue.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
const chapters = ['protection', 'learning', 'offline', 'expiration'] as const
// Read-only evidence from the isolated E2E database. Never updates state or clocks.
function evidenceDb(queue: string) {
  const parent = path.resolve('../../apps/api/.wrangler/e2e-runs')
  const walk = (p: string): string[] => readdirSync(p).flatMap(n => {
    const f = path.join(p, n)
    return statSync(f).isDirectory() ? walk(f) : f.endsWith('.sqlite') ? [f] : []
  })
  const runs = readdirSync(parent).map(n => path.join(parent, n)).sort((a,b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const run of runs) for (const file of walk(run)) {
    try {
      if (execFileSync('sqlite3', ['-readonly', file, `SELECT id FROM queue WHERE id='${queue.replaceAll("'", "''")}'`], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim() === queue)
        return (sql: string) => JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', file, sql], { encoding: 'utf8' }) || '[]') as Record<string, any>[]
    } catch { /* Not this run's D1 database. */ }
  }
  throw new Error('Isolated evidence database not found')
}

for (const id of chapters) test(`adaptive real clock: ${id}`, async ({ browser, request, baseURL }, info) => {
  test.skip(!process.env.QUEUE_DEMO_ADAPTIVE, 'Opt-in recording only')
  const root = process.env.QUEUE_DEMO_DIR!
  await mkdir(`${root}/raw`, { recursive: true, mode: 0o700 })
  await mkdir(`${root}/frames`, { recursive: true, mode: 0o700 })
  const opts = { baseURL: baseURL!, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' as const, recordVideo: { dir: `${root}/raw`, size: { width: 390, height: 844 } } }
  const sc = await newClientContext(browser, info, `${id}-staff`, opts)
  const cc = await newClientContext(browser, info, `${id}-client`, opts)
  sc.setDefaultTimeout(15000); cc.setDefaultTimeout(15000)
  const staff = await sc.newPage(), client = await cc.newPage()
  const e: any = { id, status: 'running', duration: 0, moments: [], waits: [], telemetry: [], assertions: [], videos: [], errors: [] }
  let start = 0, token = '', timer: ReturnType<typeof setInterval> | undefined
  const removed: number[] = []
  const at = () => (performance.now() - start) / 1000
  const check = (key: string, actual: unknown, expected: unknown) => {
    e.assertions.push({ key, at: at(), actual, expected })
    expect.soft(actual, key).toEqual(expected)
  }
  const snapshot = async () => {
    const r = await staff.request.get(`/api/v1/public/entries/${token}`)
    expect(r.ok()).toBeTruthy()
    return await r.json() as Entry
  }
  const moment = async (event: string, caption: string, hold = 5) => {
    e.moments.push({ event, caption, at: at(), hold })
    console.log(`${id}: ${event} (${at().toFixed(1)}s)`)
    await Promise.all([staff, client].map(async (p,i) => { await p.mouse.move(0,0); await p.screenshot({ path: `${root}/frames/${id}-${event}-${i}.png` }) }))
    await sleep(hold * 1000)
  }
  const wait = async (caption: string, until: () => Promise<void>) => {
    const from = at()
    e.moments.push({ event: 'real-wait', caption, at: from, hold: 0 })
    await until()
    e.waits.push({ start: from, end: at(), speed: 12 })
  }
  const phase = async (p: CustomerPhase) => {
    await assertVisiblePhase(client, p, e.venueName)
    check(`phase:${p}`, (await snapshot()).customer?.phase, p)
    const css = await client.getByRole('progressbar').getAttribute('class')
    const expected = p === 'arrived' ? 'text-green-600' : p === 'called' || p === 'expired' ? 'text-red-700' : p === 'approaching' ? 'text-orange-500' : 'text-black'
    check(`color:${p}`, css?.includes(expected), true)
  }
  try {
    const t = await fixture(staff, request, baseURL!, 'restaurant', id === 'expiration' ? 'expiration' : 'main', { interval: 4, tables: id === 'learning' ? 3 : 1, approach: 2, occupied: id === 'protection' || id === 'offline' ? 1 : 0, leaveInactive: id === 'protection' })
    e.queueId = t.queue; e.venueName = t.venueName; e.graceMinutes = t.graceMinutes
    const sql = evidenceDb(t.queue)
    const db = () => ({
      observations: sql(`SELECT assigned_at,interval_ms,ratio,baseline_ms,episode_id FROM queue_assignment_observation WHERE queue_id='${t.queue}' ORDER BY assigned_at,rowid`),
      predictions: sql(`SELECT e.code,e.sequence,a.* FROM queue_adaptive_projection a JOIN queue_entry e ON e.id=a.entry_id WHERE e.queue_id='${t.queue}' ORDER BY e.sequence`),
      notices: sql(`SELECT n.kind,n.status,n.updated_at,n.accepted_at FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id='${t.queue}' ORDER BY n.rowid`),
    })
    // Only fixture initialization is off camera. Actual customer/staff operations use UI.
    await client.goto(`/q/${t.queue}`)
    await Promise.all([staff,client].map(p => p.evaluate(() => { const m = document.createElement('div'); m.id='queue-demo-marker'; m.style.cssText='position:fixed;inset:0;background:#ff00ff;z-index:2147483647'; document.body.append(m) })))
    await sleep(1200)
    await Promise.all([staff,client].map(async (p,i) => { await p.evaluate(() => document.getElementById('queue-demo-marker')!.remove()); removed[i]=performance.now() }))
    await sleep(1000); start=performance.now()
    if (id === 'protection') {
      await moment('activate', 'Activar la lista con el restaurante lleno · Inteligencia automática')
      await staff.getByRole('switch', { name: 'Activar lista', exact: true }).click()
      await expect(staff.getByRole('switch', { name: 'Cerrar lista', exact: true })).toBeChecked()
      await staff.getByRole('button', { name: 'Ver lista', exact: true }).click()
      await client.reload()
    }
    const drawer = staff.getByRole('dialog', { name: 'Gestionar lista', exact: true })
    const row = (name: string) => drawer.locator('li').filter({ hasText: name })
    const call = async (name: string) => {
      await drawer.getByRole('tab', { name: 'Lista', exact: true }).click()
      await row(name).getByRole('button', { name: /Acciones del turno/ }).click()
      await row(name).getByRole('button', { name: 'Asignar turno', exact: true }).click()
      await staff.getByRole('dialog', { name: 'Asignar turno', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
      // A concurrent join can invalidate the version shown in the staff drawer.
      // Follow the actual UI's review/reconfirm instruction, never bypass it.
      const stale = staff.getByText('La disponibilidad o el orden han cambiado. Datos actualizados; revisa el turno y confirma de nuevo.', { exact: true })
      for (let retry = 0; retry < 2; retry++) {
        await expect.poll(async () => await row(name).getByText('Pendiente de llegada', { exact: true }).isVisible() ? 'called' : await stale.isVisible() ? 'stale' : 'pending').not.toBe('pending')
        if (!await stale.isVisible()) break
        await moment('reconfirm', 'Datos actualizados · El personal revisa y confirma de nuevo')
        await staff.getByRole('dialog', { name: 'Asignar turno', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
      }
      await expect(row(name).getByText('Pendiente de llegada', { exact: true })).toBeVisible()
    }
    const arrive = async (name: string) => {
      await row(name).getByRole('button', { name: /Acciones del turno/ }).click()
      await row(name).getByRole('button', { name: 'Confirmar llegada', exact: true }).click()
      await expect(row(name)).toHaveCount(0)
      await drawer.getByRole('tab', { name: 'Completados', exact: true }).click()
      await expect(row(name)).toBeVisible()
    }
    const releaseArrived = async (name: string) => {
      await row(name).getByRole('button', { name: /Acciones del turno/ }).click()
      await row(name).getByRole('button', { name: 'Liberar recurso', exact: true }).click()
      await staff.getByRole('dialog', { name: 'Liberar recurso', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click()
      await drawer.getByRole('tab', { name: 'Lista', exact: true }).click()
    }
    const predecessors = ['Carlos Previo','Elena Previa','Diego Previo','Nora Previa']
    if (id === 'learning') {
      for (const name of predecessors) await supportEntry(cc.request, baseURL!, t.queue, 'restaurant', name)
      const initial = db().predictions.slice(0,3).map(r => Math.round((r.predicted_at - Date.now()) / 60000))
      check('initial-stacked-minutes', initial, [4,8,12])
      e.initialPredictions = db()
    }
    const name = 'María Cliente'
    await client.getByLabel('Nombre', { exact: true }).fill(name)
    await client.getByRole('button', { name: 'Más comensales' }).click()
    await client.getByRole('radio', { name: 'Terraza', exact: true }).click()
    await fillPublicWhatsAppConsent(client)
    await moment('join-form', 'Formulario real · Referencia inicial 4 min · Preaviso 2 min')
    await client.getByRole('button', { name: 'Ponerme en lista' }).click()
    await expect(client).toHaveURL(/\/t\//)
    token = new URL(client.url()).pathname.split('/').at(-1)!
    await phase('waiting')
    const initial = await snapshot()
    check('automatic-estimator-v2', initial.estimatorVersion, 2)
    e.initial = initial
    client.on('response', async response => {
      if (response.url().includes('/api/v1/public/entries/') && response.request().method() === 'GET' && response.ok()) {
        try { e.telemetry.push({ at: at(), wall: Date.now(), server: await response.json() }) } catch { /* closed during teardown */ }
      }
    })
    let sampling = false
    timer = setInterval(async () => {
      if (sampling) return; sampling=true
      try { e.telemetry.push({ at: at(), wall: Date.now(), ui: await client.getByRole('progressbar').evaluate(el => ({ text: (el as HTMLElement).innerText, class: el.className, progress: el.getAttribute('aria-valuenow'), label: el.getAttribute('aria-valuetext') })) }) } catch {} finally { sampling=false }
    }, 1000)
    await moment('waiting', id === 'learning' ? 'Apilado inicial 4 / 8 / 12 · María espera detrás de cuatro turnos' : 'Espera inicial · El reloj desciende segundo a segundo')
    const beforeRead = await snapshot(); await sleep(2000); const afterRead = await snapshot()
    check('reads-do-not-move-prediction', afterRead.predictedAt, beforeRead.predictedAt)

    if (id === 'protection') {
      await wait('Tiempo real sin asignaciones · Esperamos el preaviso', async () => {
        await expect.poll(async () => (await snapshot()).customer?.phase, { timeout: 150000, intervals: [1000] }).toBe('approaching')
      })
      await phase('approaching'); await moment('approaching', 'Naranja · Se alcanza el margen de acercamiento de 2 minutos')
      await wait('No se libera ninguna mesa · Esperamos la alarma del servidor', async () => {
        await expect.poll(async () => (await snapshot()).delay?.reason, { timeout: 100000, intervals: [1000] }).toBe('safety')
      })
      await expect(client.getByText(/Seguimos esperando a que te asignen/)).toBeVisible()
      const extended = await snapshot(); e.firstExtension = extended; e.firstExtensionDb=db()
      check('extension-before-old-zero', Date.now() < initial.predictedAt!, true)
      check('extension-moves-deadline', extended.predictedAt! > initial.predictedAt!, true)
      await phase('waiting'); await moment('safety', 'Prórroga automática antes de cero · Motivo visible · No hay asignación')
      await wait('Seguimos sin liberar mesas · El nuevo plazo vuelve a acercarse', async () => {
        await expect.poll(async () => (await snapshot()).customer?.phase, { timeout: 190000, intervals: [1000] }).toBe('approaching')
      })
      await phase('approaching'); await moment('reapproach', 'Nuevo acercamiento · La explicación de demora permanece')
      await wait('Bloqueo prolongado · Esperamos una segunda prórroga real', async () => {
        await expect.poll(async () => (await snapshot()).predictedAt, { timeout: 110000, intervals: [1000] }).toBeGreaterThan(extended.predictedAt!)
      })
      e.secondExtension = await snapshot()
      await moment('second-safety', 'Segunda prórroga · El turno sigue esperando, no se cancela')
      await staff.getByRole('button', { name: 'Opciones de la lista' }).click()
      await staff.getByRole('menuitem', { name: 'Mesa libre', exact: true }).click()
      await moment('release-dialog', 'Ahora el personal libera una mesa real')
      await staff.getByRole('button', { name: 'Liberar una mesa', exact: true }).click()
      await call(name); await phase('called')
      const called=await snapshot()
      check('arrival-clock-5-minutes', called.customer!.arrivalDeadlineAt! - called.customer!.calledAt!, 300000)
      await moment('called', 'Rojo · Asignación definitiva · Comienza un reloj distinto de 5 minutos', 8)
      await arrive(name); await phase('arrived')
      await moment('arrived', 'Verde · Llegada confirmada por el personal')
      await releaseArrived(name)
    } else if (id === 'learning') {
      const posterior = await supportEntry(cc.request, baseURL!, t.queue, 'restaurant', 'Cliente Posterior')
      for (const n of predecessors) {
        await call(n)
        await moment(`call-${n.split(' ')[0]}`, `Asignación real rápida · ${n}`)
        await arrive(n); await releaseArrived(n)
      }
      const learned=db(); e.afterFast=learned
      check('four-real-assignments', learned.observations.length, 4)
      check('three-valid-intervals', learned.observations.filter(r=>r.ratio!==null).length, 3)
      const current = learned.predictions.find(r=>r.code===initial.code)!
      check('learned-cadence-under-four-minutes', current.cadence_ms < 240000, true)
      await moment('learned', 'La cadencia aprendida reduce las previsiones · Conserva el histórico')
      const added = await supportEntry(cc.request, baseURL!, t.queue, 'restaurant', 'Nuevo Cliente')
      e.newCustomer=added
      await wait('Ahora el personal tarda 5 minutos reales en la siguiente asignación', async () => { await sleep(300000) })
      e.beforeSlow=db()
      await call(name); await phase('called'); e.afterSlow=db()
      const slower = e.afterSlow.predictions.find((r:any)=>r.code===posterior.code)
      check('slower-assignment-increases-cadence', slower.cadence_ms > current.cadence_ms, true)
      await moment('slower', 'Asignación después de 5 minutos · El ritmo aprendido aumenta')
      // The remaining customer cancels through their real customer page, not a staff shortcut.
      const next = posterior
      const beforeCancellation = await (await staff.request.get(`/api/v1/public/entries/${added.recoveryToken}`)).json() as Entry
      const recover = next.recoveryToken ?? next.token
      check('support-recovery-token-available', typeof recover, 'string')
      if (typeof recover === 'string') {
        await client.goto(`/t/${recover}`)
        await client.getByRole('button', { name: 'Abandonar la lista' }).click()
        await client.getByRole('button', { name: 'Sí, abandonar la lista de espera' }).click()
        await expect(client.getByRole('heading', { name: 'Ya no estás en la lista de espera', exact: true })).toBeVisible()
        check('cancellation-not-a-training-sample', db().observations.length, e.afterSlow.observations.length)
        await moment('cancelled', 'Cancelación real · No añade una muestra de atención')
        const afterCancellation = await (await staff.request.get(`/api/v1/public/entries/${added.recoveryToken}`)).json() as Entry
        check('cancellation-advances-next-position', afterCancellation.position, beforeCancellation.position - 1)
        await client.goto(`/t/${added.recoveryToken}`)
        await expect(client.getByRole('progressbar')).toBeVisible()
        await moment('advanced-after-cancel', 'El siguiente cliente avanza sin entrenar una falsa atención')
      }
    } else if (id === 'offline') {
      await wait('Conexión normal · Esperamos hasta 15 segundos antes de la revisión', async () => { await sleep(initial.safetyReviewAt! - Date.now() - 15000) })
      await cc.setOffline(true)
      await moment('disconnected', 'Cliente sin conexión · El servidor local sigue funcionando')
      await wait('Sin conexión · Dejamos vencer la previsión antigua sin adelantar el reloj', async () => { await sleep(initial.predictedAt! - Date.now() + 4000) })
      await expect(client.getByRole('progressbar')).toContainText('Sin conexión')
      e.offlineServer=await snapshot()
      check('server-protected-while-client-offline', e.offlineServer.predictedAt > initial.predictedAt!, true)
      await moment('offline-expired', 'Sin conexión sustituye la cifra · No se anuncia disponibilidad')
      await cc.setOffline(false)
      await expect(client.getByRole('progressbar')).not.toContainText('Sin conexión')
      await expect(client.getByText(/Seguimos esperando a que te asignen/)).toBeVisible()
      const recovered=await snapshot()
      check('reconnect-keeps-original-entry', recovered.customer!.createdAt, initial.customer!.createdAt)
      await moment('reconnected', 'Reconexión · Recupera la previsión protegida del servidor')
      await client.reload(); await expect(client.getByRole('progressbar')).toBeVisible()
      check('reload-does-not-reset-wait', (await snapshot()).customer!.createdAt, initial.customer!.createdAt)
      await moment('reloaded', 'Recargar conserva el turno y la fecha original de inscripción')
    } else {
      await call(name); await phase('called')
      const called=await snapshot()
      check('arrival-clock-demo-one-minute', called.customer!.arrivalDeadlineAt! - called.customer!.calledAt!, 60000)
      await moment('called', 'Escena independiente · Plazo de llegada configurado a 1 minuto')
      await wait('El reloj de llegada sí puede agotarse · Esperamos la expiración real', async () => {
        await expect.poll(async () => (await snapshot()).customer?.phase, { timeout: 90000, intervals: [1000] }).toBe('expired')
      })
      await phase('expired')
      await drawer.getByRole('tab', { name: 'Cancelados', exact: true }).click()
      await expect(row(name).getByText('Caducado', { exact: true })).toBeVisible()
      await moment('expired', 'Caducado por el servidor · No se confirmó llegada')
    }
    e.final = await snapshot(); e.finalDb=db()
    const waitingZeros = e.telemetry.filter((sample: any) => sample.ui && !sample.ui.class?.includes('text-red-700') && /^0:00\b/.test(sample.ui.text.trim()))
    e.reviewFindings = waitingZeros.map((sample: any) => ({ key: 'waiting-never-renders-zero', at: sample.at, expected: 0, actual: 1, caption: 'Incidencia observada - 0:00 fugaz antes de actualizar la estimación' }))
    check('waiting-clock-never-zero', waitingZeros.length, 0)
    e.status=info.errors.length ? 'failed' : 'passed'
  } catch (error) { e.status='failed'; e.errors.push(String(error)); await Promise.all([staff,client].map(async(p,i)=>{ await p.screenshot({path:`${root}/frames/${id}-failure-${i}.png`}).catch(()=>{}) })); throw error }
  finally {
    if (timer) clearInterval(timer)
    e.duration=start ? at() : 0
    e.errors.push(...info.errors.map(x=>x.message))
    const capturedStatus = e.status
    e.status = 'capture_incomplete'
    await writeFile(`${root}/adaptive-${id}.json`, JSON.stringify(e,null,2), { mode: 0o600 })
    await Promise.all([sc.close(),cc.close()])
    e.videos=await Promise.all([staff,client].map(async (p,i)=>({ role:i===0?'staff':'customer',path:await p.video()!.path(),afterMarker:start?(start-removed[i]!)/1000:0 })))
    e.status = capturedStatus
    await writeFile(`${root}/adaptive-${id}.json`, JSON.stringify(e,null,2), { mode: 0o600 })
  }
})
