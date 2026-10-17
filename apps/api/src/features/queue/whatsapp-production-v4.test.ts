import { env } from 'cloudflare:workers'
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest'
import { setupNetwork } from '../../../test/fake-network'
import { fixture, join, status } from '../../../test/whatsapp-v4-fixture'
import { http, HttpResponse } from 'msw'
import { manualConsentVersion, publicServiceConsentVersion } from '@noqueue/contracts/queue'
import { whatsappV4CatalogForEnvironment } from '../../integrations/whatsapp-copy-v4'
import { whatsappV3Catalog } from '../../integrations/whatsapp-copy-v3'
import { createWhatsAppSender } from '../../integrations/360dialog'
import { joinQueue, publicWhatsappAdmissionError } from './entries'
import { dispatchNotificationSerialized } from './notifications'
import { runWhatsAppAction } from './customer'
import { phoneHash } from './crypto'
import { signWhatsAppAction } from './whatsapp-actions'
const network = setupNetwork()
beforeAll(() => network.enable())
afterAll(() => network.disable())
afterEach(() => network.resetHandlers())
const endpoint = 'https://waba-v2.360dialog.io/messages'
function production(overrides: Partial<CloudflareBindings> = {}) {
  return {
    ...env, APP_ENV: 'production', WHATSAPP_MODE: 'cloud', WHATSAPP_COPY_VERSION: '4',
    WHATSAPP_ENABLED: 'true', PRODUCTION_WHATSAPP_APPROVED: 'true', WHATSAPP_V4_TEMPLATES_APPROVED: 'true',
    CONFIRMATION_EXPERIMENT_ENABLED: 'false', PUBLIC_APP_ORIGIN: 'https://app.noqueue-app.com',
    D360DIALOG_PHONE_NUMBER_ID: 'test-only-phone-id', STAGING_CONSENT_APPROVED: 'false',
    WHATSAPP_RECIPIENT_ALLOWLIST: '',
    ...Object.fromEntries(whatsappV4CatalogForEnvironment('production').map((t) => [t.binding, t.name])),
    ...overrides,
  } as CloudflareBindings
}
const contact = { consent: true, phone: '+34600000011', version: publicServiceConsentVersion } as const
it('opens production only after its own approval, without staging flags or an allowlist', () => {
  const absent = production(); delete absent.PRODUCTION_WHATSAPP_APPROVED
  expect(publicWhatsappAdmissionError(absent, contact, 'es')).toBe('whatsapp_unavailable')
  for (const locale of ['es', 'en'] as const)
    expect(publicWhatsappAdmissionError(production(), contact, locale)).toBeNull()
  expect(publicWhatsappAdmissionError(production(), { consent: false }, 'es')).toBe('whatsapp_consent_required')
  expect(publicWhatsappAdmissionError(production(), { ...contact, version: 'old' }, 'es')).toBe('whatsapp_consent_version_required')
})
const denied = [
  { PRODUCTION_WHATSAPP_APPROVED: '' }, { PRODUCTION_WHATSAPP_APPROVED: 'false' },
  { WHATSAPP_V4_TEMPLATES_APPROVED: 'false' }, { WHATSAPP_ENABLED: 'false' },
  { WHATSAPP_MODE: 'sandbox' }, { WHATSAPP_COPY_VERSION: '3' },
  { PUBLIC_APP_ORIGIN: 'https://noqueue-app.com' }, { PUBLIC_APP_ORIGIN: 'https://staging.noqueue-app.com' },
  { D360DIALOG_API_KEY: '' }, { D360DIALOG_PHONE_NUMBER_ID: '' },
  { WHATSAPP_QUEUE_V4_QUEUE_JOINED_TEMPLATE_ES: 'noqueue_v4_queue_joined_es_staging' },
  { WHATSAPP_QUEUE_V4_APPROACHING_TEMPLATE_ES: '' },
]
it.each(denied)('fails closed despite staging approval and allowlisting: %j', (override) => {
  const bindings = production({ ...override, STAGING_CONSENT_APPROVED: 'true', WHATSAPP_RECIPIENT_ALLOWLIST: contact.phone })
  expect(publicWhatsappAdmissionError(bindings, contact, 'es')).toBe('whatsapp_unavailable')
})
it('the sender cannot bypass the production approval using a service-window reply', async () => {
  const fetcher = vi.fn()
  const result = await createWhatsAppSender(production({ PRODUCTION_WHATSAPP_APPROVED: 'false' }), fetcher).send({
    phone: contact.phone, locale: 'es', venue: 'Example', code: 'EXAMPLE', token: 'synthetic',
    serviceWindowReply: true, textBody: 'Example',
  })
  expect(result.kind).toBe('failed')
  expect(fetcher).not.toHaveBeenCalled()
})
it.each(['public', 'manual'] as const)('dispatches ES and EN %s joins to two phones outside the allowlist', async (source) => {
  const { actor, queue } = await fixture(), bindings = production(), sent: {
    to: string
    template: {
      name: string
      language: {
        code: string
      }
    }
  }[] = []
  network.use(http.post(endpoint, async ({ request }) => {
    sent.push(await request.json() as typeof sent[number])
    return HttpResponse.json({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] })
  }))
  for (const [locale, phone] of [['es', '+34600000011'], ['en', '+34600000012']] as const) {
    const notice = await join(bindings, queue, locale, phone, source === 'manual' ? actor : undefined)
    await dispatchNotificationSerialized(bindings, notice.id)
    expect(await status(notice.id)).toEqual({ status: 'accepted', attempts: 1 })
  }
  expect(sent.map((m) => [m.to, m.template.name, m.template.language.code])).toEqual([
    ['34600000011', 'noqueue_v4_queue_joined_es_production', 'es_ES'],
    ['34600000012', 'noqueue_v4_queue_joined_en_production', 'en_US'],
  ])
})
it.each(['public', 'manual'] as const)('keeps a %s turn after pending-template rejection and sends a new turn after provider approval without changing configuration', async (source) => {
  const { queue, actor } = await fixture(), bindings = production()
  let approved = false, attempts = 0
  network.use(http.post(endpoint, () => {
    attempts++
    return approved ? HttpResponse.json({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] }) : HttpResponse.json({ error: { code: 132001 } }, { status: 400 })
  }))
  const first = await join(bindings, queue, 'es', contact.phone, source === 'manual' ? actor : undefined)
  await dispatchNotificationSerialized(bindings, first.id)
  expect(await status(first.id)).toEqual({ status: 'failed', attempts: 1 })
  expect(await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(first.entry_id).first()).toEqual({ status: 'waiting' })
  approved = true
  await dispatchNotificationSerialized(bindings, first.id)
  const next = await join(bindings, queue, 'en', '+34600000012', source === 'manual' ? actor : undefined)
  await dispatchNotificationSerialized(bindings, next.id)
  expect(await status(next.id)).toEqual({ status: 'accepted', attempts: 1 })
  expect(attempts).toBe(2)
})
it.each([1, 2, 3] as const)('does not expand recipients for a frozen V%s notice when the current profile is V4', async (version) => {
  const { queue } = await fixture(), bindings = production(), notice = await join(bindings, queue, 'es', contact.phone)
  await env.DB.prepare('UPDATE notification_outbox SET payload_version=?,payload_snapshot=json_set(payload_snapshot,\'$.copyVersion\',?) WHERE id=?').bind(version === 1 ? 1 : 2, version, notice.id).run()
  let calls = 0
  network.use(http.post(endpoint, () => { calls++; return HttpResponse.json({ messages: [{ id: 'unexpected' }] }); }))
  await dispatchNotificationSerialized({ ...bindings, STAGING_CONSENT_APPROVED: 'true', WHATSAPP_V2_TEMPLATES_APPROVED: 'true', WHATSAPP_V3_TEMPLATES_APPROVED: 'true', ...Object.fromEntries(whatsappV3Catalog.map((t) => [t.binding, t.name])) }, notice.id)
  expect(await status(notice.id)).toEqual({ status: 'cancelled', attempts: 0 })
  expect(calls).toBe(0)
})
it('sends one authenticated action result outside the allowlist without restoring STOP consent', async () => {
  const { queue } = await fixture(), bindings = production(), notice = await join(bindings, queue, 'es', contact.phone)
  const now = Date.now(), context = { phase: 'waiting' as const, callCycle: 0, expiresAt: now + 60000 }, senderHash = await phoneHash(bindings, contact.phone)
  await env.DB.prepare('UPDATE notification_outbox SET kind=\'approaching\',status=\'accepted\',provider_id=\'wamid.action\',accepted_at=?,payload_snapshot=json_set(payload_snapshot,\'$.copyVariant\',\'approaching\',\'$.actionContext\',json(?)) WHERE id=?').bind(now, JSON.stringify(context), notice.id).run()
  const signed = await signWhatsAppAction(bindings.RECOVERY_TOKEN_KEY, { notificationId: notice.id, entryId: notice.entry_id, action: 'cancel', ...context })
  for (const payload of ['wa1.c.' + '0'.repeat(64), signed, signed]) {
    const event = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO webhook_event(id,dedupe_key,kind,provider_id,phone_hash,occurred_at,received_at,confirmation_payload,context_id) VALUES (?, ?,\'action\',?,?,?,?,?,\'wamid.action\')').bind(event, event, `wamid.${event}`, senderHash, now, now, payload).run()
    await runWhatsAppAction(bindings, queue, event)
    if (payload !== signed)
      expect(await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(notice.entry_id).first()).toEqual({ status: 'waiting' })
  }
  const replies = await env.DB.prepare('SELECT id FROM notification_outbox WHERE entry_id=? AND kind=\'action_result\'').bind(notice.entry_id).all<{
    id: string
  }>()
  expect(replies.results).toHaveLength(1)
  await env.DB.prepare('UPDATE consent SET revoked_at=? WHERE entry_id=?').bind(now, notice.entry_id).run()
  let payload: Record<string, unknown> | undefined
  network.use(http.post(endpoint, async ({ request }) => { payload = await request.json() as Record<string, unknown>; return HttpResponse.json({ messages: [{ id: 'wamid.result' }] }); }))
  await dispatchNotificationSerialized(bindings, replies.results[0]!.id)
  expect(await status(replies.results[0]!.id)).toEqual({ status: 'accepted', attempts: 1 })
  expect(payload).toMatchObject({ to: '34600000011', type: 'interactive', interactive: { type: 'cta_url' } })
  expect(await env.DB.prepare('SELECT revoked_at FROM consent WHERE entry_id=?').bind(notice.entry_id).first()).toEqual({ revoked_at: now })
})
it('does not bypass a pending STOP or retry an unknown provider outcome', async () => {
  const { queue } = await fixture(), bindings = production(), stopped = await join(bindings, queue, 'es', contact.phone)
  const now = Date.now(), event = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO webhook_event(id,dedupe_key,kind,provider_id,phone_hash,occurred_at,received_at) VALUES (?, ?,\'opt_out\',?,?,?,?)').bind(event, event, `wamid.${event}`, await phoneHash(bindings, contact.phone), now, now).run()
  let calls = 0
  network.use(http.post(endpoint, () => { calls++; return new HttpResponse(null, { status: 503 }); }))
  await dispatchNotificationSerialized(bindings, stopped.id)
  expect(calls).toBe(0)
  const uncertain = await join(bindings, queue, 'en', '+34600000012')
  await dispatchNotificationSerialized(bindings, uncertain.id)
  await dispatchNotificationSerialized(bindings, uncertain.id)
  expect(await status(uncertain.id)).toEqual({ status: 'unknown', attempts: 1 })
  expect(calls).toBe(1)
})
it('bounds cloud V4 rate-limit retries to three attempts without downgrading the payload', async () => {
  const { queue } = await fixture(), bindings = production(), notice = await join(bindings, queue, 'es', '+34600000013')
  const names: string[] = []
  network.use(http.post(endpoint, async ({ request }) => {
    const payload = await request.json() as {
      template: {
        name: string
      }
    }
    names.push(payload.template.name)
    return new HttpResponse(null, { status: 429 })
  }))
  for (let attempt = 0; attempt < 4; attempt++) {
    await env.DB.prepare('UPDATE notification_outbox SET next_attempt_at=0 WHERE id=?').bind(notice.id).run()
    await dispatchNotificationSerialized(bindings, notice.id)
  }
  expect(await status(notice.id)).toEqual({ status: 'failed', attempts: 3 })
  expect(names).toEqual(Array(3).fill('noqueue_v4_queue_joined_es_production'))
})
it('keeps manual production admission closed when sender prerequisites are missing', async () => {
  const { queue, actor } = await fixture()
  for (const overrides of [
    { D360DIALOG_API_KEY: '' },
    { D360DIALOG_PHONE_NUMBER_ID: '' },
    { WHATSAPP_QUEUE_V4_QUEUE_JOINED_TEMPLATE_ES: '' },
    { PUBLIC_APP_ORIGIN: 'https://example.test' },
  ]) {
    const result = await joinQueue(production(overrides), queue, crypto.randomUUID(), {
      displayName: 'Example customer', receptionService: 'check_in', partySize: 1, locale: 'es',
      whatsapp: { consent: true, phone: '+34600000014', version: manualConsentVersion },
    }, false, actor)
    expect(result).toMatchObject({ status: 503, body: { error: 'whatsapp_unavailable' } })
  }
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM queue_entry WHERE queue_id=?').bind(queue).first()).toEqual({ count: 0 })
})
it('keeps committed join recovery idempotent after closing the production gate', async () => {
  const { queue } = await fixture(), bindings = production(), key = crypto.randomUUID()
  const input = {
    displayName: 'Example customer', receptionService: 'check_in' as const, partySize: 1, locale: 'es' as const,
    whatsapp: { ...contact },
  }
  const first = await joinQueue(bindings, queue, key, input, false, undefined, 'public-service')
  expect(first.status).toBe(201)
  const closed = { ...bindings, PRODUCTION_WHATSAPP_APPROVED: 'false' }
  const recovered = await joinQueue(closed, queue, key, input, false, undefined, 'public-service')
  expect(recovered.status).toBe(200)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM queue_entry WHERE queue_id=?').bind(queue).first()).toEqual({ n: 1 })
  const fresh = await joinQueue(closed, queue, crypto.randomUUID(), input, false, undefined, 'public-service')
  expect(fresh).toMatchObject({ status: 503, body: { error: 'whatsapp_unavailable' } })
})
