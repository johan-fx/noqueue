import { test, expect, newClientContext, type Locator } from '../fixtures.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { fixture, type ServiceType } from './fixtures.js'
import { assertVisiblePhase, type CustomerPhase } from './visible-proof.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const chapters = ['restaurant-parallel', 'reception', 'pool', 'restaurant-chain'] as const
// Real application + isolated worker; only fictional enrollment/configuration is off-camera.
// No route fulfillment, clock overrides, direct database writes or production services.
for (const id of chapters) test(`automatic real clock: ${id}`, async ({ browser, request, baseURL }, info) => {
  const root = process.env.QUEUE_DEMO_DIR!
  const type: ServiceType = id.startsWith('restaurant') ? 'restaurant' : id as ServiceType
  await mkdir(`${root}/raw`, { recursive: true, mode: 0o700 })
  await mkdir(`${root}/frames`, { recursive: true, mode: 0o700 })
  const options = { baseURL: baseURL!, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' as const, recordVideo: { dir: `${root}/raw`, size: { width: 390, height: 844 } } }
  const sc = await newClientContext(browser, info, `${id}-staff`, options)
  const cc = await newClientContext(browser, info, `${id}-client`, options)
  sc.setDefaultTimeout(15_000); cc.setDefaultTimeout(15_000)
  const staff = await sc.newPage(), client = await cc.newPage()
  const e: any = { id, type, status: 'running', duration: 0, moments: [], waits: [], telemetry: [], assertions: [], videos: [], errors: [], commands: [] }
  let start = 0, currentName = '', t: Awaited<ReturnType<typeof fixture>>
  const removed: number[] = []
  const people = new Map<string, any>()
  const at = () => start ? (performance.now() - start) / 1000 : 0
  const check = (key: string, actual: unknown, expected: unknown) => {
    e.assertions.push({ key, at: at(), actual, expected }); expect(actual, key).toEqual(expected)
  }
  const json = async (url: string) => { const r = await staff.request.get(url); expect(r.ok(), await r.text()).toBeTruthy(); return r.json() }
  const entries = () => json(`/api/v1/staff/queues/${t.queue}/entries`) as Promise<any[]>
  const state = () => json(`/api/v1/staff/queues/${t.queue}/automation`)
  const entry = async (name: string) => (await entries()).find(x => x.displayName === name)!
  const drawer = staff.getByRole('dialog', { name: 'Gestionar lista', exact: true })
  const row = (name: string) => drawer.locator(`li[data-entry-code="${people.get(name).code}"]`)
  const status = async (name: string, value: string) => {
    await expect.poll(async () => (await entry(name)).status).toBe(value)
    check(`status:${name}:${value}`, (await entry(name)).status, value)
  }
  const cycles = async (count: number) => {
    await expect.poll(async () => (await state()).activeCycles).toBe(count)
    check(`active-cycles:${count}`, (await state()).activeCycles, count)
    await expect(drawer.getByText(count ? 'Gestión automática activa' : 'Gestión automática pausada', { exact: true })).toBeVisible()
    if (count) await expect(drawer.getByText(`${count} ${count === 1 ? 'asignación activa.' : 'asignaciones activas.'}`, { exact: true })).toBeVisible()
  }
  const list = () => drawer.getByRole('tab', { name: 'Lista', exact: true }).click()
  const view = async (name: string, phase?: CustomerPhase) => {
    currentName = name
    await client.goto(`/t/${people.get(name).recoveryToken}`)
    await expect(client.getByRole('heading', { level: 1 })).toBeVisible()
    if (phase) await assertVisiblePhase(client, phase, t.venueName)
  }
  const moment = async (event: string, caption: string, hold = 5) => {
    e.moments.push({ event, caption, at: at(), hold, customer: currentName })
    console.log(`${id}: ${event} (${at().toFixed(1)}s)`)
    e.telemetry.push({ at: at(), entries: await entries(), automation: await state(), customer: currentName,
      clientText: await client.locator('body').innerText() })
    await Promise.all([staff, client].map(async (p, i) => { await p.mouse.move(0, 0); await p.screenshot({ path: `${root}/frames/${id}-${event}-${i}.png` }) }))
    await sleep(hold * 1000)
  }
  const visibleRow = async (name: string) => {
    await row(name).evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
    await expect(row(name)).toBeInViewport({ ratio: 1 })
  }
  const manage = async (name: string) => {
    await list(); await visibleRow(name)
    await row(name).getByRole('button', { name: /^Gestionar turno/ }).click()
    return staff.getByRole('dialog', { name: 'Gestionar turno', exact: true })
  }
  const swipe = async (r: Locator, direction: 1 | -1) => {
    await r.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
    const b = await r.locator('[data-swipe-surface]').boundingBox(); expect(b).toBeTruthy()
    const x = b!.x + b!.width / 2, y = b!.y + b!.height - 18
    await staff.mouse.move(x, y); await staff.mouse.down()
    await staff.mouse.move(x + direction * 160, y, { steps: 20 }); await staff.mouse.up()
  }
  const call = async (name: string, via: 'card' | 'footer' | 'swipe' = 'card') => {
    await list(); await view(name)
    if (via === 'footer') await drawer.getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
    else if (via === 'swipe') {
      await swipe(row(name), 1); await moment(`assign-swipe-${name}`, `Asignación manual desde swipe · ${name}`)
      await row(name).getByRole('button', { name: 'Asignar turno', exact: true }).click()
    } else {
      const m = await manage(name)
      await m.getByRole('button', { name: 'Asignar próximo turno', exact: true }).click()
    }
    if (type === 'restaurant') {
      const warning = staff.getByRole('dialog', { name: 'Hay turnos esperando desde antes', exact: true })
      const assign = staff.getByRole('dialog', { name: 'Asignar turno', exact: true })
      await expect.poll(async () => await warning.isVisible() || await assign.isVisible()).toBe(true)
      if (await warning.isVisible()) {
        await moment(`older-warning-${name}`, 'Asignación manual · El maître revisa los turnos anteriores')
        await warning.getByRole('button', { name: 'Confirmar', exact: true }).click()
      }
      await expect(assign).toBeVisible()
      await moment(`assign-options-${name}`, `Inicio manual · ${name} · Capacidad del ciclo = tamaño del grupo`)
      await assign.getByRole('button', { name: /^Asignar (turno|sin especificar mesa)$/ }).click()
    }
    await status(name, 'called'); await visibleRow(name)
    await assertVisiblePhase(client, 'called', t.venueName)
    const actual = await entry(name)
    check(`cycle-created:${name}`, actual.automationCycle?.state, 'active')
    check(`capacity:${name}`, actual.automationCycle?.capacity, type === 'restaurant' ? actual.partySize : null)
    check(`deadline:${name}`, actual.arrivalDeadlineAt - actual.calledAt, e.graceMinutes * 60000)
  }
  const action = async (name: string, kind: 'cancel' | 'complete' | 'pass' | 'prioritize', useSwipe = false) => {
    const label = { cancel: 'Cancelar turno', complete: 'Confirmar llegada', pass: 'Pasar turno', prioritize: 'Priorizar para siguiente turno' }[kind]
    await list(); await view(name)
    if (useSwipe) {
      await swipe(row(name), kind === 'cancel' ? -1 : 1)
      await moment(`${kind}-swipe-${name}`, `Swipe · ${label} · Solo afecta a este ciclo`)
      await row(name).getByRole('button', { name: label, exact: true }).click()
    } else { const m = await manage(name); await m.getByRole('button', { name: label, exact: true }).click() }
    if (kind !== 'complete') {
      const title = kind === 'cancel' ? '¿Confirmas que quieres cancelar el turno?' : kind === 'prioritize' ? 'Priorizar para el siguiente turno' : 'Pasar turno'
      const dialog = staff.getByRole('dialog', { name: title, exact: true })
      await expect(dialog).toBeVisible()
      await moment(`${kind}-confirm-${name}`, kind === 'cancel' ? 'Cancelar manualmente detiene este ciclo; no avisa a otro cliente' : kind === 'prioritize' ? 'Prioridad explícita para el siguiente compatible; no desplaza al ya avisado' : 'Pasar turno ofrece el hueco al siguiente compatible')
      await dialog.getByRole('button', { name: kind === 'prioritize' ? 'Confirmar' : label, exact: true }).click()
      await expect(dialog).not.toBeVisible()
    }
    if (kind === 'cancel' || kind === 'complete') {
      await status(name, kind === 'cancel' ? 'cancelled' : 'completed')
      await assertVisiblePhase(client, kind === 'cancel' ? 'cancelled' : 'arrived', t.venueName)
    }
  }
  const expire = async (name: string, successor?: string) => {
    await list(); await visibleRow(name); await view(name, 'called')
    const before = await entry(name)
    const from = at()
    e.moments.push({ event: `wait-${name}`, caption: `${name} no llega · Cuenta atrás real de ${e.graceMinutes} min · Sin intervención`, at: from, hold: 0, customer: name })
    await expect.poll(async () => (await entry(name)).status, { timeout: e.graceMinutes * 60000 + 20000, intervals: [1000] }).toBe('expired')
    e.waits.push({ start: from, end: at(), speed: 12 })
    await assertVisiblePhase(client, 'expired', t.venueName)
    await drawer.getByRole('tab', { name: 'Cancelados', exact: true }).click(); await visibleRow(name)
    await moment(`expired-${name}`, `Plazo agotado · ${name} caduca por el servidor, no por cancelación manual`)
    await list()
    if (successor) {
      await status(successor, 'called'); await visibleRow(successor); await view(successor, 'called')
      const next = await entry(successor)
      check(`same-cycle:${successor}`, next.automationCycle.id, before.automationCycle.id)
      check(`fixed-capacity:${successor}`, next.automationCycle.capacity, before.automationCycle.capacity)
      check(`automatic-origin:${successor}`, next.automaticReplacement.origin, 'arrival_expiry')
      await moment(`replacement-${successor}`, `Aviso automático · ${successor} · Se conserva la capacidad inicial del ciclo`)
    } else {
      await cycles(0)
      check('no-candidate-reason', (await entry(name)).automationCycle.reason, 'no_candidate')
      await moment('no-candidate', 'Sin candidatos compatibles · Ciclo detenido · Nueva asignación manual necesaria')
    }
  }
  try {
    t = await fixture(staff, request, baseURL!, type, 'expiration', { interval: 4, tables: 4, approach: 2 })
    e.queueId = t.queue; e.venueName = t.venueName; e.graceMinutes = id === 'restaurant-parallel' || id === 'reception' ? 2 : 1
    const queues = await json(`/api/v1/staff/venues/${t.venueId}/queues`)
    const q = queues.find((q: any) => q.id === t.queue)
    const configured = await staff.request.patch(`/api/v1/staff/queues/${t.queue}`, {
      headers: t.headers, data: { ...q.config, automaticAssignmentEnabled: true, graceMinutes: e.graceMinutes, version: q.version, open: !!q.open },
    })
    expect(configured.ok(), await configured.text()).toBeTruthy()
    const seed: [string, number, string?][] = id === 'restaurant-chain'
      ? [['Alba',4], ['Clara',3], ['Bruno',4], ['Celia',4], ['Diego',2], ['Eva',1], ['Fabio',5]]
      : id === 'restaurant-parallel'
        ? [['Ana',4], ['Berta',4], ['Carlos',2], ['David',4], ['Elena',3], ['Felix',2]]
        : id === 'reception'
          ? [['Ana',1,'check_in'], ['Berta',1,'check_out'], ['Carlos',1,'other'], ['David',1,'check_out'], ['Elena',1,'check_in'], ['Felix',1,'check_in']]
          : [['Ana',1], ['Bruno',1], ['Carla',1], ['Diana',1], ['Elena',1]]
    for (const [name, size, subtype] of seed) {
      const r = await cc.request.post(`/api/v1/public/services/${t.queue}/entries`, {
        headers: { Origin: baseURL!, 'Idempotency-Key': crypto.randomUUID() },
        data: { displayName: name, partySize: size, locale: 'es', ...(type === 'restaurant' ? { preferredSpaceId: 'terrace' } : {}), ...(subtype ? { receptionService: subtype } : {}), whatsapp: { consent: true, phone: '+34600000000', version: 'whatsapp-public-service-updates-v1' } },
      })
      expect(r.ok(), await r.text()).toBeTruthy(); people.set(name, await r.json())
    }
    await staff.reload(); await staff.getByRole('button', { name: 'Ver lista', exact: true }).click()
    await view(seed[0]![0])
    check('automatic-configured-effective-idle', (({ configured, effective, activeCycles }) => ({ configured, effective, activeCycles }))(await state()), { configured: true, effective: true, activeCycles: 0 })
    // Independent visual calibration of each camera; no application state changes.
    await Promise.all([staff, client].map(p => p.evaluate(() => { const m = document.createElement('div'); m.id = 'queue-demo-marker'; m.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647'; document.body.append(m) })))
    await sleep(1200)
    await Promise.all([staff, client].map(async (p, i) => { await p.evaluate(() => document.getElementById('queue-demo-marker')!.remove()); removed[i] = performance.now() }))
    await sleep(1000); start = performance.now()
    staff.on('response', async r => {
      if (r.url().endsWith('/commands') && r.request().method() === 'POST') {
        try { e.commands.push({ at: at(), request: r.request().postDataJSON(), status: r.status(), response: await r.json() }) } catch { /* teardown */ }
      }
    })
    await cycles(0)
    await moment('idle', `${type === 'restaurant' ? 'Restaurante' : type === 'reception' ? 'Recepción' : 'Bar / Piscina'} · Automática activada, sin ciclos hasta asignación manual`)
    if (id === 'restaurant-chain') {
      await call('Alba'); await cycles(1)
      await moment('initial-four', 'Alba, 4 personas · Empieza ciclo de capacidad 4 · Plazo de demo 1 minuto')
      for (const [a,b] of [['Alba','Bruno'], ['Bruno','Celia'], ['Celia','Clara'], ['Clara','Diego'], ['Diego','Eva']] as const) await expire(a,b)
      await expire('Eva')
      await status('Fabio','waiting')
      await view('Fabio'); await visibleRow('Fabio')
      await moment('oversized-excluded', 'Fabio, 5 personas, sigue esperando · Nunca se supera la capacidad inicial 4')
      await drawer.getByRole('tab', { name: 'Cancelados', exact: true }).click()
      await row('Eva').getByRole('button', { name: /^Ver detalle del turno/ }).click()
      await expect(staff.getByRole('region', { name: 'Detalle del ciclo pausado' })).toBeVisible()
      await moment('stopped-detail', 'Detalle del ciclo · Sin candidatos compatibles · Requiere asignación manual')
    } else if (id === 'restaurant-parallel') {
      await call('Ana'); await call('Berta'); await call('Carlos'); await cycles(3)
      const original = await entries()
      const active = original.filter(x => x.status === 'called')
      check('three-independent-cycles', new Set(active.map(x=>x.automationCycle.id)).size,3)
      check('parallel-capacities', active.map(x=>x.automationCycle.capacity).sort(),[2,4,4])
      await moment('three-cycles', 'Tres mesas liberadas manualmente · Ciclos independientes 4 + 4 + 2')
      await action('Berta','cancel'); await cycles(2); await status('David','waiting')
      await moment('cancel-only-one', 'Berta cancelada por el maître · Quedan 2 ciclos; no se avisa a David')
      await action('Carlos','complete'); await cycles(1)
      await moment('arrival-only-one', 'Carlos llega · Se ocupa su hueco · Solo termina el ciclo de capacidad 2')
      await action('Elena','prioritize'); await status('Ana','called'); await status('Elena','waiting')
      await moment('priority-pending', 'Elena, 3 personas, priorizada · Ana conserva el aviso activo')
      await expire('Ana','Elena')
      await status('David','waiting')
      await moment('priority-exception', 'Excepción explícita · Elena priorizada pasa antes que David de 4; ambos caben')
      await action('Elena','complete'); await cycles(0)
      await moment('all-stopped', 'Llegada confirmada · Ningún ciclo activo · David sigue esperando')
      await call('David'); await cycles(1)
      await moment('manual-restart', 'Nueva mesa disponible · Asignar David inicia un ciclo nuevo, no reactiva el anterior')
      check('restart-new-id', (await entry('David')).automationCycle.id !== active.find(x=>x.displayName==='Ana').automationCycle.id,true)
      await action('David','cancel'); await cycles(0)
      await moment('manual-stop', 'Cancelación manual · La gestión queda pausada sin avisar a Felix')
    } else if (id === 'reception') {
      await call('Ana','footer'); await call('Berta'); await call('Carlos','swipe'); await cycles(3)
      check('three-reception-subtypes', (await entries()).filter(x=>x.status==='called').map(x=>x.automationCycle.receptionService).sort(),['check_in','check_out','other'])
      await moment('subtypes', 'Recepción · Tres ciclos simultáneos: check-in, check-out y otros')
      await action('Berta','cancel',true); await cycles(2); await status('David','waiting')
      await moment('cancel-swipe-result', 'Swipe cancelar check-out · No avisa a David · Los otros ciclos continúan')
      await action('Carlos','complete',true); await cycles(1)
      await moment('complete-swipe-result', 'Swipe confirmar otros · Solo queda activo el ciclo check-in')
      await action('Felix','prioritize'); await status('Ana','called')
      await expire('Ana','Felix'); await status('David','waiting'); await status('Elena','waiting')
      await moment('subtype-priority', 'Sustituto check-in priorizado · No se consume el check-out de David')
      await action('Felix','complete'); await cycles(0)
      await moment('paused-footer', 'Footer pausado · Para continuar hay que asignar manualmente')
      await call('David','footer'); await cycles(1)
      await moment('footer-restart', 'CTA del footer · Nueva asignación manual de check-out')
      await action('David','complete',true); await cycles(0)
      await moment('reception-end', 'Llegada confirmada por swipe · Elena espera sin recibir aviso automático')
    } else {
      await call('Ana','footer'); await cycles(1)
      await moment('pool-call', 'Bar / Piscina · CTA manual inicia el ciclo · Sin criterio de tamaño de mesa')
      const cycle = (await entry('Ana')).automationCycle.id
      await client.getByRole('button', { name: 'Abandonar la lista' }).click()
      await moment('customer-cancel', 'Baja del CLIENTE avisado · No equivale a cancelación manual del personal')
      await client.getByRole('button', { name: 'Sí, abandonar la lista de espera' }).click()
      await assertVisiblePhase(client,'cancelled',t.venueName); await status('Bruno','called')
      await view('Bruno','called'); await visibleRow('Bruno'); await cycles(1)
      check('customer-cancel-keeps-cycle',(await entry('Bruno')).automationCycle.id,cycle)
      await moment('customer-cancel-replacement', 'Ana abandona · El sistema avisa a Bruno y conserva el ciclo')
      await action('Bruno','pass'); await status('Bruno','waiting'); await status('Carla','called')
      await view('Carla','called'); await visibleRow('Carla')
      check('pass-keeps-cycle',(await entry('Carla')).automationCycle.id,cycle)
      check('passed-remains-eligible',(await entry('Bruno')).manualOnly,false)
      await moment('pass-result', 'Pasar turno · Carla recibe el aviso · Bruno vuelve a la lista de espera')
      await action('Elena','prioritize'); await status('Carla','called')
      await expire('Carla','Elena'); await status('Diana','waiting')
      await action('Elena','cancel',true); await cycles(0); await status('Diana','waiting')
      await moment('pool-stopped', 'Personal cancela por swipe · Ciclo detenido · Diana no es avisada')
      await call('Diana'); await cycles(1)
      await moment('pool-card-restart', 'Asignación desde la card · Sin sheet intermedio · Nuevo ciclo')
      await action('Diana','complete',true); await cycles(0)
      await moment('pool-end', 'Confirmación por swipe · Ciclo finalizado; Bruno permanece en la lista de espera')
    }
    e.finalEntries = await entries(); e.finalAutomation = await state()
    check('all-ui-commands-success',e.commands.every((c:any)=>c.status>=200&&c.status<300),true)
    e.status = 'passed'
  } catch (error) {
    e.status = 'failed'; e.errors.push(String(error))
    await Promise.all([staff, client].map((p,i) => p.screenshot({ path: `${root}/frames/${id}-failure-${i}.png` }).catch(()=>{})))
    throw error
  } finally {
    e.duration = at()
    const captured = e.status; e.status = 'capture_incomplete'
    await writeFile(`${root}/adaptive-${id}.json`,JSON.stringify(e,null,2),{mode:0o600})
    await Promise.all([sc.close(),cc.close()])
    e.videos = await Promise.all([staff,client].map(async(p,i)=>({role:i===0?'staff':'customer',path:await p.video()!.path(),afterMarker:start?(start-removed[i]!)/1000:0})))
    e.status = captured
    await writeFile(`${root}/adaptive-${id}.json`,JSON.stringify(e,null,2),{mode:0o600})
  }
})
