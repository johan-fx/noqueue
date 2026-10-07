import './http-only-platform'

// Local-only entrypoint. Never referenced by deployable Wrangler configuration.
import { env } from 'cloudflare:workers'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import worker from '../src/index'
import { app } from '../src/app'
import { createAuth } from '../src/auth/server'
import { z } from 'zod'
import { confirmationPage } from './confirmation-page'
import { confirmationExperimentEnabled } from '../src/features/queue/confirmation'
import { decryptPhone, hash, secureEqual } from '../src/features/queue/crypto'
import { receiveWebhook } from '../src/features/queue/webhook'
export { QueueCoordinator } from '../src/index'
const staffMail = new Map<string, string>()
const network = setupNetwork()
network.use(
  http.get('https://api.geoapify.com/v1/geocode/:operation', ({ request }) => {
    const text = new URL(request.url).searchParams.get('text') ?? ''
    if (text.includes('Vacío')) return HttpResponse.json({ features: [] })
    if (text.includes('Error')) return new HttpResponse(null, { status: 503 })
    // Keep the edit journey outside the discovery fixture's 5km Malaga scope.
    if (text.includes('Valencia'))
      return HttpResponse.json({
        features: [
          {
            properties: {
              formatted: 'Calle Colón 1, Valencia',
              street: 'Calle Colón',
              housenumber: '1',
              city: 'Valencia',
              country_code: 'es',
              lat: 39.4702,
              lon: -0.3768,
              result_type: 'building',
              place_id: 'fixture-valencia',
            },
          },
        ],
      })
    return HttpResponse.json({
      features: [
        {
          properties: {
            formatted: text.includes('Málaga')
              ? 'Paseo Marítimo 56, Málaga'
              : 'Calle Mayor 1, Madrid',
            street: text.includes('Málaga') ? 'Paseo Marítimo' : 'Calle Mayor',
            housenumber: '1',
            city: text.includes('Málaga') ? 'Málaga' : 'Madrid',
            country_code: 'es',
            lat: text.includes('Málaga') ? 36.72016 : 40.416,
            lon: text.includes('Málaga') ? -4.42034 : -3.704,
            result_type: 'building',
            place_id: 'fixture-place',
          },
        },
      ],
    })
  }),
  http.post('https://api.resend.com/emails', async ({ request }) => {
    const message = (await request.json()) as { to: string[]; text: string }
    staffMail.set(message.to[0]!, message.text)
    return HttpResponse.json({ id: 'local-test-email' })
  }),
  http.post(
    'https://noqueue-experiment.invalid/messages',
    async ({ request }) => {
      const message = (await request.json()) as { to: string; type: string }
      // External-boundary failure fixture: no synthetic domain state or live send.
      if (message.to === '34600000005' && message.type === 'text')
        return new HttpResponse(null, { status: 503 })
      return HttpResponse.json(
        { messages: [{ id: `wamid.experiment.${crypto.randomUUID()}` }] },
        { status: 201 },
      )
    },
  ),
  http.post('https://waba-sandbox.360dialog.io/v1/messages', async () => {
    const id = `wamid.fake.${crypto.randomUUID()}`
    // Model a provider callback arriving before its send receipt.
    await app.request(
      `https://local.test/api/v1/integrations/360dialog/webhook/${env.D360DIALOG_WEBHOOK_TOKEN}`,
      {
        method: 'POST',
        body: JSON.stringify({
          entry: [
            {
              changes: [
                {
                  value: {
                    statuses: [
                      {
                        id,
                        status: 'delivered',
                        timestamp: String(Math.floor(Date.now() / 1000)),
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
    return HttpResponse.json({ messages: [{ id }] }, { status: 201 })
  }),
  http.all('*', () => HttpResponse.error()),
)
// These controls are absent from src/index.ts and all deployment configs.
app.use('/experiments/local/*', async (context, next) => {
  const url = new URL(context.req.url)
  if (
    !confirmationExperimentEnabled(context.env) ||
    !['localhost', '127.0.0.1'].includes(url.hostname)
  )
    return context.json({ error: 'not_found' }, 404)
  if (
    context.req.header('Origin') &&
    context.req.header('Origin') !== context.env.PUBLIC_APP_ORIGIN
  )
    return context.json({ error: 'origin_not_allowed' }, 403)
  await next()
})
app.get('/experiments/local/confirmation', (context) =>
  context.html(confirmationPage),
)
app.post('/experiments/local/reply', async (context) => {
  if (
    !(await secureEqual(
      context.req.header('X-NoQueue-Pilot-Token') ?? '',
      context.env.PILOT_ACCESS_TOKEN,
    ))
  )
    return context.json({ error: 'pilot_access_required' }, 401)
  const parsed = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      action: z.enum(['button', 'text', 'STOP', 'BAJA']),
    })
    .safeParse(await context.req.json())
  if (!parsed.success) return context.json({ error: 'invalid_reply' }, 400)
  const row = await context.env.DB.prepare(
    `SELECT f.payload,n.provider_id,p.phone_cipher FROM queue_entry e
    JOIN queue_confirmation f ON f.entry_id=e.id JOIN queue_entry_contact p ON p.entry_id=e.id
    JOIN notification_outbox n ON n.entry_id=e.id AND n.kind='confirmation' WHERE e.recovery_hash=?`,
  )
    .bind(await hash(parsed.data.token))
    .first<{
      payload: string
      provider_id: string | null
      phone_cipher: string
    }>()
  if (!row?.provider_id)
    return context.json({ error: 'request_not_accepted_yet' }, 409)
  const phone = await decryptPhone(
    context.env.PII_ENCRYPTION_KEY,
    row.phone_cipher,
  )
  if (
    !context.env.WHATSAPP_RECIPIENT_ALLOWLIST.split(',')
      .map((p) => p.trim())
      .includes(phone)
  )
    return context.json({ error: 'recipient_not_allowed' }, 403)
  const message = {
    id: `inbound.experiment.${crypto.randomUUID()}`,
    from: phone.slice(1),
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(parsed.data.action === 'button'
      ? {
          type: 'button',
          button: { text: 'CONFIRMO', payload: row.payload },
          context: { id: row.provider_id },
        }
      : {
          type: 'text',
          text: {
            body:
              parsed.data.action === 'text' ? 'CONFIRMO' : parsed.data.action,
          },
        }),
  }
  return receiveWebhook(
    new Request('http://localhost/webhook', {
      method: 'POST',
      body: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [message] } }] }],
      }),
    }),
    context.env,
    context.env.D360DIALOG_WEBHOOK_TOKEN,
  )
})
// Isolated local test harness only: never mounted by src/index.ts.
app.use('/experiments/local/staff/*', async (c, next) => {
  if (
    !(await secureEqual(
      c.req.header('X-NoQueue-Pilot-Token') ?? '',
      c.env.PILOT_ACCESS_TOKEN,
    ))
  )
    return c.json({ error: 'unauthorized' }, 401)
  await next()
})
app.post('/experiments/local/staff/identity', async (c) => {
  const body = z
    .object({
      username: z.string().regex(/^[a-z0-9_.]{3,30}$/),
      password: z.string().min(15).max(128),
    })
    .parse(await c.req.json())
  const created = await createAuth(c.env).api.createUser({
    body: {
      email: `${body.username}@accounts.noqueue.invalid`,
      password: body.password,
      data: { username: body.username },
      name: 'Test Commercial',
      role: 'commercial_operator',
    },
  })
  await c.env.DB.prepare('DELETE FROM rateLimit').run()
  return c.json({ id: created.user.id })
})
app.get('/experiments/local/staff/mail', (c) =>
  c.json({ text: staffMail.get(c.req.query('email') ?? '') ?? '' }),
)
let networkEnabled = false
function enableNetwork() {
  if (!networkEnabled) {
    network.enable()
    networkEnabled = true
  }
}
export default {
  async fetch(
    request: Request,
    bindings: CloudflareBindings,
    ctx: ExecutionContext,
  ) {
    enableNetwork()
    return worker.fetch(request, bindings, ctx)
  },
  async queue(batch: MessageBatch, bindings: CloudflareBindings) {
    enableNetwork()
    await worker.queue(batch, bindings)
  },
  scheduled: worker.scheduled,
}

// Explicit test-only legacy admissions fixture; never confirms unknown occupancy.
app.post('/experiments/local/staff/legacy-open', async (c) => {
  const { venueId } = z.object({ venueId: z.uuid() }).parse(await c.req.json())
  await c.env.DB.prepare('UPDATE queue SET open=1 WHERE venue_id=?')
    .bind(venueId)
    .run()
  return c.json({ ok: true })
})

// Synthetic historical inputs only; bounded, loopback + pilot guarded above.
// No caller-supplied SQL, current time, projections or calculated means.
app.post('/experiments/local/staff/queue-history', async (c) => {
  const parsed = z
    .object({
      queueId: z.uuid(),
      spaceId: z.string().min(1).max(100),
      seats: z.number().int().min(1).max(100),
      durations: z.array(z.number().int().min(1).max(1440)).min(1).max(31),
    })
    .strict()
    .safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_fixture' }, 400)
  const { queueId, spaceId, seats, durations } = parsed.data
  const { loadQueueState, recalculateQueue } = await import(
    '../src/features/queue/projection'
  )
  const row = await c.env.DB.prepare('SELECT id FROM queue WHERE id=?')
    .bind(queueId)
    .first()
  if (!row) return c.json({ error: 'not_found' }, 404)
  const state = await loadQueueState(c.env, queueId)
  const resource = state.resources.find(
    (r) => r.spaceId === spaceId && r.seats === seats,
  )
  if (!resource) return c.json({ error: 'invalid_group' }, 400)
  let time =
    Date.now() -
    durations.reduce((total, value) => total + (value + 1) * 60000, 0)
  const statements: D1PreparedStatement[] = []
  for (const duration of durations) {
    const id = crypto.randomUUID(),
      arrived = time,
      released = time + duration * 60000
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,?,'en',?,(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?),'served')",
      ).bind(id, queueId, id, id, id, id, Math.min(seats, 4), arrived, queueId),
    )
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at,released_at,outcome) VALUES (?,?,?,?,?,?,?,?,'served')",
      ).bind(
        id,
        queueId,
        resource.id,
        spaceId,
        seats,
        arrived,
        arrived,
        released,
      ),
    )
    time = released + 60000
  }
  await c.env.DB.batch(statements)
  await recalculateQueue(c.env, queueId)
  return c.json({ ok: true, inserted: durations.length })
})

// Deterministic current prediction fixture; never available in deployable entrypoints.
app.post('/experiments/local/staff/discovery-projections', async (c) => {
  const { venueId } = z.object({ venueId: z.uuid() }).parse(await c.req.json())
  const queues = await c.env.DB.prepare(
    'SELECT id,config FROM queue WHERE venue_id=?',
  )
    .bind(venueId)
    .all<{ id: string; config: string }>()
  const now = Date.now(),
    statements: D1PreparedStatement[] = []
  for (const queue of queues.results) {
    const type = (JSON.parse(queue.config) as { type: string }).type
    const wait = type === 'reception' ? 10 : type === 'restaurant' ? 15 : 18,
      id = crypto.randomUUID()
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,service_window_id) VALUES (?,?,?,?,?,?,1,'es',?,(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?),'continuous:local-fixture')",
      ).bind(id, queue.id, id, id, id, id, now, queue.id),
    )
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO queue_projection(entry_id,position,eta_minutes,predicted_at,quality,updated_at) VALUES (?,1,?,?, 'estimated',?)",
      ).bind(id, wait, now + wait * 60000, now),
    )
  }
  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})
