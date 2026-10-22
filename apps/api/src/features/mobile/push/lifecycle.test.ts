import { env } from 'cloudflare:workers'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { app } from '../../../app'
import { fixture, join as joinWhatsApp } from '../../../../test/whatsapp-v4-fixture'
import { hash } from '../../queue/crypto'
import { joinQueue } from '../../queue/entries'
import { runQueueCommand } from '../../staff/commands'
import { runCustomerCommand, expireArrivals } from '../../queue/customer'
import { recalculateQueue, loadQueueState, commitQueueTransition } from '../../queue/projection'
import { maintainServiceEntries } from '../../queue/service-expiry'
import { serviceWindow } from '../../staff/availability'
import { dispatchPushSerialized } from './dispatch'
import { parsePushSnapshot, pushVariants } from './lifecycle'
import { renderPushCopy } from './copy'
import * as provider from './provider'

const minute = 60000
const bindings = { ...env, WHATSAPP_ENABLED: 'false', WHATSAPP_COPY_VERSION: 'invalid', CONFIRMATION_EXPERIMENT_ENABLED: 'false',
  MOBILE_PUSH_ENABLED: 'true', MOBILE_PUSH_TOKEN_KEY: '44'.repeat(32), FCM_PRIVATE_KEY: 'test-only',
  FCM_CLIENT_EMAIL: 'test@test.iam.gserviceaccount.com', FCM_PROJECT_ID: 'test-project', FCM_IOS_ENABLED: 'true', FCM_IOS_BUNDLE_ID: 'com.noqueue-app.ios' }
let now: number
beforeEach(() => { now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now) })
afterEach(() => vi.restoreAllMocks())
async function setup(platform: 'ios' | 'android' = 'android', registered = true, overrides = {}) {
  const f = await fixture(), identity = crypto.randomUUID().replaceAll('-', '').repeat(2), installation = await hash(`mobile-installation:v1:${identity}`)
  const config = JSON.parse((await env.DB.prepare('SELECT config FROM queue WHERE id=?').bind(f.queue).first<{ config: string }>())!.config)
  Object.assign(config, { estimatorVersion: 2, averageMinutes: 4, approachMinutes: 2, etaChangeThresholdMinutes: 1, notificationCooldownMinutes: 10 })
  Object.assign(config, overrides)
  await env.DB.prepare('UPDATE queue SET config=?,average_minutes=4 WHERE id=?').bind(JSON.stringify(config), f.queue).run()
  const request = (path: string, body?: unknown) => app.request('https://test.invalid/api/v1/mobile/push' + path, {
    headers: { Origin: 'capacitor://localhost', Authorization: `Bearer ${identity}`, 'CF-Connecting-IP': identity, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  }, bindings)
  const register = () => request('/registration', { platform, provider: 'fcm', token: 'test-fcm-' + crypto.randomUUID(), locale: 'es' })
  if (registered) expect((await register()).status).toBe(200)
  if (config.type === 'restaurant') await env.DB.prepare("INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)")
    .bind(f.queue, serviceWindow(config, 'Europe/Madrid', new Date(now)).windowId, now).run()
  const joined = await joinQueue(bindings, f.queue, crypto.randomUUID(), { displayName: 'PRIVATE CUSTOMER', partySize: 1, ...(config.type === 'restaurant' ? {} : { receptionService: 'check_in' as const }), locale: 'es', whatsapp: { consent: false } }, false, undefined, 'mobile-app', installation)
  expect(joined.status).toBe(201)
  const entry = (await env.DB.prepare('SELECT id FROM queue_entry WHERE queue_id=?').bind(f.queue).first<{ id: string }>())!.id
  const token = (joined.body as { recoveryToken: string }).recoveryToken
  const send = vi.spyOn(provider, 'sendPush').mockResolvedValue({ outcome: 'accepted' })
  return { ...f, entry, identity, installation, config, token, request, register, send,
    state: () => env.DB.prepare('SELECT * FROM mobile_push_state WHERE entry_id=?').bind(entry).first(),
    projection: () => env.DB.prepare('SELECT * FROM queue_adaptive_projection WHERE entry_id=?').bind(entry).first<{ predicted_at: number; safety_review_at: number }>(),
  }
}
type Fixture = Awaited<ReturnType<typeof setup>>
async function notices(f: Fixture, kind?: string) {
  return (await env.DB.prepare(`SELECT * FROM mobile_push_outbox WHERE entry_id=? ${kind ? 'AND kind=?' : ''} ORDER BY rowid`).bind(f.entry, ...(kind ? [kind] : [])).all<{
    id: string; kind: string; status: string; attempts: number; payload_snapshot: string; call_cycle: number; entry_version: number; event_key: string; expires_at: number;
  }>()).results
}
async function tick(f: Fixture, time: number) { now = time; await recalculateQueue(bindings, f.queue, now) }
async function change(f: Fixture, averageMinutes: number) {
  const before = await loadQueueState(bindings, f.queue, now), config = { ...before.config!, averageMinutes,
    spaces: before.config!.spaces.map(space => ({ ...space, tableTypes: space.tableTypes?.map(type => ({ ...type, averageMinutes })) })) }
  await commitQueueTransition(bindings, f.queue, before, { config }, [env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queue)], now)
}
async function dispatch(f: Fixture, id: string) { await dispatchPushSerialized(bindings, f.queue, id, now) }
async function version(f: Fixture) { return (await env.DB.prepare('SELECT version FROM queue_entry WHERE id=?').bind(f.entry).first<{ version: number }>())!.version }
async function call(f: Fixture) { await runQueueCommand(bindings, f.actor, f.queue, crypto.randomUUID(), { action: 'assign_next' }, now) }

it.each(['ios', 'android'] as const)('delivers three distinct extensions and renewed approaches on %s without any WhatsApp dependency', async platform => {
  const f = await setup(platform), start = now
  expect(await notices(f)).toEqual([])
  expect(await f.state()).toMatchObject({ reference_source: 'screen', reference_notice_id: '' })
  await tick(f, start + 2 * minute)
  await dispatch(f, (await notices(f, 'approaching')).at(-1)!.id)
  for (let i = 0; i < 3; i++) {
    await tick(f, (await f.projection())!.safety_review_at)
    const notice = (await notices(f, 'delayed'))[i]!
    expect(parsePushSnapshot(notice.payload_snapshot).extensionSequence).toBe(i + 1)
    await dispatch(f, notice.id); await dispatch(f, notice.id)
    expect((await notices(f, 'delayed'))[i]).toMatchObject({ status: 'accepted', attempts: 1 })
    await tick(f, (await f.projection())!.predicted_at - 2 * minute)
    await dispatch(f, (await notices(f, 'approaching')).at(-1)!.id)
  }
  expect(f.send).toHaveBeenCalledTimes(7)
  expect(new Set((await notices(f, 'delayed')).map(n => n.entry_version)).size).toBe(1)
  expect(new Set((await notices(f, 'delayed')).map(n => n.event_key)).size).toBe(3)
  expect(await f.state()).toMatchObject({ reference_source: 'fcm' })
  expect(JSON.stringify(f.send.mock.calls.map(call => call[3]))).not.toMatch(/PRIVATE CUSTOMER|BAJA|STOP|0 turnos/)
  for (const table of ['notification_outbox', 'queue_entry_contact', 'consent', 'queue_notification_state'])
    expect(await env.DB.prepare(`SELECT 1 FROM ${table} WHERE entry_id=?`).bind(f.entry).first()).toBeNull()
})

it('preserves extension order and immutable retry copy; recovers after a transient rejection', async () => {
  const f = await setup(), start = now
  await tick(f, start + 3 * minute)
  const first = (await notices(f, 'delayed'))[0]!
  f.send.mockResolvedValueOnce({ outcome: 'retry', retryAfterMs: minute })
  await dispatch(f, first.id)
  const attempted = (await notices(f, 'delayed'))[0]!.payload_snapshot
  await tick(f, start + 6 * minute)
  const second = (await notices(f, 'delayed'))[1]!
  await dispatch(f, second.id)
  expect(f.send).toHaveBeenCalledTimes(1)
  await dispatch(f, first.id); await dispatch(f, second.id)
  expect(f.send).toHaveBeenCalledTimes(3)
  expect((await notices(f, 'delayed'))[0]!.payload_snapshot).toBe(attempted)
  expect(f.send.mock.calls[0]![3]).toEqual(f.send.mock.calls[1]![3])
})

it('keeps distinct queued extensions across unrelated revisions and refreshes before their first attempt', async () => {
  const f = await setup(), start = now
  for (const m of [3, 6, 9]) await tick(f, start + m * minute)
  const pending = await notices(f, 'delayed')
  expect(pending).toHaveLength(3)
  await env.DB.prepare('UPDATE queue_projection SET revision=revision+7 WHERE entry_id=?').bind(f.entry).run()
  await dispatch(f, pending[2]!.id)
  expect(f.send).not.toHaveBeenCalled()
  for (const n of pending) await dispatch(f, n.id)
  expect(f.send).toHaveBeenCalledTimes(3)
  for (const n of await notices(f, 'delayed')) expect(parsePushSnapshot(n.payload_snapshot).predictedAt).toBe((await f.projection())!.predicted_at)
})

it.each(['recovered', 'paused', 'cycle', 'revoked', 'expired'] as const)('discards %s waiting messages before any send', async reason => {
  const f = await setup()
  await change(f, 5)
  const n = (await notices(f, 'delayed'))[0]!
  if (reason === 'recovered') await change(f, 4)
  if (reason === 'paused') await env.DB.prepare("INSERT INTO queue_admission(queue_id,window_id,override_state) VALUES (?,?,'paused') ON CONFLICT(queue_id) DO UPDATE SET override_state='paused'").bind(f.queue, serviceWindow(f.config, 'Europe/Madrid', new Date(now)).windowId).run()
  if (reason === 'cycle') await env.DB.prepare('UPDATE queue_entry SET call_cycle=call_cycle+1 WHERE id=?').bind(f.entry).run()
  if (reason === 'revoked') await f.request('/revoke', {})
  if (reason === 'expired') now = n.expires_at + 1
  await dispatch(f, n.id)
  expect(f.send).not.toHaveBeenCalled()
  expect((await notices(f, 'delayed'))[0]!.status).toBe('discarded')
})

it.each([false, true])('renders a genuine waiting improvement (approach recommended=%s) without calling the turn', async recommended => {
  const f = await setup('android', true, recommended ? { averageMinutes: 6, approachMinutes: 4 } : {})
  if (recommended) { await tick(f, now + 2 * minute); await dispatch(f, (await notices(f, 'approaching')).at(-1)!.id); f.send.mockClear() }
  await change(f, recommended ? 5 : 3)
  const n = (await notices(f, 'improved')).at(-1)!
  expect(parsePushSnapshot(n.payload_snapshot).copyVariant).toBe(recommended ? 'improved_wait_recommended' : 'improved_wait_neutral')
  await dispatch(f, n.id)
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(f.send.mock.calls[0]![3].body).not.toContain('disponible antes')
})

it('confirms voluntary cancellation only in the app and retires prior pending messages', async () => {
  const f = await setup()
  await change(f, 5)
  await runCustomerCommand(bindings, f.queue, f.token, crypto.randomUUID(), { action: 'cancel', version: await version(f) }, now)
  expect((await notices(f)).every(n => n.status === 'discarded')).toBe(true)
  expect(await notices(f, 'cancelled')).toEqual([])
  expect(f.send).not.toHaveBeenCalled()
})

it.each(['cancel', 'close', 'expire', 'complete'] as const)('emits exactly the intended terminal event for %s', async action => {
  const f = await setup()
  if (action === 'cancel') await runQueueCommand(bindings, f.actor, f.queue, crypto.randomUUID(), { action: 'cancel', entryId: f.entry, version: await version(f) }, now)
  if (action === 'close') {
    await env.DB.prepare('UPDATE queue_entry SET service_ends_at=? WHERE id=?').bind(now, f.entry).run()
    await maintainServiceEntries(bindings, f.queue, now)
  }
  if (action === 'expire' || action === 'complete') {
    await call(f)
    if (action === 'expire') { now += 6 * minute; await expireArrivals(bindings, f.queue, now) }
    else await runQueueCommand(bindings, f.actor, f.queue, crypto.randomUUID(), { action: 'complete', entryId: f.entry, version: await version(f) }, now)
  }
  for (const n of await notices(f)) await dispatch(f, n.id)
  expect(f.send).toHaveBeenCalledTimes(action === 'complete' ? 0 : 1)
  if (action !== 'complete') {
    const n = (await notices(f)).find(n => n.status === 'accepted')!
    expect(parsePushSnapshot(n.payload_snapshot).copyVariant).toBe(action === 'cancel' ? 'cancelled_staff' : action === 'close' ? 'service_ended' : 'expired')
    expect((await f.request('/notices/' + n.id)).status).toBe(200)
  }
})

it('distinguishes early and ordinary calls and keeps the arrival deadline authoritative', async () => {
  const f = await setup()
  await call(f)
  expect(parsePushSnapshot((await notices(f, 'called'))[0]!.payload_snapshot).copyVariant).toBe('improved_ready')
  await runCustomerCommand(bindings, f.queue, f.token, crypto.randomUUID(), { action: 'yield', version: await version(f) }, now)
  expect((await notices(f, 'called'))[0]!.status).toBe('discarded')
  expect(await f.state()).toMatchObject({ reference_source: 'screen' })
  const current = (await f.projection())!
  // Immediately before the next safety review, but within the early-call threshold.
  now = current.predicted_at - 0.25 * minute
  // Assignment directly observes this clock; no synthetic push intents.
  await call(f)
  const n = (await notices(f, 'called')).at(-1)!
  expect(parsePushSnapshot(n.payload_snapshot).copyVariant).toBe('ready')
  await dispatch(f, n.id)
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(n.call_cycle).toBeGreaterThan((await notices(f, 'called'))[0]!.call_cycle)
  expect((await f.request('/notices/' + (await notices(f, 'called'))[0]!.id)).status).toBe(200)
})

it('does not replay disabled history or reset a live baseline on token rotation', async () => {
  const f = await setup('ios', false)
  await change(f, 5)
  expect(await notices(f)).toEqual([])
  expect((await f.register()).status).toBe(200)
  await tick(f, now)
  expect(await notices(f)).toEqual([])
  await change(f, 6)
  await dispatch(f, (await notices(f, 'delayed'))[0]!.id)
  const before = await f.state()
  expect((await f.register()).status).toBe(200)
  expect(await f.state()).toEqual(before)
})

it('does not advance the reference on a late acceptance after revocation', async () => {
  const f = await setup()
  await change(f, 6)
  const n = (await notices(f, 'delayed'))[0]!, reference = await f.state()
  f.send.mockImplementationOnce(async () => {
    expect((await f.request('/revoke', {})).status).toBe(200)
    return { outcome: 'accepted' }
  })
  await dispatch(f, n.id)
  expect((await notices(f, 'delayed'))[0]!.status).toBe('discarded')
  expect(await f.state()).toEqual(reference)
})

it('does not delete a rotated token on a late invalid-token response', async () => {
  const f = await setup()
  await change(f, 6)
  f.send.mockImplementationOnce(async () => {
    expect((await f.register()).status).toBe(200)
    return { outcome: 'invalid_token' }
  })
  await dispatch(f, (await notices(f, 'delayed'))[0]!.id)
  expect(await env.DB.prepare('SELECT enabled FROM mobile_push_registration WHERE installation_hash=?').bind(f.installation).first()).toEqual({ enabled: 1 })
})

it('rolls back the event, projection, and push intent together', async () => {
  const f = await setup(), before = await loadQueueState(bindings, f.queue, now)
  await expect(commitQueueTransition(bindings, f.queue, before, { config: { ...before.config!, averageMinutes: 6 } }, [
    env.DB.prepare('INSERT INTO customer_command(entry_id,request_key,request_hash,result,created_at) VALUES (NULL,NULL,NULL,NULL,NULL)'),
  ], now)).rejects.toThrow()
  expect(await notices(f)).toEqual([])
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM queue_wait_extension WHERE entry_id=?').bind(f.entry).first())?.n).toBe(0)
})

it.each([false,true])('passing a turn with a successor (already called=%s) changes the cycle without self-confirmation push', async called => {
  const f = await setup()
  const other = await joinQueue(bindings,f.queue,crypto.randomUUID(),{displayName:'Synthetic companion',partySize:1,receptionService:'check_in',locale:'es',whatsapp:{consent:false}},false,f.actor)
  expect(other.status).toBe(201)
  if(called) await call(f)
  const command={action:'yield' as const,version:await version(f)},key=crypto.randomUUID()
  await runCustomerCommand(bindings,f.queue,f.token,key,command,now)
  await runCustomerCommand(bindings,f.queue,f.token,key,command,now)
  expect((await notices(f)).filter(n=>n.status==='pending'||n.status==='sending')).toEqual([])
  expect(await f.state()).toMatchObject({reference_source:'screen'})
  expect(f.send.mock.calls.length).toBe(0)
})

it('passing while waiting without a compatible successor changes nothing and emits no push', async () => {
  const f=await setup(),before=await f.state()
  await expect(runCustomerCommand(bindings,f.queue,f.token,crypto.randomUUID(),{action:'yield',version:await version(f)},now)).rejects.toThrow('no_compatible_successor')
  expect(await f.state()).toEqual(before)
  expect(await notices(f)).toEqual([])
})

it('delivers the actual call to the mobile successor in a called-turn handoff', async () => {
  const f=await setup()
  const other=await joinQueue(bindings,f.queue,crypto.randomUUID(),{displayName:'Companion',partySize:1,receptionService:'check_in',locale:'es',whatsapp:{consent:false}},false,f.actor)
  const otherToken=(other.body as {recoveryToken:string}).recoveryToken
  await runCustomerCommand(bindings,f.queue,f.token,crypto.randomUUID(),{action:'yield',version:await version(f)},now)
  await runQueueCommand(bindings,f.actor,f.queue,crypto.randomUUID(),{action:'assign_next'},now)
  const companion=(await env.DB.prepare('SELECT version FROM queue_entry WHERE queue_id=? AND id<>?').bind(f.queue,f.entry).first<{version:number}>())!
  await runCustomerCommand(bindings,f.queue,otherToken,crypto.randomUUID(),{action:'yield',version:companion.version},now)
  const n=(await notices(f,'called')).at(-1)!
  expect(n.status).toBe('pending')
  expect(n.entry_version).toBe(await version(f))
  await dispatch(f,n.id)
  expect(f.send.mock.calls.length).toBe(1)
})

it('does not invent a notification for an unsupported staff skip', async () => {
  const f=await setup()
  await expect(runQueueCommand(bindings,f.actor,f.queue,crypto.randomUUID(),{action:'skip',entryId:f.entry,version:await version(f)},now)).rejects.toThrow('unsupported_action')
  expect(await notices(f)).toEqual([])
})

it('updates the own screen reference after editing without duplicating confirmation', async () => {
  const f = await setup('android', true, { type: 'restaurant', receptionServices: [],
    spaces: [{ id: 'terrace', name: 'Terrace', tables: 1, tableTypes: [{ seats: 4, count: 1 }] }] })
  await change(f, 6)
  expect((await notices(f, 'delayed')).length).toBeGreaterThan(0)
  await runCustomerCommand(bindings, f.queue, f.token, crypto.randomUUID(), {
    action: 'update', version: await version(f), displayName: 'PRIVATE NEW NAME', partySize: 2, preferredSpaceId: 'fastest', locale: 'en',
  }, now)
  expect(await f.state()).toMatchObject({ reference_source: 'screen', reference_notice_id: '', reference_predicted_at: (await f.projection())!.predicted_at })
  expect((await notices(f)).every(n => n.status === 'discarded')).toBe(true)
  expect(f.send.mock.calls.length).toBe(0)
})

it('keeps the legacy reader for migrated pending notices', async () => {
  const f=await setup()
  await call(f)
  const n=(await notices(f,'called'))[0]!
  await env.DB.prepare('UPDATE mobile_push_outbox SET payload_version=1,payload_snapshot=NULL WHERE id=?').bind(n.id).run()
  await dispatch(f,n.id)
  expect(f.send.mock.calls.length).toBe(1)
  expect(f.send.mock.calls[0]![3].body).toBeUndefined()
})

it('matches WhatsApp event generation for equivalent adaptive trajectories', async () => {
  const f = await setup(), wa = await fixture(), start = now
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(f.config), wa.queue).run()
  const waEnv = { ...env, WHATSAPP_COPY_VERSION: '4' }
  const joined = await joinWhatsApp(waEnv, wa.queue, 'es', '+34600000000')
  for (const m of [2, 3, 6, 9]) { now = start + m * minute; await recalculateQueue(bindings, f.queue, now); await recalculateQueue(waEnv, wa.queue, now) }
  const whatsapp = (await env.DB.prepare("SELECT kind,payload_snapshot FROM notification_outbox WHERE entry_id=? AND kind<>'queue_joined' ORDER BY rowid").bind(joined.entry_id).all<{ kind: string; payload_snapshot: string }>()).results
  expect((await notices(f)).map(n => [n.kind, JSON.parse(n.payload_snapshot).extensionSequence ?? null])).toEqual(whatsapp.map(n => [n.kind, JSON.parse(n.payload_snapshot).extensionSequence ?? null]))
})

it.each(pushVariants.flatMap(variant => (['es','en'] as const).map(locale => ({ variant, locale }))))('renders $variant in $locale without WhatsApp footers or invented details', ({ variant, locale }) => {
  const text = renderPushCopy({ schemaVersion: 2, venue: 'Venue', serviceName: 'Reception', locale, copyVariant: variant,
    ahead: null, etaMinutes: null, predictedAt: null, estimateQuality: 'unknown', resourceName: null, arrivalDeadlineAt: null })
  expect(text).toContain('Venue')
  expect(text).not.toMatch(/\*|BAJA|STOP|botón|button|https?:|0 minutos|0 minutes/)
})

it.each([['es', 1], ['es', 2], ['en', 1], ['en', 2]] as const)('renders known counts and ETA with correct number in %s (%s)', (locale, count) => {
  const text = renderPushCopy({ schemaVersion: 2, venue: 'Venue', serviceName: 'Reception', locale, copyVariant: 'approaching', ahead: count === 1 ? 0 : count,
    etaMinutes: count, predictedAt: now + count * minute, estimateQuality: 'estimated', resourceName: null, arrivalDeadlineAt: null })
  expect(text).toContain(locale === 'es' ? `${count} ${count === 1 ? 'minuto.' : 'minutos.'}` : `${count} ${count === 1 ? 'minute.' : 'minutes.'}`)
  expect(text).toContain(locale === 'es' ? `${count} ${count === 1 ? 'turno' : 'turnos'}` : `${count} ${count === 1 ? 'turn' : 'turns'}`)
})
