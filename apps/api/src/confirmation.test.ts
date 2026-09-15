import { env } from 'cloudflare:workers'
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { app } from './app'
import {
  dispatchNotification,
  processWebhook,
  reconcile,
} from './features/queue/notifications'
import { createWhatsAppSender } from './integrations/360dialog'
import { joinedEntrySchema } from '@noqueue/contracts/queue'

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
const input = {
  phone: '+34600000000',
  partySize: 2,
  locale: 'es',
  priorContactAuthorization: true,
}
const route = '/api/v1/experiments/confirmation/queues/demo-queue/entries'
const headers = () => ({
  'Content-Type': 'application/json',
  'Idempotency-Key': crypto.randomUUID(),
  'X-NoQueue-Pilot-Token': env.PILOT_ACCESS_TOKEN,
})
const join = (
  body: unknown = input,
  requestHeaders: Record<string, string> = headers(),
  bindings = env,
) =>
  app.request(
    `http://localhost${route}`,
    { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) },
    bindings,
  )
async function create() {
  const response = await join()
  expect(response.status).toBe(201)
  const entry = joinedEntrySchema.parse(await response.json())
  const row = await env.DB.prepare(
    'SELECT entry_id,payload FROM queue_confirmation ORDER BY contact_authorized_at DESC,rowid DESC LIMIT 1',
  ).first<{ entry_id: string; payload: string }>()
  if (!row) throw new Error('Missing confirmation')
  return { ...entry, ...row }
}
async function accepted() {
  const entry = await create()
  await dispatchNotification(env, entry.entry_id)
  const receipt = await env.DB.prepare(
    'SELECT provider_id FROM notification_outbox WHERE id=?',
  )
    .bind(entry.entry_id)
    .first<{ provider_id: string }>()
  return { ...entry, providerId: receipt!.provider_id }
}
async function state(entryId: string) {
  return env.DB.prepare(
    `SELECT c.purpose,c.revoked_at,f.confirmed_at,n.status,e.status AS queue_status FROM consent c
    JOIN queue_confirmation f ON f.entry_id=c.entry_id JOIN notification_outbox n ON n.entry_id=c.entry_id
    JOIN queue_entry e ON e.id=c.entry_id WHERE c.entry_id=?`,
  )
    .bind(entryId)
    .first<{
      purpose: string
      revoked_at: number | null
      confirmed_at: number | null
      status: string
      queue_status: string
    }>()
}
const message = (body = 'CONFIRMO') => ({
  id: crypto.randomUUID(),
  from: '34600000000',
  timestamp: String(Math.floor(Date.now() / 1000)),
  type: 'text',
  text: { body },
})
const button = (entry: { payload: string; providerId: string }) => ({
  id: crypto.randomUUID(),
  from: '34600000000',
  timestamp: String(Math.floor(Date.now() / 1000)),
  type: 'button',
  button: { text: 'CONFIRMO', payload: entry.payload },
  context: { id: entry.providerId },
})
async function receive(messages: unknown[], process = true) {
  const response = await app.request(
    `http://localhost/api/v1/integrations/360dialog/webhook/${env.D360DIALOG_WEBHOOK_TOKEN}`,
    {
      method: 'POST',
      body: JSON.stringify({ entry: [{ changes: [{ value: { messages } }] }] }),
    },
    env,
  )
  expect(response.status).toBe(200)
  if (process) {
    const events = await env.DB.prepare(
      'SELECT id FROM webhook_event WHERE processed_at IS NULL ORDER BY received_at,rowid',
    ).all<{ id: string }>()
    for (const event of events.results) await processWebhook(env, event.id)
  }
}

describe('staff-assisted confirmation experiment in workerd', () => {
  it('fails closed by default, remotely, without access, without prior authorization and outside allowlist', async () => {
    expect(
      (
        await join(input, headers(), {
          ...env,
          CONFIRMATION_EXPERIMENT_ENABLED: 'false',
        })
      ).status,
    ).toBe(404)
    expect(
      (await join(input, headers(), { ...env, APP_ENV: 'staging' })).status,
    ).toBe(404)
    expect(
      (await join(input, { ...headers(), 'X-NoQueue-Pilot-Token': '' })).status,
    ).toBe(401)
    expect(
      (await join({ ...input, priorContactAuthorization: false })).status,
    ).toBe(400)
    expect((await join({ ...input, phone: '+34600000001' })).status).toBe(403)
    expect(
      (await join(input, { ...headers(), Origin: 'https://evil.invalid' }))
        .status,
    ).toBe(403)
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM queue_entry').first<{
        n: number
      }>())!.n,
    ).toBe(0)
  })
  it('creates one real turn under concurrent retry with contact authorization but no updates permission', async () => {
    const h = headers()
    const responses = await Promise.all([join(input, h), join(input, h)])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201])
    const entries = await Promise.all(
      responses.map(async (r) => joinedEntrySchema.parse(await r.json())),
    )
    expect(entries[0]).toEqual(entries[1])
    expect(entries[0]!.confirmation).toBe('pending')
    const consent = await env.DB.prepare('SELECT purpose FROM consent').first<{
      purpose: string
    }>()
    expect(consent?.purpose).toBe('confirmation_contact')
    expect((await join({ ...input, partySize: 3 }, h)).status).toBe(409)
  })
  it('sends exactly one mock template-shaped request without a recovery URL, then confirms the matching button idempotently', async () => {
    const entry = await create()
    let calls = 0
    network.use(
      http.post(
        'https://noqueue-experiment.invalid/messages',
        async ({ request }) => {
          calls++
          expect(await request.json()).toEqual({
            messaging_product: 'whatsapp',
            to: '34600000000',
            type: 'template',
            template: {
              name: 'noqueue_confirmation_experiment_mock',
              language: { code: 'es' },
              components: [
                {
                  type: 'body',
                  parameters: [{ type: 'text', text: entry.code }],
                },
                {
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: '0',
                  parameters: [{ type: 'payload', payload: entry.payload }],
                },
              ],
            },
          })
          return HttpResponse.json({ messages: [{ id: 'wamid.confirm' }] })
        },
      ),
    )
    await dispatchNotification(env, entry.entry_id)
    await dispatchNotification(env, entry.entry_id)
    expect(calls).toBe(1)
    expect((await state(entry.entry_id))?.purpose).toBe('confirmation_contact')
    const click = button({ ...entry, providerId: 'wamid.confirm' })
    await receive([click])
    const confirmed = await state(entry.entry_id)
    expect(confirmed?.purpose).toBe('queue_updates')
    expect(confirmed?.confirmed_at).toBeGreaterThan(0)
    await receive([click, button({ ...entry, providerId: 'wamid.confirm' })])
    expect(await state(entry.entry_id)).toEqual(confirmed)
    const recovered = await app.request(
      `http://localhost/api/v1/public/entries/${entry.recoveryToken}`,
      {},
      env,
    )
    expect(await recovered.json()).toMatchObject({
      confirmation: 'confirmed',
      status: 'waiting',
    })
  })
  it('does not accept wrong sender, payload, context, missing context, or stale timestamp', async () => {
    const entry = await accepted()
    const click = button(entry)
    for (const invalid of [
      { ...click, from: '34600000001' },
      { ...click, button: { text: 'CONFIRMO', payload: crypto.randomUUID() } },
      { ...click, context: { id: 'wrong' } },
      { ...click, context: undefined },
      { ...click, timestamp: '1' },
    ])
      await receive([{ ...invalid, id: crypto.randomUUID() }])
    expect((await state(entry.entry_id))?.purpose).toBe('confirmation_contact')
  })
  it('accepts typed CONFIRMO only with one pending entry, not even when the other is unsent', async () => {
    const first = await accepted()
    const second = await create()
    await receive([message('  confirmo  ')])
    expect((await state(first.entry_id))?.purpose).toBe('confirmation_contact')
    expect((await state(second.entry_id))?.purpose).toBe('confirmation_contact')
    await receive([button(first)])
    expect((await state(first.entry_id))?.purpose).toBe('queue_updates')
    await dispatchNotification(env, second.entry_id)
    await receive([message(' confirmo ')])
    expect((await state(second.entry_id))?.purpose).toBe('queue_updates')
  })
  it('never retargets an originally ambiguous typed reply after another turn is confirmed', async () => {
    const first = await accepted()
    const second = await accepted()
    const typed = message()
    await receive([typed], false)
    const click = button(first)
    await receive([click], false)
    const clickEvent = await env.DB.prepare(
      'SELECT id FROM webhook_event WHERE provider_id=?',
    )
      .bind(click.id)
      .first<{ id: string }>()
    await processWebhook(env, clickEvent!.id)
    const typedEvent = await env.DB.prepare(
      'SELECT id FROM webhook_event WHERE provider_id=?',
    )
      .bind(typed.id)
      .first<{ id: string }>()
    await processWebhook(env, typedEvent!.id)
    expect((await state(first.entry_id))?.purpose).toBe('queue_updates')
    expect((await state(second.entry_id))?.purpose).toBe('confirmation_contact')
  })
  it('reprocesses an early button callback only after the outbound receipt can correlate it', async () => {
    const entry = await create()
    network.use(
      http.post('https://noqueue-experiment.invalid/messages', async () => {
        await receive([button({ ...entry, providerId: 'wamid.early' })])
        expect((await state(entry.entry_id))?.purpose).toBe(
          'confirmation_contact',
        )
        return HttpResponse.json({ messages: [{ id: 'wamid.early' }] })
      }),
    )
    await dispatchNotification(env, entry.entry_id)
    expect((await state(entry.entry_id))?.purpose).toBe('queue_updates')
  })
  it.each(['STOP', 'BAJA'])(
    'revokes pending and confirmed entries with %s; replay and a new late button never reactivate',
    async (word) => {
      const first = await accepted()
      await receive([button(first)])
      const second = await create()
      await receive([message(word)])
      expect((await state(first.entry_id))?.revoked_at).toBeGreaterThan(0)
      expect((await state(second.entry_id))?.status).toBe('cancelled')
      await receive([button(first), message()])
      expect((await state(first.entry_id))?.revoked_at).toBeGreaterThan(0)
      expect((await state(second.entry_id))?.purpose).toBe(
        'confirmation_contact',
      )
      expect((await state(second.entry_id))?.queue_status).toBe('waiting')
    },
  )
  it('a received but unprocessed STOP blocks confirmation and the first send', async () => {
    const first = await accepted()
    const second = await create()
    await receive([message('STOP')], false)
    await receive([button(first)], false)
    const confirmation = await env.DB.prepare(
      "SELECT id FROM webhook_event WHERE kind='confirmation'",
    ).first<{ id: string }>()
    await processWebhook(env, confirmation!.id)
    await dispatchNotification(env, second.entry_id)
    expect((await state(first.entry_id))?.purpose).toBe('confirmation_contact')
    expect((await state(second.entry_id))?.status).toBe('pending')
  })
  it('STOP arriving during a send cannot be overwritten by a late send receipt', async () => {
    const entry = await create()
    network.use(
      http.post('https://noqueue-experiment.invalid/messages', async () => {
        await receive([message('STOP')])
        return HttpResponse.json({ messages: [{ id: 'wamid.late' }] })
      }),
    )
    await dispatchNotification(env, entry.entry_id)
    expect((await state(entry.entry_id))?.status).toBe('cancelled')
  })
  it('expired or provider-rejected requests do not grant permission or remove the turn', async () => {
    const expired = await accepted()
    await env.DB.prepare(
      'UPDATE queue_confirmation SET expires_at=1 WHERE entry_id=?',
    )
      .bind(expired.entry_id)
      .run()
    await receive([button(expired)])
    expect((await state(expired.entry_id))?.purpose).toBe(
      'confirmation_contact',
    )
    const rejected = await create()
    network.use(
      http.post(
        'https://noqueue-experiment.invalid/messages',
        () => new HttpResponse(null, { status: 400 }),
      ),
    )
    await dispatchNotification(env, rejected.entry_id)
    await receive([message()])
    expect(await state(rejected.entry_id)).toMatchObject({
      purpose: 'confirmation_contact',
      status: 'failed',
      queue_status: 'waiting',
    })
    const recovered = await app.request(
      `http://localhost/api/v1/public/entries/${expired.recoveryToken}`,
      {},
      env,
    )
    expect(await recovered.json()).toMatchObject({
      confirmation: 'expired',
      status: 'waiting',
    })
  })
  it('ambiguous provider failures are not retried and sweep cancels unsent expired requests', async () => {
    const entry = await create()
    network.use(
      http.post('https://noqueue-experiment.invalid/messages', () =>
        HttpResponse.error(),
      ),
    )
    await dispatchNotification(env, entry.entry_id)
    await dispatchNotification(env, entry.entry_id)
    expect((await state(entry.entry_id))?.status).toBe('unknown')
    const expired = await create()
    await env.DB.prepare(
      'UPDATE queue_confirmation SET expires_at=1 WHERE entry_id=?',
    )
      .bind(expired.entry_id)
      .run()
    await reconcile(env)
    await dispatchNotification(env, expired.entry_id)
    expect((await state(expired.entry_id))?.status).toBe('cancelled')
  })
  it('has no real adapter: remote confirmation sends fail before any fetch', async () => {
    let calls = 0
    const sender = createWhatsAppSender(
      { ...env, APP_ENV: 'staging' },
      async () => {
        calls++
        return new Response()
      },
    )
    expect(
      await sender.send({
        phone: input.phone,
        locale: 'es',
        venue: 'Demo',
        code: 'ABCDEF',
        token: 'unused',
        confirmationPayload: crypto.randomUUID(),
      }),
    ).toMatchObject({ kind: 'failed', diagnostic: { reason: 'configuration' } })
    expect(calls).toBe(0)
  })
})
