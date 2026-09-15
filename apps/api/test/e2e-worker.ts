import './http-only-platform'

// Local-only entrypoint. Never referenced by deployable Wrangler configuration.
import { env } from 'cloudflare:workers'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import worker from '../src/index'
import { app } from '../src/app'
import { z } from 'zod'
import { confirmationPage } from './confirmation-page'
import { confirmationExperimentEnabled } from '../src/features/queue/confirmation'
import { decryptPhone, hash, secureEqual } from '../src/features/queue/crypto'
import { receiveWebhook } from '../src/features/queue/webhook'
export { QueueCoordinator } from '../src/index'
const network = setupNetwork()
network.use(
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
export default {
  fetch: worker.fetch,
  async queue(batch: MessageBatch, bindings: CloudflareBindings) {
    network.enable()
    try {
      await worker.queue(batch, bindings)
    } finally {
      network.disable()
    }
  },
  scheduled: worker.scheduled,
}
