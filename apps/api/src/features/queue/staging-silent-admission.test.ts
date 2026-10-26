import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture } from '../../../test/whatsapp-v4-fixture'
import { app } from '../../app'
import { createAuth } from '../../auth/server'
import { hash } from './crypto'
import { expireArrivals } from './customer'
import { maintainServiceEntries } from './service-expiry'
import { manualConsentVersion, publicServiceConsentVersion, type JoinQueue, type ManualJoin } from '@noqueue/contracts/queue'
import { joinQueue, manualJoinRequiresWhatsapp, publicWhatsappAdmissionError, type JoinSource } from './entries'
import { stagingSilentAdmission } from './whatsapp-suppression'
import { serviceWindow } from '../staff/availability'
import { noticeStatement, unavailableCopyStatement, publishNotice, lifecycleNoticeStatements, type QueueNoticeKind } from './notices'
import { dispatchNotificationSerialized, reconcile } from './notifications'
import { runQueueCommand } from '../staff/commands'
import { runCustomerCommand } from './customer'
import { recalculateQueue } from './projection'
import { whatsappV4CatalogForEnvironment } from '../../integrations/whatsapp-copy-v4'
import * as transport from '../../integrations/360dialog'

const silent = (overrides: Partial<CloudflareBindings> = {}) => ({
  ...env, APP_ENV: 'staging', PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com',
  STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP: 'true', WHATSAPP_ENABLED: 'false',
  WHATSAPP_MODE: 'cloud', WHATSAPP_COPY_VERSION: '4', D360DIALOG_API_KEY: '',
  D360DIALOG_PHONE_NUMBER_ID: '', WHATSAPP_RECIPIENT_ALLOWLIST: '',
  CONFIRMATION_EXPERIMENT_ENABLED: 'false', ...overrides,
} as CloudflareBindings)
const input = (locale: 'es' | 'en' = 'es'): JoinQueue => ({
  displayName: 'Silent tester', receptionService: 'check_in', partySize: 1, locale,
  whatsapp: { consent: true, phone: '+34600000000', version: publicServiceConsentVersion },
})
const restored = () => silent({ WHATSAPP_ENABLED: 'true', STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP: 'false',
  D360DIALOG_API_KEY: 'test-only', D360DIALOG_PHONE_NUMBER_ID: 'test-only',
  ...Object.fromEntries(whatsappV4CatalogForEnvironment('staging').map(t => [t.binding, t.name])),
})
afterEach(() => vi.restoreAllMocks())
async function entry(queue: string) {
  return (await env.DB.prepare('SELECT id,whatsapp_suppressed,manual_only FROM queue_entry WHERE queue_id=? ORDER BY rowid DESC LIMIT 1')
    .bind(queue).first<{ id: string; whatsapp_suppressed: number; manual_only: number }>())!
}
async function outbox(id: string) {
  return (await env.DB.prepare('SELECT status FROM notification_outbox WHERE entry_id=?').bind(id).all()).results
}
async function service(type: 'restaurant' | 'reception' | 'pool') {
  const f = await fixture()
  const row = await env.DB.prepare('SELECT config FROM queue WHERE id=?').bind(f.queue).first<{ config: string }>()
  const config = { ...JSON.parse(row!.config), type,
    spaces: type === 'restaurant' ? [{ id: 'room', name: 'Room', tables: 2, tableTypes: [{ seats: 4, count: 2 }] }] : [],
  }
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(config), f.queue).run()
  if (type === 'restaurant') await env.DB.prepare("INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)")
    .bind(f.queue, serviceWindow(config, 'Europe/Madrid').windowId, Date.now()).run()
  return f
}

it('requires all three server conditions and never changes staff UI requirements', () => {
  expect(stagingSilentAdmission(silent())).toBe(true)
  expect(manualJoinRequiresWhatsapp(silent())).toBe(true)
  for (const overrides of [
    { APP_ENV: 'production' }, { APP_ENV: 'sandbox' }, { APP_ENV: 'local' },
    { STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP: '' }, { STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP: 'false' },
    { WHATSAPP_ENABLED: 'true' }, { WHATSAPP_ENABLED: '' },
  ]) {
    expect(stagingSilentAdmission(silent(overrides))).toBe(false)
    expect(publicWhatsappAdmissionError(silent(overrides), input().whatsapp, 'es')).toBe('whatsapp_unavailable')
  }
  expect(publicWhatsappAdmissionError(silent(), { consent: false }, 'es')).toBe('whatsapp_consent_required')
  expect(publicWhatsappAdmissionError(silent(), { consent: true, phone: '+34600000000', version: 'old' }, 'es')).toBe('whatsapp_consent_version_required')
})

for (const type of ['restaurant', 'reception', 'pool'] as const)
  for (const locale of ['es', 'en'] as const)
    for (const source of ['public-service', 'public-queue', 'staff', 'mobile-app'] as const)
      it(`admits ${source} ${type} ${locale} without transport, preserving contacts/audit`, async () => {
        const f = await service(type), mobile = source === 'mobile-app', staff = source === 'staff'
        const payload: ManualJoin = { ...input(locale), displayName: 'Silent tester', ...(type !== 'reception' ? { receptionService: undefined } : {}),
          whatsapp: mobile ? { consent: false as const } : { consent: true as const, phone: '+34600000000', version: staff ? manualConsentVersion : publicServiceConsentVersion },
        }
        const result = await joinQueue(silent(), f.queue, crypto.randomUUID(), payload, false,
          staff ? f.actor : undefined, staff ? 'legacy' : source, mobile ? crypto.randomUUID().replaceAll('-', '').repeat(2) : undefined)
        expect(result.status).toBe(201)
        expect(result.body).toMatchObject({ notification: 'disabled' })
        const e = await entry(f.queue)
        expect(e).toMatchObject({ whatsapp_suppressed: 1, manual_only: 0 })
        expect(await outbox(e.id)).toEqual([])
        const contact = await env.DB.prepare('SELECT phone_cipher FROM queue_entry_contact WHERE entry_id=?').bind(e.id).first()
        expect(Boolean(contact)).toBe(!mobile)
        if (staff) expect(await env.DB.prepare("SELECT 1 FROM staff_audit WHERE actor_id=? AND target_id=? AND action='queue.join'").bind(f.actor, e.id).first()).not.toBeNull()
        if (!mobile) expect(await env.DB.prepare('SELECT revoked_at FROM consent WHERE entry_id=?').bind(e.id).first()).toEqual({ revoked_at: null })
      })

it('preserves idempotency across toggles and rejects changed input', async () => {
  const f = await fixture(), key = crypto.randomUUID(), payload = input()
  const first = await joinQueue(silent(), f.queue, key, payload, false, undefined, 'public-service')
  expect(first.status).toBe(201)
  for (const bindings of [silent(), silent({ STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP: 'false' }), restored()]) {
    const retry = await joinQueue(bindings, f.queue, key, payload, false, undefined, 'public-service')
    expect(retry.status).toBe(200)
    expect(retry.body).toMatchObject({ code: (first.body as { code: string }).code })
  }
  expect((await joinQueue(silent(), f.queue, key, { ...payload, displayName: 'Different' }, false, undefined, 'public-service')).status).toBe(409)
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM queue_entry WHERE queue_id=?').bind(f.queue).first()).toEqual({ count: 1 })
})

it('still enforces consent, staff authorization and queue availability', async () => {
  const f = await fixture(), bindings = silent()
  expect((await joinQueue(bindings, f.queue, crypto.randomUUID(), { ...input(), whatsapp: { consent: false } }, false, f.actor)).status).toBe(400)
  await env.DB.prepare("UPDATE venue_membership SET role='viewer' WHERE user_id=?").bind(f.actor).run()
  await expect(joinQueue(bindings, f.queue, crypto.randomUUID(), input(), false, f.actor)).rejects.toThrow()
  const other = await fixture()
  await expect(joinQueue(bindings, f.queue, crypto.randomUUID(), input(), false, other.actor)).rejects.toThrow()
  await env.DB.prepare("UPDATE tenant_account SET status='suspended' WHERE organization_id=(SELECT organization_id FROM venue WHERE id=(SELECT venue_id FROM queue WHERE id=?))").bind(f.queue).run()
  expect((await joinQueue(bindings, f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')).status).toBe(409)
  const restaurant = await service('restaurant')
  await env.DB.prepare("UPDATE queue_admission SET override_state='paused' WHERE queue_id=?").bind(restaurant.queue).run()
  expect((await joinQueue(bindings, restaurant.queue, crypto.randomUUID(), { ...input(), receptionService: undefined }, false, undefined, 'public-service')).status).toBe(409)
})

it('suppresses every lifecycle producer even after reactivation and preserves normal new turns', async () => {
  const f = await fixture()
  await joinQueue(silent(), f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')
  const e = await entry(f.queue), bindings = restored()
  const snapshot = { schemaVersion: 2 as const, serviceName: 'Reception', ahead: 0, etaMinutes: 1, predictedAt: Date.now() + 60000,
    estimateQuality: 'estimated' as const, resourceName: null, arrivalDeadlineAt: null }
  for (const version of ['2', '3', '4']) {
    const b = { ...bindings, WHATSAPP_COPY_VERSION: version }
    for (const kind of ['ready', 'approaching', 'delayed', 'improved', 'expired', 'cancelled', 'service_ended'] as QueueNoticeKind[]) {
      await noticeStatement(b, e.id, kind, Date.now(), snapshot, 1, 1, true).run()
      await noticeStatement(b, e.id, kind, Date.now()).run()
      await unavailableCopyStatement(b, e.id, kind, Date.now(), crypto.randomUUID()).run()
    }
  }
  expect(await outbox(e.id)).toEqual([])
  const next = await joinQueue(bindings, f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')
  expect(next.status).toBe(201)
  expect((await entry(f.queue)).whatsapp_suppressed).toBe(0)
  expect((await outbox((await entry(f.queue)).id)).length).toBeGreaterThan(0)
})

it('cancels injected pending notices without a sender; never rewrites accepted or uncertain history', async () => {
  const f = await fixture()
  await joinQueue(silent(), f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')
  const e = await entry(f.queue), bindings = restored(), send = vi.fn()
  bindings.NOTIFICATIONS = { send } as unknown as Queue
  const sender = vi.spyOn(transport, 'createWhatsAppSender')
  for (const status of ['pending', 'accepted', 'sending', 'unknown']) {
    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind) VALUES (?,?,?,?,?,?)')
      .bind(id, e.id, id, status, Date.now(), 'ready').run()
    await dispatchNotificationSerialized(bindings, id)
    expect(await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?').bind(id).first()).toEqual({ status: status === 'pending' ? 'cancelled' : status })
  }
  await publishNotice(bindings, e.id, 'ready')
  expect(send).not.toHaveBeenCalled()
  expect(sender).not.toHaveBeenCalled()
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind) VALUES (?,?,?,'pending',?,'ready')")
    .bind(id, e.id, id, Date.now()).run()
  await reconcile(bindings)
  expect(send.mock.calls.some(([message]) => message.notificationId === id)).toBe(false)
  expect(await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?').bind(id).first()).toEqual({ status: 'cancelled' })
})

it('runs real queue operations without creating WhatsApp notices', async () => {
  const f = await fixture(), b = silent()
  const joined = await joinQueue(b, f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')
  const e = await entry(f.queue)
  await recalculateQueue(b, f.queue)
  await runCustomerCommand(b, f.queue, (joined.body as { recoveryToken: string }).recoveryToken, crypto.randomUUID(), { action: 'cancel', version: 0 })
  expect(await outbox(e.id)).toEqual([])
  expect(await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(e.id).first()).toEqual({ status: 'cancelled' })
})

it('keeps HTTP public/kiosk validation, legacy pilot protection and mobile installation protection', async () => {
  const f = await fixture(), b = silent()
  // Inject bindings at the RPC boundary; routing and real join logic both execute.
  const stub = { join: (q: string, key: string, body: JoinQueue, experiment: boolean, source: JoinSource, installation?: string) =>
    joinQueue(b, q, key, body, experiment, undefined, source, installation) }
  b.QUEUE_COORDINATOR = { jurisdiction: () => ({ getByName: () => stub }) } as unknown as DurableObjectNamespace<import('../../index').QueueCoordinator>
  const request = (path: string, body: unknown, headers = {}) => app.request('https://staging.noqueue-app.com/api/v1' + path, {
    method: 'POST', headers: { Origin: b.PUBLIC_APP_ORIGIN, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(),
      'CF-Connecting-IP': crypto.randomUUID(), ...headers }, body: JSON.stringify(body),
  }, b)
  for (const payload of [input(), { ...input('en'), preferredSpaceId: 'fastest' }])
    expect((await request(`/public/services/${f.queue}/entries`, payload)).status).toBe(201)
  expect((await request(`/public/services/${f.queue}/entries`, { ...input(), whatsapp: { ...input().whatsapp, phone: 'bad' } })).status).toBe(400)
  expect((await request(`/public/services/${f.queue}/entries`, input(), { Origin: 'https://other.invalid' })).status).toBe(403)
  expect((await request(`/public/queues/${f.queue}/entries`, input())).status).toBe(401)
  expect((await request(`/public/queues/${f.queue}/entries`, input(), { 'X-NoQueue-Pilot-Token': b.PILOT_ACCESS_TOKEN })).status).toBe(201)
  expect((await request(`/mobile/services/${f.queue}/entries`, { displayName: 'Native', partySize: 1, locale: 'es', receptionService: 'check_in' }, { Origin: 'capacitor://localhost' })).status).toBe(401)
  expect((await request(`/experiments/confirmation/queues/${f.queue}/entries`, input(), { 'X-NoQueue-Pilot-Token': b.PILOT_ACCESS_TOKEN })).status).toBe(404)
})


it('preserves authenticated staff HTTP permissions and the UI requirement flag', async () => {
  const f = await fixture(), b = silent(), password = 'test-only-silent-password-12345'
  const email = `${crypto.randomUUID()}@test.invalid`
  const auth = createAuth(b)
  const { user } = await auth.api.createUser({ body: { name: 'Staff tester', email, password, role: 'user' } })
  const venue = (await env.DB.prepare('SELECT venue_id FROM queue WHERE id=?').bind(f.queue).first<{ venue_id: string }>())!.venue_id
  const org = (await env.DB.prepare('SELECT organization_id FROM venue WHERE id=?').bind(venue).first<{ organization_id: string }>())!.organization_id
  await env.DB.batch([
    env.DB.prepare("INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,'member','now')").bind(crypto.randomUUID(), org, user.id),
    env.DB.prepare("INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,?,'queue_staff')").bind(user.id, venue),
    env.DB.prepare('INSERT INTO staff_queue_assignment(user_id,venue_id,queue_id) VALUES (?,?,?)').bind(user.id, venue, f.queue),
  ])
  const logged = await auth.api.signInEmail({ body: { email, password }, asResponse: true })
  expect(logged.status).toBe(200)
  const cookie = logged.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
  b.QUEUE_COORDINATOR = { jurisdiction: () => ({ getByName: () => ({
    staffJoin: (actor: string, queue: string, key: string, body: ManualJoin) => joinQueue(b, queue, key, body, false, actor),
  }) }) } as unknown as DurableObjectNamespace<import('../../index').QueueCoordinator>
  const request = (path: string, body?: unknown) => app.request(b.PUBLIC_APP_ORIGIN + '/api/v1/staff' + path, {
    headers: { Origin: b.PUBLIC_APP_ORIGIN, Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  }, b)
  const payload = { ...input(), whatsapp: { consent: true, phone: '+34600000000', version: manualConsentVersion } }
  expect((await request(`/queues/${f.queue}/entries`, payload)).status).toBe(201)
  const summaries = await request(`/venues/${venue}/queues`)
  expect(summaries.status).toBe(200)
  expect(await summaries.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.queue, manualJoinWhatsappRequired: true })]))
  await env.DB.prepare('DELETE FROM staff_queue_assignment WHERE user_id=?').bind(user.id).run()
  expect((await request(`/queues/${f.queue}/entries`, payload)).status).toBe(404)
  await env.DB.prepare("UPDATE venue_membership SET role='viewer' WHERE user_id=?").bind(user.id).run()
  expect((await request(`/queues/${f.queue}/entries`, payload)).status).toBe(403)
})

it.each(['complete', 'expire', 'close', 'staff_cancel'] as const)('keeps real %s transitions silent', async action => {
  const f = await fixture(), b = silent()
  await joinQueue(b, f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')
  const e = await entry(f.queue)
  const version = async () => (await env.DB.prepare('SELECT version FROM queue_entry WHERE id=?').bind(e.id).first<{ version: number }>())!.version
  if (action === 'close') {
    await env.DB.prepare('UPDATE queue_entry SET service_ends_at=? WHERE id=?').bind(Date.now() - 1, e.id).run()
    await maintainServiceEntries(b, f.queue, Date.now())
  } else if (action === 'staff_cancel') {
    await runQueueCommand(b, f.actor, f.queue, crypto.randomUUID(), { action: 'cancel', entryId: e.id, version: await version() })
  } else {
    await runQueueCommand(b, f.actor, f.queue, crypto.randomUUID(), { action: 'assign_next', expectedEntryId: e.id, expectedVersion: await version() })
    if (action === 'complete') await runQueueCommand(b, f.actor, f.queue, crypto.randomUUID(), { action: 'complete', entryId: e.id, version: await version() })
    else await expireArrivals(b, f.queue, Date.now() + 6 * 60000)
  }
  expect(await outbox(e.id)).toEqual([])
})

it('preserves native HTTP enrollment, single-active ownership and push generation', async () => {
  const f = await fixture(), b = silent({ MOBILE_PUSH_ENABLED: 'true' })
  const identity = crypto.randomUUID().replaceAll('-', '').repeat(2)
  const installation = await hash(`mobile-installation:v1:${identity}`)
  b.QUEUE_COORDINATOR = { jurisdiction: () => ({ getByName: () => ({
    join: (q: string, key: string, body: JoinQueue, experiment: boolean, source: JoinSource, owner: string) => joinQueue(b, q, key, body, experiment, undefined, source, owner),
    refresh: (q: string) => recalculateQueue(b, q),
  }) }) } as unknown as DurableObjectNamespace<import('../../index').QueueCoordinator>
  const response = await app.request(b.PUBLIC_APP_ORIGIN + `/api/v1/mobile/services/${f.queue}/entries`, {
    method: 'POST', headers: { Origin: 'capacitor://localhost', Authorization: `Bearer ${identity}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ displayName: 'Native tester', receptionService: 'check_in', partySize: 1, locale: 'en' }),
  }, b)
  expect(response.status).toBe(201)
  const e = await entry(f.queue)
  await env.DB.prepare("INSERT INTO mobile_push_registration(installation_hash,provider,token_hash,token_cipher,locale,enabled,updated_at) VALUES (?,'fcm',?,?,'en',1,?)")
    .bind(installation, crypto.randomUUID(), 'test-not-dispatched', Date.now()).run()
  await env.DB.batch(lifecycleNoticeStatements(b, e.id, 'ready', Date.now(), {
    schemaVersion: 2, serviceName: 'Reception', ahead: 0, etaMinutes: 0, predictedAt: Date.now(), estimateQuality: 'estimated', resourceName: null, arrivalDeadlineAt: Date.now() + 60000,
  }, 1, 1, true))
  expect(await env.DB.prepare('SELECT 1 FROM mobile_push_outbox WHERE entry_id=?').bind(e.id).first()).not.toBeNull()
  expect(await outbox(e.id)).toEqual([])
  const next = await fixture()
  expect((await joinQueue(b, next.queue, crypto.randomUUID(), { ...input(), whatsapp: { consent: false } }, false, undefined, 'mobile-app', installation)).status).toBe(409)
})

it('retains capacity and scheduled closure checks', async () => {
  const f = await fixture(), b = silent()
  const row = await env.DB.prepare('SELECT config FROM queue WHERE id=?').bind(f.queue).first<{ config: string }>()
  const config = { ...JSON.parse(row!.config), capacity: 1 }
  await env.DB.prepare('UPDATE queue SET config=?,capacity=1 WHERE id=?').bind(JSON.stringify(config), f.queue).run()
  expect((await joinQueue(b, f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')).status).toBe(201)
  expect((await joinQueue(b, f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')).status).toBe(409)
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify({ ...config, twentyFourHours: false, schedules: [{ day: (serviceWindow(config, 'Europe/Madrid').day + 1) % 7, from: '09:00', to: '10:00' }] }), f.queue).run()
  expect((await joinQueue(b, f.queue, crypto.randomUUID(), input(), false, undefined, 'public-service')).status).toBe(409)
})
