// Explicit opt-in manual audit. NEVER part of CI; only Google is permitted to reach the network.
// Actual release frontends + real API/ephemeral D1; no production/staging API call is possible.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { root, verifyRelease } from '../../../scripts/production/release.mjs'
import { createWorkerServer, routeWorkerRequest } from '../../../apps/api/scripts/http-worker.mjs'
const requireApi = createRequire(resolve(root, 'apps/api/package.json'))
const { createTestHarness } = requireApi('wrangler')
const { chromium } = createRequire(resolve(root, 'tests/e2e/package.json'))('@playwright/test')
const { values } = parseArgs({ options: { release: { type: 'string' }, scenario: { type: 'string', default: 'all' }, 'confirm-real-google': { type: 'boolean' } } })
assert.equal(values['confirm-real-google'], true, 'Explicit audit authorization required')
assert.ok(!process.env.CI, 'Real providers are forbidden in CI')
const { directory, profile } = await verifyRelease(values.release)
assert.equal(profile.analytics, 'both', 'Audit requires both actual enabled frontend bundles')
assert.ok(['all', 'journey'].includes(values.scenario))
const app = 'https://app.noqueue-app.com', landing = 'https://noqueue-app.com'
const marker = 'NQPRIVATE', token = 'deadbeef'.repeat(8)
const forbidden = [marker, token, 'notice=', 'utm_source=', 'source=whatsapp', '600000000']
const stamp = new Date().toISOString().replace(/[^0-9]/g, '')
const output = resolve(root, 'reports/production-private/google', stamp)
await mkdir(output, { recursive: true, mode: 0o700 })
const run = await mkdtemp(resolve(root, 'apps/api/.wrangler/privacy-audit-'))
const config = JSON.parse(await readFile(resolve(root, 'apps/api/wrangler.jsonc'), 'utf8'))
const production = config.env.production
Object.assign(config, production)
delete config.env; delete config.routes; delete config.triggers
config.name = 'noqueue-local-privacy-audit'
config.main = resolve(root, 'apps/api/test/privacy-audit-worker.ts')
config.assets.directory = resolve(directory, 'web')
config.observability = { enabled: false }
config.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000'
config.d1_databases[0].migrations_dir = resolve(root, 'apps/api/migrations')
config.vars = { ...production.vars, BETTER_AUTH_SECRET: 'synthetic-audit-secret-never-used-remotely', PII_ENCRYPTION_KEY: '11'.repeat(32), PHONE_HASH_KEY: '22'.repeat(32), RECOVERY_TOKEN_KEY: '33'.repeat(32), D360DIALOG_API_KEY: 'synthetic-audit-key', D360DIALOG_PHONE_NUMBER_ID: 'synthetic-audit-channel', GEOAPIFY_API_KEY: '', AUTH_EMAIL_API_KEY: '' }
for (const flag of ['WHATSAPP_ENABLED', 'PRODUCTION_WHATSAPP_APPROVED', 'WHATSAPP_V4_TEMPLATES_APPROVED']) config.vars[flag] = 'true'
await writeFile(resolve(run, 'wrangler.json'), JSON.stringify(config))
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
const harness = createTestHarness({ root: resolve(root, 'apps/api'), workers: [{ configPath: resolve(run, 'wrangler.json') }] })
const report = { release: values.release, at: new Date().toISOString(), productionRequests: 0, checks: [], packets: [], violations: [] }
let server, browser
const record = (name) => { report.checks.push(name); console.log('PASS ' + name) }
async function persist() { await writeFile(resolve(output, 'audit.json'), JSON.stringify(report, null, 2), { mode: 0o600 }) }
try {
  console.log('Starting isolated real API/D1')
  await harness.listen()
  const worker = harness.getWorker()
  await worker.applyD1Migrations('DB')
  const { DB, ASSETS } = await worker.getEnv()
  const fixtureConfig = JSON.stringify({ name: 'NQPRIVATE service', type: 'pool', capacity: 10, averageMinutes: 5, graceMinutes: 5, twentyFourHours: true, cutoffMinutes: 0, schedules: [], spaces: [], receptionServices: [] })
  await DB.batch([
    DB.prepare("INSERT INTO user (id,name,email,createdAt,updatedAt) VALUES ('audit-user','Synthetic audit','audit@example.invalid',datetime('now'),datetime('now'))"),
    DB.prepare("INSERT INTO tenant_account (organization_id,created_by) VALUES ('demo-org','audit-user')"),
    DB.prepare("INSERT INTO venue (id,organization_id,name) VALUES ('NQPRIVATE-VENUE','demo-org','NQPRIVATE venue')"),
    DB.prepare("INSERT INTO queue (id,venue_id,name,capacity,average_minutes,open,config) VALUES ('NQPRIVATE-QUEUE','NQPRIVATE-VENUE','NQPRIVATE service',10,5,1,?)").bind(fixtureConfig),
    DB.prepare("INSERT INTO queue_entry (id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,status,created_at,sequence) VALUES ('NQPRIVATE-ENTRY','NQPRIVATE-QUEUE','NQPRIVATE-KEY','synthetic',?,'SYNTHETIC',1,'es','waiting',?,1)").bind(createHash('sha256').update(token).digest('hex'), Date.now()),
  ])
  server = createWorkerServer(routeWorkerRequest(config.assets.run_worker_first, worker, ASSETS), app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const local = 'http://127.0.0.1:' + server.address().port
  browser = await chromium.launch({ headless: true })
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }
  const landingHeaders = Object.fromEntries((await readFile(resolve(directory, 'landing/_headers'), 'utf8')).split('\n').filter(line => /^  [\w-]+:/.test(line)).map(line => { const i = line.indexOf(':'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()] }))
  async function session({ failReceipt = false, blockedStorage = false, delayTag = false } = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'es-ES' })
    context.setDefaultTimeout(15000)
    let acknowledgements = 0, released = false
    const google = [], collections = [], delayed = []
    if (blockedStorage) await context.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('synthetic blocked storage', 'SecurityError') } })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if ([app, landing].includes(url.origin)) {
        if (url.origin === app) {
          if (url.pathname === '/api/v1/privacy/consents' && failReceipt) { await route.fulfill({ status: 503, body: '' }); return }
          const response = await fetch(local + url.pathname + url.search, { method: request.method(), headers: await request.allHeaders(), body: request.postDataBuffer() ?? undefined, redirect: 'manual' })
          if (url.pathname === '/api/v1/privacy/consents' && response.status === 204) acknowledgements++
          const headers = Object.fromEntries(response.headers); delete headers['content-encoding']; delete headers['content-length']
          const body = Buffer.from(await response.arrayBuffer())
          if (url.pathname.endsWith('/entries') && request.method() === 'POST' && response.status >= 400) console.log('Synthetic join diagnostic: ' + body.toString())
          await route.fulfill({ status: response.status, headers, body }); return
        }
        let path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
        if (path.endsWith('/')) path += 'index.html'
        const file = resolve(directory, 'landing', path)
        if (!file.startsWith(resolve(directory, 'landing') + '/')) { await route.abort(); return }
        let bytes; try { bytes = await readFile(file) } catch { await route.fulfill({ status: 404, body: '', headers: landingHeaders }); return }
        await route.fulfill({ contentType: mime[extname(file)] ?? 'application/octet-stream', headers: landingHeaders, body: bytes }); return
      }
      if (url.protocol === 'https:' && ['www.googletagmanager.com', 'www.google-analytics.com', 'region1.google-analytics.com'].includes(url.hostname)) {
        const headers = await request.allHeaders()
        const packet = { url: request.url(), body: request.postData() ?? '', referrer: headers.referer ?? '', acknowledgementCount: acknowledgements }
        google.push(packet); report.packets.push(packet)
        let decoded = packet.url + '\n' + packet.body + '\n' + packet.referrer
        for (let i = 0; i < 3; i++) { try { decoded = decodeURIComponent(decoded) } catch { break } }
        if (forbidden.some(value => decoded.includes(value))) report.violations.push({ kind: 'private-context-leak', url: url.origin + url.pathname })
        if (!acknowledgements) report.violations.push({ kind: 'google-before-receipt' })
        if (url.pathname.includes('collect')) collections.push(packet)
        if (delayTag && !released && url.pathname === '/gtag/js') { delayed.push(route); return }
        await route.continue(); return
      }
      report.violations.push({ kind: 'unexpected-external-destination', origin: url.origin, path: url.pathname })
      await route.abort()
    })
    const page = await context.newPage()
    page.on('response', r => { if(r.request().method() === 'POST' && r.url().includes('/entries')) console.log('Synthetic join response status: '+r.status()) })
    return { context, page, google, collections, release: async () => { released = true; for (const route of delayed.splice(0)) await route.continue() } }
  }
  async function preferences(page) { await page.getByRole('button', { name: 'Privacidad y analítica', exact: true }).click() }
  async function waitFor(check, message) { for (let n = 0; n < 100 && !check(); n++) await new Promise(r => setTimeout(r, 100)); assert.ok(check(), message) }
  if (values.scenario === 'all') {
  for (const origin of [landing, app]) {
    console.log('Auditing ' + origin)
    const s = await session()
    await s.page.goto(origin + '/?notice=NQPRIVATE_NOTICE&utm_source=NQPRIVATE_CAMPAIGN#NQPRIVATE_HASH')
    await s.page.getByRole('button', { name: 'Rechazar', exact: true }).click()
    await s.page.reload(); await s.page.waitForTimeout(1000)
    assert.equal(s.google.length, 0); assert.equal((await s.context.cookies()).filter(c => c.name.startsWith('_ga')).length, 0)
    record(origin + ' rejection/reload: zero Google')
    await preferences(s.page)
    await s.page.getByRole('button', { name: 'Aceptar analítica', exact: true }).click()
    await waitFor(() => s.collections.length > 0, 'Real Google collection not observed')
    await s.page.waitForTimeout(3000)
    assert.equal(s.google.filter(p => new URL(p.url).pathname === '/gtag/js').length, 1)
    const views = s.collections.filter(p => new URLSearchParams(new URL(p.url).search).get('en') === 'page_view' || p.body.includes('en=page_view'))
    assert.equal(views.length, 1, 'Duplicate/missing page view')
    const params = new URLSearchParams(new URL(views[0].url).search + '&' + views[0].body)
    assert.equal(params.get('dl'), origin + '/')
    assert.ok(!params.get('dr')); assert.equal(report.violations.length, 0, 'Unsafe real Google traffic; see private report')
    record(origin + ' real tag: one sanitized view after receipt')
    await s.page.screenshot({ path: resolve(output, origin === app ? 'app.png' : 'landing.png') })
    await preferences(s.page); await s.page.getByRole('button', { name: 'Rechazar', exact: true }).click()
    const before = s.google.length
    await s.page.waitForTimeout(3000)
    assert.equal(s.google.length, before, 'Traffic after withdrawal')
    assert.equal((await s.context.cookies()).filter(c => c.name.startsWith('_ga')).length, 0)
    record(origin + ' withdrawal stops Google and clears GA cookies')
    await s.context.close()
    for (const fault of [{ failReceipt: true }, { blockedStorage: true }]) {
      const f = await session(fault); await f.page.goto(origin)
      await f.page.getByRole('button', { name: 'Aceptar analítica', exact: true }).click(); await f.page.waitForTimeout(1500)
      assert.equal(f.google.length, 0); record(origin + ' fail-closed ' + Object.keys(fault)[0]); await f.context.close()
    }
  }

  // A grant never leaks across origins; both accepted origins keep distinct host-only cookies.
  const isolated = await session()
  await isolated.page.goto(landing); await isolated.page.getByRole('button', { name: 'Aceptar analítica', exact: true }).click()
  await waitFor(() => isolated.collections.length > 0, 'landing collection')
  const isolatedCount = isolated.google.length
  const appTab = await isolated.context.newPage(); await appTab.goto(app); await appTab.waitForTimeout(1000)
  assert.equal(isolated.google.length, isolatedCount)
  assert.ok((await isolated.context.cookies()).filter(c => c.name.startsWith('_ga')).every(c => c.domain === 'noqueue-app.com'))
  await appTab.getByRole('button', { name: 'Aceptar analítica', exact: true }).click()
  await waitFor(() => isolated.collections.length >= 2, 'app collection')
  assert.ok((await isolated.context.cookies()).filter(c => c.name.startsWith('_ga')).every(c => ['app.noqueue-app.com','noqueue-app.com'].includes(c.domain)))
  const otherTab = await isolated.context.newPage(); await otherTab.goto(app)
  await waitFor(() => isolated.collections.length >= 3, 'second app tab collection')
  await isolated.context.addCookies([{ name: 'functional', value: 'preserve', url: app }])
  await preferences(appTab); await appTab.getByRole('button', { name: 'Rechazar', exact: true }).click()
  await appTab.waitForTimeout(500)
  const stopped = isolated.google.length
  await otherTab.goto(app + '/search?q=NQPRIVATE_SEARCH'); await otherTab.waitForTimeout(2000)
  assert.equal(isolated.google.length, stopped)
  assert.ok((await isolated.context.cookies(app)).some(c => c.name === 'functional'))
  assert.equal((await isolated.context.cookies()).filter(c => c.domain === 'app.noqueue-app.com' && c.name.startsWith('_ga')).length, 0)
  assert.ok(!/(?:^|;\s*)_ga(?:_|=)/.test(await otherTab.evaluate(() => document.cookie)))
  assert.ok((await isolated.context.cookies(landing)).some(c => c.name.startsWith('_ga')))
  record('origin and cookie isolation; withdrawal synchronized to second tab without deleting functional cookies')
  await isolated.context.close()

  for (const origin of [landing, app]) {
    const late = await session({ delayTag: true }); await late.page.goto(origin)
    await late.page.getByRole('button', { name: 'Aceptar analítica', exact: true }).click()
    await waitFor(() => late.google.length > 0, 'delayed script request')
    await preferences(late.page); await late.page.getByRole('button', { name: 'Rechazar', exact: true }).click()
    await late.release(); await late.page.waitForTimeout(2500)
    assert.equal(late.collections.length, 0)
    assert.equal((await late.context.cookies()).filter(c => c.name.startsWith('_ga')).length, 0)
    record(origin + ' withdrawal during real script download cancels pending measurement'); await late.context.close()
    for (const invalid of ['revision', 'expired', 'read-only']) {
      const stale = await session()
      await stale.context.addInitScript((kind) => {
        localStorage.setItem('noqueue.privacy.v1', JSON.stringify({ consentId: crypto.randomUUID(), decisionId: crypto.randomUUID(), revision: kind === 'revision' ? 0 : 1, locale: 'es', analytics: true, acknowledged: true, attempts: 1, expiresAt: Date.now() + (kind === 'expired' ? -1000 : 86400000) }))
        if (kind === 'read-only') Storage.prototype.setItem = () => { throw Error('read-only') }
      }, invalid)
      await stale.page.goto(origin); await stale.page.waitForTimeout(1500)
      assert.equal(stale.google.length, 0)
      record(origin + ' fail-closed ' + invalid); await stale.context.close()
    }
  }
  }
  const journey = await session()
  const pv = () => journey.collections.filter(p => new URLSearchParams(new URL(p.url).search + '&' + p.body).get('en') === 'page_view')
  await journey.page.goto(app + '/q/NQPRIVATE-QUEUE?notice=NQPRIVATE_NOTICE#NQPRIVATE_HASH')
  await journey.page.screenshot({path: resolve(output,'queue-before.png')})
  await journey.page.getByRole('button', { name: 'Aceptar analítica', exact: true }).click()
  await waitFor(() => pv().length === 1, 'queue view')
  assert.equal(new URLSearchParams(new URL(pv()[0].url).search + '&' + pv()[0].body).get('dl'), app + '/q/queue')
  record('real queue view normalized')
  await journey.page.waitForTimeout(1100)
  await journey.page.getByLabel('Nombre', {exact: true}).fill('NQPRIVATE name')
  await journey.page.getByLabel('Teléfono', {exact: true}).fill('600000000')
  await journey.page.getByRole('checkbox').check()
  console.log('Submitting synthetic local join')
  const joinedResponse = journey.page.waitForResponse(r => r.url().endsWith('/entries') && r.request().method() === 'POST', {timeout: 15000})
  await journey.page.getByRole('button', { name: 'Ponerme en lista' }).click()
  const result = await joinedResponse
  console.log('Join response observed')
  assert.ok([200, 201].includes(result.status()), 'Synthetic join failed: HTTP ' + result.status())
  await journey.page.waitForURL(/\/t\/[a-f0-9]{64}/)
  const joinedToken = new URL(journey.page.url()).pathname.split('/').pop()
  forbidden.push(joinedToken)
  await journey.page.waitForTimeout(1500)
  assert.equal(await journey.page.locator('script[src*="googletagmanager"]').count(), 0)
  assert.ok(!(await journey.page.evaluate(() => JSON.stringify(sessionStorage))).includes(joinedToken))
  const ticketCount = journey.google.length
  await preferences(journey.page); await journey.page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await journey.page.reload(); await journey.page.waitForTimeout(1000)
  assert.equal(journey.google.length, ticketCount)
  await journey.page.goBack(); await journey.page.waitForTimeout(1000)
  await journey.page.goForward(); await journey.page.waitForTimeout(1000)
  assert.equal(await journey.page.locator('script[src*="googletagmanager"]').count(), 0)
  const restored = await journey.context.newPage(); await restored.goto(app + '/t/' + joinedToken + '?notice=NQPRIVATE_NOTICE&source=whatsapp'); await restored.waitForTimeout(1500)
  assert.equal(await restored.locator('script[src*="googletagmanager"]').count(), 0)
  record('real form join crosses full-document boundary; token absent from Google, reload, history and restored ticket')
  await restored.close()
  for (const [path, normalized] of [['/v/NQPRIVATE-VENUE','/v/venue'], ['/search?q=NQPRIVATE_SEARCH','/search']]) {
    const previous = pv().length
    await journey.page.goto(app + path)
    await waitFor(() => pv().length === previous + 1, 'public normalized view ' + normalized)
    const p = pv().at(-1), values = new URLSearchParams(new URL(p.url).search + '&' + p.body)
    assert.equal(values.get('dl'), app + normalized); assert.ok(!values.get('dr'))
  }
  record('real public venue/search routes normalized, no query or business identifiers')
  const searchViews = pv().length
  await journey.page.getByRole('textbox', { name: 'Hotel, restaurante o local' }).fill('NQPRIVATE_SEARCH')
  await journey.page.getByRole('combobox', { name: 'Idioma', exact: true }).click()
  await journey.page.getByRole('option', { name: 'EN', exact: true }).click()
  await journey.page.evaluate(() => { location.hash = 'NQPRIVATE_HASH' })
  await journey.page.waitForTimeout(6000)
  assert.equal(pv().length, searchViews, 'Query, locale, hash or polling duplicated a pageview')
  record('search text, language, hash and polling do not emit another visit')
  await journey.page.goto(app + '/v/NQPRIVATE-VENUE')
  await waitFor(() => pv().length > searchViews, 'venue view before SPA navigation')
  const beforeSpa = pv().length, tagDownloads = journey.google.filter(p => new URL(p.url).pathname === '/gtag/js').length
  await journey.page.getByRole('link', { name: /NQPRIVATE service/ }).click()
  await waitFor(() => pv().length === beforeSpa + 1, 'SPA queue view')
  await journey.page.waitForTimeout(12000)
  assert.equal(pv().length, beforeSpa + 1)
  assert.equal(journey.google.filter(p => new URL(p.url).pathname === '/gtag/js').length, tagDownloads)
  const last = pv().at(-1)
  assert.equal(new URLSearchParams(new URL(last.url).search + '&' + last.body).get('dl'), app + '/q/queue')
  record('effective SPA navigation produces exactly one normalized visit without reloading the tag')

  for (const path of ['/staff', '/login', '/settings/account', '/privacy/', '/q/does-not-exist', '/t/' + token + '?notice=NQPRIVATE_NOTICE']) {
    const before = journey.google.length
    await journey.page.goto(app + path); await journey.page.waitForTimeout(1000)
    assert.equal(journey.google.length, before, 'Google on excluded or invalid page ' + path)
    assert.equal(await journey.page.locator('script[src*="googletagmanager"]').count(), 0)
  }
  record('excluded and invalid documents never download Google with previous acceptance')
  await journey.context.close()
  assert.equal(report.violations.length, 0, 'Unsafe real Google traffic; see private report')
  for (const packet of report.packets) {
    let data = packet.url + '\n' + packet.body + '\n' + packet.referrer
    for (let i = 0; i < 3; i++) { try { data = decodeURIComponent(data) } catch { break } }
    assert.ok(!forbidden.some(value => data.includes(value)), 'Private context in accumulated Google packets')
  }
  report.result = values.scenario === 'all' ? 'passed' : 'partial-journey-passed'

  await persist()
  console.log(JSON.stringify({ report: resolve(output, 'audit.json'), result: report.result }))
} catch (error) {
  report.result = 'failed'; report.error = error.stack; await persist(); console.error('Audit failed: ' + error.message + '; private report: ' + resolve(output, 'audit.json')); process.exitCode = 1
} finally {
  await browser?.close(); server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); await harness.close()
}
