import { env } from 'cloudflare:workers'
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { app } from './app'
import {
  dispatchNotification,
  dispatchNotificationSerialized,
  processWebhook,
  reconcile,
} from './features/queue/notifications'
import { createWhatsAppSender } from './integrations/360dialog'
import { experimentQueueId } from './features/queue/experiment'
const network = setupNetwork()
beforeAll(() => network.enable())
afterAll(() => network.disable())
afterEach(() => network.resetHandlers())
beforeEach(async () => {
  await env.DB.batch(
    [
      'experiment_action',
      'whatsapp_contact_state',
      'webhook_event',
      'notification_outbox',
      'consent',
      'queue_confirmation',
      'queue_event',
      'queue_entry_contact',
      'queue_entry',
      'pilot_rate',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  )
  network.use(http.all('*', () => HttpResponse.error()))
  network.use(
    http.post('https://noqueue-experiment.invalid/messages', () =>
      HttpResponse.json({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] }),
    ),
  )
})
const prefix = '/api/v1/experiments/confirmation'
const input = {
  phone: '+34600000000',
  partySize: 2,
  locale: 'es',
  priorContactAuthorization: true,
}
const headers = (key = crypto.randomUUID()) => ({
  'Content-Type': 'application/json',
  'X-NoQueue-Pilot-Token': env.PILOT_ACCESS_TOKEN,
  'Idempotency-Key': key,
})
const action = (name: string, key = crypto.randomUUID()) =>
  app.request(
    `http://localhost${prefix}/${name}`,
    { method: 'POST', headers: headers(key), body: '{}' },
    env,
  )
async function create() {
  const r = await app.request(
    `http://localhost${prefix}/queues/${experimentQueueId}/entries`,
    { method: 'POST', headers: headers(), body: JSON.stringify(input) },
    env,
  )
  expect(r.status).toBe(201)
  return env.DB.prepare(
    'SELECT entry_id,payload FROM queue_confirmation ORDER BY rowid DESC LIMIT 1',
  )
    .first<{ entry_id: string; payload: string }>()
    .then((row) => row!)
}
async function receive(body: string, process = true) {
  const r = await app.request(
    `http://localhost/api/v1/integrations/360dialog/webhook/${env.D360DIALOG_WEBHOOK_TOKEN}`,
    {
      method: 'POST',
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: crypto.randomUUID(),
                      from: '34600000000',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: { body },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    },
    env,
  )
  expect(r.status).toBe(200)
  if (process) {
    const rows = await env.DB.prepare(
      'SELECT id FROM webhook_event WHERE processed_at IS NULL',
    ).all<{ id: string }>()
    for (const row of rows.results) await processWebhook(env, row.id)
  }
}
async function confirmed() {
  await action('seed')
  const e = await create()
  await dispatchNotification(env, e.entry_id)
  await receive('CONFIRMO')
  expect(
    await env.DB.prepare('SELECT purpose FROM consent WHERE entry_id=?')
      .bind(e.entry_id)
      .first(),
  ).toEqual({ purpose: 'queue_updates' })
  return e
}
async function pending() {
  return (
    await env.DB.prepare(
      "SELECT id,position,status FROM notification_outbox WHERE kind='position_update' ORDER BY rowid",
    ).all<{ id: string; position: number; status: string }>()
  ).results
}

it('protects data and mutations and keeps the real page free of embedded secrets', async () => {
  expect(
    (await app.request(`http://localhost${prefix}/state`, {}, env)).status,
  ).toBe(401)
  expect(
    (
      await app.request(
        `http://localhost${prefix}/seed`,
        {
          method: 'POST',
          headers: { ...headers(), Origin: 'https://evil.invalid' },
        },
        env,
      )
    ).status,
  ).toBe(403)
  const page = await app.request(`http://localhost${prefix}`, {}, env)
  expect(page.headers.get('Content-Security-Policy')).toContain(
    "frame-ancestors 'none'",
  )
  const html = await page.text()
  expect(html).toContain('EXPERIMENTO')
  expect(html).not.toContain(env.PILOT_ACCESS_TOKEN)
  expect(html).not.toContain('Simulate')
})
it('uses exact approved v3 template components, es locale and real cloud endpoint only under separate staging gates', async () => {
  let calls = 0
  network.use(
    http.post('https://waba-v2.360dialog.io/messages', async ({ request }) => {
      calls++
      expect(await request.json()).toEqual({
        messaging_product: 'whatsapp',
        to: '34600000000',
        type: 'template',
        template: {
          name: 'noqueue_queue_optin_confirm_pilot_v3',
          language: { code: 'es' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: 'ABCDEF' }] },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '0',
              parameters: [{ type: 'payload', payload: 'correlation' }],
            },
          ],
        },
      })
      return HttpResponse.json({ messages: [{ id: 'wamid.real-boundary' }] })
    }),
  )
  const staging = {
    ...env,
    APP_ENV: 'staging',
    WHATSAPP_MODE: 'cloud',
    STAGING_EXPERIMENT_APPROVED: 'true',
    STAGING_CONSENT_APPROVED: 'false',
  }
  const message = {
    phone: input.phone,
    locale: 'es' as const,
    venue: 'Demo',
    code: 'ABCDEF',
    token: 'unused',
    confirmationPayload: 'correlation',
  }
  expect((await createWhatsAppSender(staging).send(message)).kind).toBe(
    'accepted',
  )
  expect(
    (
      await createWhatsAppSender({
        ...staging,
        STAGING_EXPERIMENT_APPROVED: 'false',
      }).send(message)
    ).kind,
  ).toBe('failed')
  expect(
    (
      await createWhatsAppSender({ ...staging, APP_ENV: 'sandbox' }).send(
        message,
      )
    ).kind,
  ).toBe('failed')
  expect(calls).toBe(1)
})
it('seeds idempotently, limits one tester and serializes duplicate advances', async () => {
  const key = crypto.randomUUID()
  await Promise.all([action('seed', key), action('seed', key)])
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM queue_entry WHERE status='waiting'",
    ).first(),
  ).toEqual({ n: 3 })
  expect((await action('advance', key)).status).toBe(409)
  await create()
  const retry = await app.request(
    `http://localhost${prefix}/queues/${experimentQueueId}/entries`,
    { method: 'POST', headers: headers(), body: JSON.stringify(input) },
    env,
  )
  expect(retry.status).toBe(409)
  const advanceKey = crypto.randomUUID()
  await Promise.all([
    action('advance', advanceKey),
    action('advance', advanceKey),
  ])
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM queue_entry WHERE status='waiting'",
    ).first(),
  ).toEqual({ n: 3 })
  expect(await pending()).toHaveLength(0)
})
it('sends meaningful true position updates only after confirmation and coalesces old pending snapshots', async () => {
  await confirmed()
  await action('advance')
  await action('advance')
  let rows = await pending()
  expect(rows.map((r) => [r.position, r.status])).toEqual([
    [3, 'cancelled'],
    [2, 'pending'],
  ])
  const messages: string[] = []
  network.use(
    http.post(
      'https://noqueue-experiment.invalid/messages',
      async ({ request }) => {
        const body = (await request.json()) as {
          type: string
          text: { body: string }
        }
        expect(body.type).toBe('text')
        messages.push(body.text.body)
        return HttpResponse.json({ messages: [{ id: crypto.randomUUID() }] })
      },
    ),
  )
  for (const row of rows) await dispatchNotification(env, row.id)
  await dispatchNotification(env, rows[1]!.id)
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain('queda 1 turno delante')
  await action('advance')
  rows = await pending()
  await dispatchNotification(env, rows[2]!.id)
  expect(messages[1]).toContain('eres el siguiente')
  expect(messages[1]).toContain('no significa que tu mesa esté lista')
  await action('advance')
  expect(await pending()).toHaveLength(3)
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM queue_entry WHERE status='waiting'",
    ).first(),
  ).toEqual({ n: 0 })
})
it('blocks a persisted but unprocessed BAJA, never reactivates, and preserves suppression across reset', async () => {
  await confirmed()
  await action('advance')
  const row = (await pending())[0]!
  await receive('BAJA', false)
  await dispatchNotification(env, row.id)
  expect((await pending())[0]?.status).toBe('cancelled')
  await receive('CONFIRMO')
  await action('advance')
  expect(await pending()).toHaveLength(1)
  await action('seed')
  const r = await app.request(
    `http://localhost${prefix}/queues/${experimentQueueId}/entries`,
    { method: 'POST', headers: headers(), body: JSON.stringify(input) },
    env,
  )
  expect(r.status).toBe(403)
  expect(await r.json()).toEqual({ error: 'contact_stopped' })
})
it('expires freeform at dispatch, does not reuse opt-in templates, and unrelated inbound only renews the window', async () => {
  await confirmed()
  await action('advance')
  await env.DB.prepare('UPDATE whatsapp_contact_state SET last_inbound_at=?')
    .bind(Date.now() - 86400001)
    .run()
  await dispatchNotification(env, (await pending())[0]!.id)
  expect((await pending())[0]?.status).toBe('cancelled')
  await receive('hola')
  await action('advance')
  expect((await pending())[1]?.status).toBe('pending')
})
it('retains unknown outcomes without retries and blocks later messages that could overtake them', async () => {
  await confirmed()
  await action('advance')
  const first = (await pending())[0]!
  let calls = 0
  network.use(
    http.post('https://noqueue-experiment.invalid/messages', () => {
      calls++
      return HttpResponse.error()
    }),
  )
  await dispatchNotification(env, first.id)
  await reconcile(env)
  await dispatchNotification(env, first.id)
  expect((await pending())[0]?.status).toBe('unknown')
  await action('advance')
  await dispatchNotification(env, (await pending())[1]!.id)
  expect(calls).toBe(1)
  expect((await pending())[1]?.status).toBe('cancelled')
  await action('seed')
  const retry = await app.request(
    `http://localhost${prefix}/queues/${experimentQueueId}/entries`,
    { method: 'POST', headers: headers(), body: JSON.stringify(input) },
    env,
  )
  expect(retry.status).toBe(409)
  expect(await retry.json()).toEqual({ error: 'unknown_delivery_unresolved' })
})
it('serializes dispatch with queue advancement, so a newer position cannot overtake an in-flight request', async () => {
  await confirmed()
  await action('advance')
  const first = (await pending())[0]!
  let release!: () => void
  let entered!: () => void
  const atProvider = new Promise<void>((r) => {
    entered = r
  })
  const gate = new Promise<void>((r) => {
    release = r
  })
  network.use(
    http.post('https://noqueue-experiment.invalid/messages', async () => {
      entered()
      await gate
      return HttpResponse.json({ messages: [{ id: 'wamid.inflight' }] })
    }),
  )
  const sending = dispatchNotification(env, first.id)
  await atProvider
  const advancing = action('advance')
  expect(await pending()).toHaveLength(1)
  release()
  await sending
  await advancing
  expect((await pending()).map((r) => r.position)).toEqual([3, 2])
})

// workerd does not implement jurisdiction restrictions. Adapt only that platform
// selector while preserving the actual DO, D1, auth, domain and outbox behavior.
const localEuNamespace = new Proxy(env.QUEUE_COORDINATOR, {
  get(target, property) {
    if (property === 'jurisdiction')
      return (jurisdiction: string) => {
        expect(jurisdiction).toBe('eu')
        return target
      }
    const value = Reflect.get(target, property)
    return typeof value === 'function' ? value.bind(target) : value
  },
})

it('opens recipients only for authenticated, consented staging experiment enrollment', async () => {
  const staging = {
    ...env,
    APP_ENV: 'staging',
    WHATSAPP_MODE: 'cloud',
    STAGING_EXPERIMENT_APPROVED: 'true',
    STAGING_EXPERIMENT_OPEN_RECIPIENTS: 'true',
    QUEUE_COORDINATOR: localEuNamespace,
  }
  const body = { ...input, phone: '+34611111111' }
  const join = (
    bindings = staging,
    value: unknown = body,
    requestHeaders = headers(),
    queue = experimentQueueId,
  ) =>
    app.request(
      `http://localhost${prefix}/queues/${queue}/entries`,
      { method: 'POST', headers: requestHeaders, body: JSON.stringify(value) },
      bindings,
    )
  expect(
    (await join({ ...staging, STAGING_EXPERIMENT_OPEN_RECIPIENTS: 'false' }))
      .status,
  ).toBe(403)
  expect(
    (await join(staging, body, { ...headers(), 'X-NoQueue-Pilot-Token': '' }))
      .status,
  ).toBe(401)
  expect(
    (await join(staging, { ...body, priorContactAuthorization: false })).status,
  ).toBe(400)
  expect((await join(staging, body, headers(), 'demo-queue')).status).toBe(404)
  expect((await join({ ...staging, APP_ENV: 'sandbox' })).status).toBe(404)
  expect(
    (
      await app.request(
        'http://localhost/api/v1/public/queues/demo-queue/entries',
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            partySize: 2,
            locale: 'es',
            whatsapp: {
              consent: true,
              phone: body.phone,
              version: 'whatsapp-queue-updates-v1',
            },
          }),
        },
        staging,
      )
    ).status,
  ).toBe(403)
  expect((await join()).status).toBe(201)
  let calls = 0
  network.use(
    http.post('https://waba-v2.360dialog.io/messages', async ({ request }) => {
      calls++
      expect(((await request.json()) as { to: string }).to).toBe('34611111111')
      return HttpResponse.json({ messages: [{ id: 'wamid.open-recipient' }] })
    }),
  )
  const notification = await env.DB.prepare(
    'SELECT id FROM notification_outbox',
  ).first<{ id: string }>()
  await dispatchNotificationSerialized(staging, notification!.id)
  expect(calls).toBe(1)
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox').first(),
  ).toEqual({ status: 'accepted' })
  // Neither ordinary kinds nor other queues inherit the exception, even with
  // the ordinary staging consent gate enabled.
  await env.DB.prepare(
    "UPDATE notification_outbox SET kind='queue_joined',status='pending',provider_id=NULL",
  ).run()
  await dispatchNotificationSerialized(
    { ...staging, STAGING_CONSENT_APPROVED: 'true' },
    notification!.id,
  )
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox').first(),
  ).toEqual({ status: 'cancelled' })
  await env.DB.prepare(
    "UPDATE notification_outbox SET kind='confirmation',status='pending'",
  ).run()
  await env.DB.prepare("UPDATE queue_entry SET queue_id='demo-queue'").run()
  await dispatchNotificationSerialized(staging, notification!.id)
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox').first(),
  ).toEqual({ status: 'cancelled' })
  expect(calls).toBe(1)
})

it('preserves STOP safety when open experiment recipients are enabled', async () => {
  const staging = {
    ...env,
    APP_ENV: 'staging',
    WHATSAPP_MODE: 'cloud',
    STAGING_EXPERIMENT_APPROVED: 'true',
    STAGING_EXPERIMENT_OPEN_RECIPIENTS: 'true',
    QUEUE_COORDINATOR: localEuNamespace,
  }
  await confirmed()
  await receive('BAJA')
  await action('seed')
  const response = await app.request(
    `http://localhost${prefix}/queues/${experimentQueueId}/entries`,
    { method: 'POST', headers: headers(), body: JSON.stringify(input) },
    staging,
  )
  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({ error: 'contact_stopped' })
})

it('dispatches open-recipient position updates only after actual correlated confirmation', async () => {
  const staging = {
    ...env,
    APP_ENV: 'staging',
    WHATSAPP_MODE: 'cloud',
    STAGING_EXPERIMENT_APPROVED: 'true',
    STAGING_EXPERIMENT_OPEN_RECIPIENTS: 'true',
    D360DIALOG_PHONE_NUMBER_ID: 'fixture-open-number',
    QUEUE_COORDINATOR: localEuNamespace,
  }
  await action('seed')
  const response = await app.request(
    `http://localhost${prefix}/queues/${experimentQueueId}/entries`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ...input, phone: '+34611111111' }),
    },
    staging,
  )
  expect(response.status).toBe(201)
  const outbound: string[] = []
  network.use(
    http.post('https://waba-v2.360dialog.io/messages', async ({ request }) => {
      const body = (await request.json()) as { to: string; type: string }
      expect(body.to).toBe('34611111111')
      outbound.push(body.type)
      return HttpResponse.json({
        messages: [{ id: `wamid.open.${outbound.length}` }],
      })
    }),
  )
  const entry = await env.DB.prepare(
    'SELECT entry_id,payload FROM queue_confirmation',
  ).first<{ entry_id: string; payload: string }>()
  await dispatchNotificationSerialized(staging, entry!.entry_id)
  expect(await pending()).toHaveLength(0)
  const inbound = await app.request(
    'http://localhost/api/v1/integrations/360dialog/webhook',
    {
      method: 'POST',
      headers: { 'X-NoQueue-Webhook-Token': env.D360DIALOG_WEBHOOK_TOKEN },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'fixture-open-number' },
                  messages: [
                    {
                      id: 'inbound-open-test',
                      from: '34611111111',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'button',
                      button: { text: 'CONFIRMO', payload: entry!.payload },
                      context: { id: 'wamid.open.1' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    },
    staging,
  )
  expect(inbound.status).toBe(200)
  const event = await env.DB.prepare('SELECT id FROM webhook_event').first<{
    id: string
  }>()
  await processWebhook(staging, event!.id)
  expect(await env.DB.prepare('SELECT purpose FROM consent').first()).toEqual({
    purpose: 'queue_updates',
  })
  await action('advance')
  const position = (await pending())[0]!
  await dispatchNotificationSerialized(staging, position.id)
  await dispatchNotificationSerialized(staging, position.id)
  expect(outbound).toEqual(['template', 'text'])
})
