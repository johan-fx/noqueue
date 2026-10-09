import { env } from 'cloudflare:workers'
import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { app } from './app'
import {
  createWhatsAppSender,
  whatsappWebhookParser,
} from './integrations/360dialog'
import {
  dispatchNotification,
  processWebhook,
  reconcile,
} from './features/queue/notifications'
import { joinQueue } from './features/queue/entries'
import {
  joinedEntrySchema,
  publicServiceConsentVersion,
} from '@noqueue/contracts/queue'
import { decryptPhone, hash, secureEqual } from './features/queue/crypto'

const network = setupNetwork()
beforeAll(() => network.enable())
afterAll(() => network.disable())
afterEach(() => network.resetHandlers())
beforeEach(async () => {
  await env.DB.batch(
    [
      'webhook_event',
      'notification_outbox',
      'consent',
      'queue_event',
      'queue_entry_contact',
      'queue_entry',
      'pilot_rate',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  )
})
const request = (path: string, init?: RequestInit) =>
  app.request(`http://localhost/api/v1${path}`, init, env)
const input = (consent = true) => ({
  partySize: 2,
  locale: 'es',
  whatsapp: consent
    ? {
        consent: true,
        phone: '+34600000000',
        version: 'whatsapp-queue-updates-v1',
      }
    : { consent: false },
})
const join = (key = crypto.randomUUID(), body = input()) =>
  request('/public/queues/demo-queue/entries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      'X-NoQueue-Pilot-Token': env.PILOT_ACCESS_TOKEN,
    },
    body: JSON.stringify(body),
  })
async function notificationId() {
  const row = await env.DB.prepare(
    'SELECT id FROM notification_outbox LIMIT 1',
  ).first<{ id: string }>()
  if (!row) throw new Error('No notification')
  return row.id
}
async function status(id: string) {
  return (
    await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
      .bind(id)
      .first<{ status: string }>()
  )?.status
}
async function webhook(value: unknown) {
  const response = await request(
    `/integrations/360dialog/webhook/${env.D360DIALOG_WEBHOOK_TOKEN}`,
    {
      method: 'POST',
      body: JSON.stringify({ entry: [{ changes: [{ value }] }] }),
    },
  )
  expect(response.status).toBe(200)
  const events = await env.DB.prepare(
    'SELECT id FROM webhook_event WHERE processed_at IS NULL ORDER BY received_at',
  ).all<{ id: string }>()
  for (const event of events.results) await processWebhook(env, event.id)
}
const statusValue = (state: string) => ({
  statuses: [
    {
      id: 'wamid.test',
      status: state,
      timestamp: String(Math.floor(Date.now() / 1000)),
    },
  ],
})
const endpoint = 'https://waba-sandbox.360dialog.io/v1/messages'
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
function stagedQueueBindings(overrides: Partial<CloudflareBindings> = {}) {
  const bindings = { ...env, APP_ENV: 'staging', ...overrides }
  const namespace = {
    jurisdiction: (jurisdiction: string) => {
      expect(jurisdiction).toBe('eu')
      return namespace
    },
    getByName: () => ({
      join: (
        queueId: string,
        key: string,
        input: Parameters<typeof joinQueue>[3],
        experiment = false,
        source: Parameters<typeof joinQueue>[6] = 'legacy',
      ) =>
        joinQueue(
          bindings as CloudflareBindings,
          queueId,
          key,
          input,
          experiment,
          undefined,
          source,
        ),
    }),
  }
  return {
    ...bindings,
    QUEUE_COORDINATOR: namespace as unknown as typeof env.QUEUE_COORDINATOR,
  } as CloudflareBindings
}

describe('queue vertical in workerd', () => {
  it('requires pilot access and rejects forbidden telephone data', async () => {
    expect(
      (
        await request('/public/queues/demo-queue/entries', {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await join(crypto.randomUUID(), {
          ...input(),
          whatsapp: {
            consent: false,
            phone: '+34600000000',
            version: 'whatsapp-queue-updates-v1',
          },
        })
      ).status,
    ).toBe(400)
  })
  it('replays a committed public-queue join before rechecking staging creation approval', async () => {
    const staging = stagedQueueBindings({
      WHATSAPP_MODE: 'cloud',
      STAGING_CONSENT_APPROVED: 'true',
      WHATSAPP_V2_TEMPLATES_APPROVED: 'true',
      WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_ES: 'approved-joined-es',
      WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_EN: 'approved-joined-en',
      WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
    })
    const payload = {
      partySize: 2,
      locale: 'es' as const,
      whatsapp: {
        consent: true as const,
        phone: '+34600000000',
        version: publicServiceConsentVersion,
      },
    }
    const key = crypto.randomUUID()
    const join = (bindings: CloudflareBindings, body: unknown, idempotencyKey: string) =>
      app.request(
        `${bindings.PUBLIC_APP_ORIGIN}/api/v1/public/queues/demo-queue/entries`,
        {
          method: 'POST',
          headers: {
            Origin: bindings.PUBLIC_APP_ORIGIN,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'X-NoQueue-Pilot-Token': bindings.PILOT_ACCESS_TOKEN,
          },
          body: JSON.stringify(body),
        },
        bindings,
      )

    expect((await join(staging, payload, key)).status).toBe(201)
    const approvalRevoked = stagedQueueBindings({
      WHATSAPP_MODE: 'cloud',
      STAGING_CONSENT_APPROVED: 'false',
      WHATSAPP_V2_TEMPLATES_APPROVED: 'true',
      WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_ES: 'approved-joined-es',
      WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_EN: 'approved-joined-en',
      WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
    })
    expect((await join(approvalRevoked, payload, key)).status).toBe(200)
    expect(
      (await join(approvalRevoked, { ...payload, partySize: 3 }, key)).status,
    ).toBe(409)
    expect(
      (await join(approvalRevoked, payload, crypto.randomUUID())).status,
    ).toBe(503)
  })
  it('joins without WhatsApp and exposes no private data', async () => {
    const response = await join(crypto.randomUUID(), input(false))
    expect(response.status).toBe(201)
    const entry = joinedEntrySchema.parse(await response.json())
    expect(entry.notification).toBe('disabled')
    expect(entry.position).toBe(1)
    const recovered = await request(`/public/entries/${entry.recoveryToken}`)
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toEqual({
      initialEtaMinutes: null,
      code: entry.code,
      position: 1,
      etaMinutes: 0,
      predictedAt: null,
      estimateQuality: 'unknown',
      status: 'waiting',
      notification: 'disabled',
    })
    expect(recovered.headers.get('Cache-Control')).toBe('no-store')
  })
  it('serializes concurrent joins and replays the same recovery token without storing it', async () => {
    const key = crypto.randomUUID()
    const responses = await Promise.all([join(key), join(key)])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201])
    const entries = await Promise.all(
      responses.map(async (r) => joinedEntrySchema.parse(await r.json())),
    )
    expect(entries[0]).toEqual(entries[1])
    const stored = await env.DB.prepare(
      'SELECT recovery_hash FROM queue_entry',
    ).first<{ recovery_hash: string }>()
    expect(stored?.recovery_hash).toBe(await hash(entries[0]!.recoveryToken))
    expect((await join(key, { ...input(), partySize: 3 })).status).toBe(409)
    const contact = await env.DB.prepare(
      'SELECT phone_cipher,phone_hash FROM queue_entry_contact',
    ).first<{ phone_cipher: string; phone_hash: string }>()
    expect(contact?.phone_cipher).not.toContain('34600000000')
    expect(
      await decryptPhone(env.PII_ENCRYPTION_KEY, contact!.phone_cipher),
    ).toBe('+34600000000')
  })
  it('enforces queue capacity under concurrent joins', async () => {
    const responses = await Promise.all(
      Array.from({ length: 21 }, () => join(crypto.randomUUID(), input(false))),
    )
    expect(responses.filter((r) => r.status === 201)).toHaveLength(20)
    expect(responses.filter((r) => r.status === 409)).toHaveLength(1)
  })
  it('logs only normalized rejection diagnostics and never persists provider payloads', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await join()
    const entry = joinedEntrySchema.parse(await response.json())
    const id = await notificationId()
    const sensitive = `+34600000000 ${env.D360DIALOG_API_KEY} ${entry.recoveryToken}`
    let calls = 0
    network.use(
      http.post(endpoint, () => {
        calls++
        return HttpResponse.json(
          {
            error: {
              code: 131047,
              message: sensitive,
              error_data: { details: sensitive },
            },
          },
          { status: 400 },
        )
      }),
    )
    try {
      await dispatchNotification(env, id)
      await dispatchNotification(env, id)
      expect(calls).toBe(1)
      expect(await status(id)).toBe('failed')
      expect(warning.mock.calls).toEqual([
        [
          {
            event: 'whatsapp_send_failed',
            reason: 'http_rejection',
            httpStatus: 400,
            providerCode: 131047,
          },
        ],
      ])
      const stored = await env.DB.prepare(
        'SELECT * FROM notification_outbox',
      ).all()
      for (const secret of [
        '+34600000000',
        env.D360DIALOG_API_KEY,
        entry.recoveryToken,
      ]) {
        expect(JSON.stringify(warning.mock.calls)).not.toContain(secret)
        expect(JSON.stringify(stored.results)).not.toContain(secret)
      }
    } finally {
      warning.mockRestore()
    }
  })
  it('dispatches once, correlates early statuses and never regresses read', async () => {
    await join()
    const id = await notificationId()
    let calls = 0
    await webhook(statusValue('delivered'))
    network.use(
      http.post(endpoint, async ({ request }) => {
        calls++
        expect(request.headers.get('D360-API-KEY')).toBe('test-only-key')
        const body = await request.json()
        expect(body).toMatchObject({ to: '34600000000', type: 'text' })
        return HttpResponse.json(
          { messages: [{ id: 'wamid.test' }] },
          { status: 201 },
        )
      }),
    )
    await dispatchNotification(env, id)
    await dispatchNotification(env, id)
    expect(calls).toBe(1)
    expect(await status(id)).toBe('delivered')
    await webhook(statusValue('read'))
    await webhook(statusValue('sent'))
    await webhook(statusValue('read'))
    expect(await status(id)).toBe('read')
    expect(
      (
        await env.DB.prepare('SELECT COUNT(*) AS n FROM webhook_event').first<{
          n: number
        }>()
      )?.n,
    ).toBe(3)
  })
  it('keeps the accepted ETA baseline monotonic when an older notice status arrives late', async () => {
    const firstAcceptedAt = 1_800_000_000_000
    let now = firstAcceptedAt
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      expect((await join()).status).toBe(201)
      const first = await env.DB.prepare(
        'SELECT id,entry_id FROM notification_outbox LIMIT 1',
      ).first<{ id: string; entry_id: string }>()
      if (!first) throw new Error('Missing initial queue notice')
      const projection = await env.DB.prepare(
        'SELECT revision FROM queue_projection WHERE entry_id=?',
      )
        .bind(first.entry_id)
        .first<{ revision: number }>()
      const firstPrediction = firstAcceptedAt + 120 * 60_000
      await env.DB.prepare(
        'UPDATE queue_projection SET predicted_at=?,eta_minutes=120,quality=? WHERE entry_id=?',
      )
        .bind(firstPrediction, 'estimated', first.entry_id)
        .run()
      await env.DB.prepare(
        'UPDATE notification_outbox SET payload_version=2,payload_snapshot=?,revision=?,call_cycle=0 WHERE id=?',
      )
        .bind(
          JSON.stringify({
            schemaVersion: 2,
            serviceName: 'Demo',
            ahead: 1,
            etaMinutes: 120,
            predictedAt: firstPrediction,
            estimateQuality: 'estimated',
            resourceName: null,
            arrivalDeadlineAt: null,
          }),
          projection?.revision ?? 1,
          first.id,
        )
        .run()

      let sends = 0
      network.use(
        http.post(endpoint, () => {
          sends++
          return HttpResponse.json(
            { messages: [{ id: `wamid.eta-${sends}` }] },
            { status: 201 },
          )
        }),
      )
      await dispatchNotification(env, first.id)
      now += 1_000
      const correctionPrediction = firstPrediction + 10 * 60_000
      await env.DB.prepare(
        'UPDATE queue_projection SET predicted_at=?,eta_minutes=130,quality=? WHERE entry_id=?',
      )
        .bind(correctionPrediction, 'estimated', first.entry_id)
        .run()
      await env.DB.prepare(
        `INSERT INTO notification_outbox(id,entry_id,idempotency_key,kind,updated_at,payload_version,payload_snapshot,revision,call_cycle)
         VALUES (?,?,?,'delayed',?,2,?,?,0)`,
      )
        .bind(
          crypto.randomUUID(),
          first.entry_id,
          `${first.entry_id}:delayed:test-revision`,
          now,
          JSON.stringify({
            schemaVersion: 2,
            serviceName: 'Demo',
            ahead: 1,
            etaMinutes: 130,
            predictedAt: correctionPrediction,
            estimateQuality: 'estimated',
            resourceName: null,
            arrivalDeadlineAt: null,
          }),
          projection?.revision ?? 1,
        )
        .run()
      const correction = await env.DB.prepare(
        "SELECT id FROM notification_outbox WHERE entry_id=? AND kind='delayed'",
      )
        .bind(first.entry_id)
        .first<{ id: string }>()
      if (!correction) throw new Error('Missing delayed notice')
      await dispatchNotification(env, correction.id)
      expect(
        await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
          .bind(correction.id)
          .first(),
      ).toEqual({ status: 'accepted' })
      expect(
        await env.DB.prepare(
          'SELECT last_accepted_predicted_at FROM queue_notification_state WHERE entry_id=?',
        )
          .bind(first.entry_id)
          .first(),
      ).toEqual({ last_accepted_predicted_at: correctionPrediction })

      const oldRead = () =>
        webhook({
          statuses: [
            {
              id: 'wamid.eta-1',
              status: 'read',
              timestamp: String(Math.floor(firstAcceptedAt / 1000)),
            },
          ],
        })
      await oldRead()
      await oldRead()
      expect(
        await env.DB.prepare(
          'SELECT last_accepted_predicted_at FROM queue_notification_state WHERE entry_id=?',
        )
          .bind(first.entry_id)
          .first(),
      ).toEqual({ last_accepted_predicted_at: correctionPrediction })
      expect(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM webhook_event WHERE provider_id='wamid.eta-1' AND status='read'",
          ).first<{ n: number }>()
        )?.n,
      ).toBe(1)
    } finally {
      nowSpy.mockRestore()
    }
  })
  it('records opt-out durably and cancels pending messages', async () => {
    await join()
    const id = await notificationId()
    await webhook({
      messages: [
        {
          id: 'inbound.stop',
          from: '34600000000',
          timestamp: String(Math.floor(Date.now() / 1000)),
          text: { body: '  baja  ' },
        },
      ],
    })
    expect(await status(id)).toBe('cancelled')
    expect(
      (
        await env.DB.prepare('SELECT revoked_at FROM consent').first<{
          revoked_at: number
        }>()
      )?.revoked_at,
    ).toBeGreaterThan(0)
  })
  it('blocks a durably received same-second STOP before its async processing', async () => {
    await join()
    const id = await notificationId()
    let calls = 0
    const granted = (await env.DB.prepare(
      'SELECT granted_at FROM consent',
    ).first<{ granted_at: number }>())!.granted_at
    await env.DB.prepare(
      "INSERT INTO webhook_event(id,dedupe_key,kind,provider_id,phone_hash,occurred_at,received_at) SELECT ?,?,'opt_out','stop.pending',phone_hash,?,? FROM queue_entry_contact WHERE entry_id=?",
    )
      .bind(
        crypto.randomUUID(),
        'pending-stop',
        Math.floor(granted / 1000) * 1000,
        granted + 10,
        id,
      )
      .run()
    network.use(
      http.post(endpoint, () => {
        calls++
        return HttpResponse.json({ messages: [{ id: 'never' }] })
      }),
    )
    await dispatchNotification(env, id)
    expect(calls).toBe(0)
    expect(await status(id)).toBe('pending')
  })
  it('allows a failed status after sent but never after delivered', async () => {
    await join()
    const id = await notificationId()
    network.use(
      http.post(endpoint, () =>
        HttpResponse.json({ messages: [{ id: 'wamid.test' }] }),
      ),
    )
    await dispatchNotification(env, id)
    await webhook(statusValue('sent'))
    await webhook(statusValue('failed'))
    expect(await status(id)).toBe('failed')
    await webhook(statusValue('delivered'))
    await webhook(statusValue('failed'))
    expect(await status(id)).toBe('delivered')
  })
  it('does not retry ambiguous sends and recovers abandoned sending as unknown', async () => {
    await join()
    const id = await notificationId()
    let calls = 0
    network.use(
      http.post(endpoint, () => {
        calls++
        return new HttpResponse(null, { status: 503 })
      }),
    )
    await dispatchNotification(env, id)
    await dispatchNotification(env, id)
    expect(calls).toBe(1)
    expect(await status(id)).toBe('unknown')
    await env.DB.prepare(
      "UPDATE notification_outbox SET status='sending',updated_at=0 WHERE id=?",
    )
      .bind(id)
      .run()
    await reconcile(env)
    expect(await status(id)).toBe('unknown')
  })
  it('limits explicit rate-limit retries to three then dead-letters', async () => {
    await join()
    const id = await notificationId()
    let calls = 0
    network.use(
      http.post(endpoint, () => {
        calls++
        return new HttpResponse(null, { status: 429 })
      }),
    )
    for (let i = 0; i < 4; i++) {
      await env.DB.prepare(
        'UPDATE notification_outbox SET next_attempt_at=0 WHERE id=?',
      )
        .bind(id)
        .run()
      await dispatchNotification(env, id)
    }
    expect(calls).toBe(3)
    expect(await status(id)).toBe('failed')
    expect(
      (
        await env.DB.prepare(
          'SELECT dead_lettered FROM notification_outbox WHERE id=?',
        )
          .bind(id)
          .first<{ dead_lettered: number }>()
      )?.dead_lettered,
    ).toBe(1)
  })
  it('binds cloud callbacks to the configured business number', async () => {
    const cloudEnv = {
      ...env,
      WHATSAPP_MODE: 'cloud',
      D360DIALOG_PHONE_NUMBER_ID: '12345',
    }
    const send = (numberId: string) =>
      app.request(
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
                      ...statusValue('sent'),
                      metadata: { phone_number_id: numberId },
                    },
                  },
                ],
              },
            ],
          }),
        },
        cloudEnv,
      )
    expect((await send('wrong')).status).toBe(403)
    expect((await send('12345')).status).toBe(200)
  })
  it('authenticates and bounds webhooks; safely acknowledges unknown shapes', async () => {
    expect(
      (
        await request('/integrations/360dialog/webhook', {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await request(
          `/integrations/360dialog/webhook/${env.D360DIALOG_WEBHOOK_TOKEN}`,
          { method: 'POST', body: 'x'.repeat(262145) },
        )
      ).status,
    ).toBe(413)
    await webhook({ unknown: true })
  })
})
describe('provider boundary', () => {
  const message = {
    phone: '+34600000000',
    locale: 'es' as const,
    venue: 'Demo',
    code: 'ABCDEF',
    token: 'ab'.repeat(32),
  }
  it.each([400, 401, 403])('treats HTTP %i as terminal', async (code) => {
    network.use(
      http.post(endpoint, () => new HttpResponse(null, { status: code })),
    )
    expect(await createWhatsAppSender(env).send(message)).toEqual({
      kind: 'failed',
      diagnostic: {
        reason: 'http_rejection',
        httpStatus: code,
        providerCode: null,
      },
    })
  })
  it.each([400, 401, 403])(
    'retains HTTP %i and only a numeric provider error code',
    async (httpStatus) => {
      network.use(
        http.post(endpoint, () =>
          HttpResponse.json(
            {
              error: {
                code: 131047,
                message: 'private-message',
                details: '+34600000000',
              },
            },
            { status: httpStatus },
          ),
        ),
      )
      expect(await createWhatsAppSender(env).send(message)).toEqual({
        kind: 'failed',
        diagnostic: {
          reason: 'http_rejection',
          httpStatus,
          providerCode: 131047,
        },
      })
    },
  )
  it.each([
    undefined,
    'private-message',
    '+34600000000',
    34600000000,
    -1,
    1.5,
    {},
  ])('drops unsupported provider code %j', async (code) => {
    network.use(
      http.post(endpoint, () =>
        HttpResponse.json(
          { error: { code, message: 'private-message' } },
          { status: 403 },
        ),
      ),
    )
    expect(await createWhatsAppSender(env).send(message)).toEqual({
      kind: 'failed',
      diagnostic: {
        reason: 'http_rejection',
        httpStatus: 403,
        providerCode: null,
      },
    })
  })
  it('retains rejection status without logging oversized or malformed bodies', async () => {
    const bodies = [
      'private-message',
      JSON.stringify({ error: { code: 131047, message: 'x'.repeat(65536) } }),
    ]
    for (const body of bodies) {
      network.use(
        http.post(endpoint, () => new HttpResponse(body, { status: 401 })),
      )
      expect(await createWhatsAppSender(env).send(message)).toEqual({
        kind: 'failed',
        diagnostic: {
          reason: 'http_rejection',
          httpStatus: 401,
          providerCode: null,
        },
      })
    }
  })
  it('retries only an explicitly documented HTTP400 throttle', async () => {
    network.use(
      http.post(endpoint, () =>
        HttpResponse.json(
          { error: { message: 'You have exceeded the endpoint rate limit.' } },
          { status: 400 },
        ),
      ),
    )
    expect(await createWhatsAppSender(env).send(message)).toEqual({
      kind: 'rate_limited',
    })
    network.use(
      http.post(endpoint, () =>
        HttpResponse.json(
          {
            error: {
              message: 'Could not send message due to lack of payment.',
            },
          },
          { status: 400 },
        ),
      ),
    )
    expect(await createWhatsAppSender(env).send(message)).toEqual({
      kind: 'failed',
      diagnostic: {
        reason: 'http_rejection',
        httpStatus: 400,
        providerCode: null,
      },
    })
  })
  it('treats malformed success as ambiguous', async () => {
    network.use(http.post(endpoint, () => HttpResponse.json({ ok: true })))
    expect(await createWhatsAppSender(env).send(message)).toEqual({
      kind: 'unknown',
    })
  })
  it('sends the approved cloud template with locale/body/button parameters', async () => {
    let calls = 0
    network.use(
      http.post(
        'https://waba-v2.360dialog.io/messages',
        async ({ request }) => {
          calls++
          expect(await request.json()).toEqual({
            messaging_product: 'whatsapp',
            to: '34600000000',
            type: 'template',
            template: {
              name: 'noqueue_queue_joined',
              language: { code: 'es_ES' },
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: 'Demo' },
                    { type: 'text', text: 'ABCDEF' },
                  ],
                },
                {
                  type: 'button',
                  sub_type: 'url',
                  index: '0',
                  parameters: [{ type: 'text', text: 'ab'.repeat(32) }],
                },
              ],
            },
          })
          return HttpResponse.json({ messages: [{ id: 'wamid.cloud' }] })
        },
      ),
    )
    expect(
      await createWhatsAppSender({
        ...env,
        WHATSAPP_MODE: 'cloud',
        STAGING_CONSENT_APPROVED: 'true',
      }).send(message),
    ).toEqual({ kind: 'accepted', providerId: 'wamid.cloud' })
    expect(calls).toBe(1)
  })
  it('blocks cloud sends until client approval and never follows redirects', async () => {
    expect(
      await createWhatsAppSender({ ...env, WHATSAPP_MODE: 'cloud' }).send(
        message,
      ),
    ).toEqual({
      kind: 'failed',
      diagnostic: {
        reason: 'configuration',
        httpStatus: null,
        providerCode: null,
      },
    })
    network.use(
      http.post(
        endpoint,
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: 'https://untrusted.example/' },
          }),
      ),
    )
    expect(await createWhatsAppSender(env).send(message)).toEqual({
      kind: 'failed',
      diagnostic: {
        reason: 'http_rejection',
        httpStatus: 302,
        providerCode: null,
      },
    })
  })
  it('marks network failures and aborts as unknown', async () => {
    network.use(http.post(endpoint, () => HttpResponse.error()))
    expect(await createWhatsAppSender(env).send(message)).toEqual({
      kind: 'unknown',
    })
    const abortingFetch: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    expect(
      await createWhatsAppSender(
        { ...env, D360DIALOG_REQUEST_TIMEOUT_MS: '100' },
        abortingFetch,
      ).send(message),
    ).toEqual({ kind: 'unknown' })
  })
  it('rejects invalid key configuration and authenticates secrets', async () => {
    expect(await secureEqual('wrong', env.PILOT_ACCESS_TOKEN)).toBe(false)
    expect(
      await secureEqual(env.PILOT_ACCESS_TOKEN, env.PILOT_ACCESS_TOKEN),
    ).toBe(true)
  })
  it('preserves opt-out when a sibling status is unsupported', () => {
    expect(
      whatsappWebhookParser.parse({
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'new',
                      status: 'new_provider_status',
                      timestamp: '1',
                    },
                  ],
                  messages: [
                    {
                      id: 'stop',
                      from: '34600000000',
                      timestamp: '1',
                      text: { body: 'STOP' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toEqual([
      { kind: 'opt_out', id: 'stop', phone: '+34600000000', timestamp: 1000 },
    ])
  })
  it('records only inbound metadata for unrelated text, never consent', () => {
    expect(
      whatsappWebhookParser.parse({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'x',
                      from: '34600000000',
                      timestamp: '1',
                      text: { body: 'hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toEqual([
      { kind: 'inbound', id: 'x', phone: '+34600000000', timestamp: 1000 },
    ])
  })
})
