import { experimentPage } from './features/queue/experiment-page'
import {
  experimentQueueId,
  openExperimentRecipientAllowed,
  experimentSnapshot,
  queueCoordinator,
} from './features/queue/experiment'
import { z } from 'zod'
import { confirmationExperimentEnabled } from './features/queue/confirmation'
import {
  confirmationJoinSchema,
  consentVersion,
  joinQueueSchema,
} from '@noqueue/contracts/queue'
import { secureEqual } from './features/queue/crypto'
import { readEntry } from './features/queue/entries'
import { receiveWebhook } from './features/queue/webhook'
import { healthResponseSchema } from '@noqueue/contracts/health'
import { Hono } from 'hono'

export const app = new Hono<{ Bindings: CloudflareBindings }>().basePath(
  '/api/v1',
)

app.get('/health', (context) => {
  const response = healthResponseSchema.parse({
    status: 'ok',
    service: 'noqueue-api',
  })

  return context.json(response)
})

export type AppType = typeof app

app.use('*', async (context, next) => {
  context.header('Cache-Control', 'no-store')
  context.header('Referrer-Policy', 'no-referrer')
  await next()
})
app.onError((_error, context) => {
  console.error('api_request_failed')
  return context.json({ error: 'temporarily_unavailable' }, 503)
})
app.get('/experiments/confirmation', (context) => {
  if (!confirmationExperimentEnabled(context.env))
    return context.json({ error: 'not_found' }, 404)
  const nonce = crypto.randomUUID()
  context.header(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  )
  context.header('X-Content-Type-Options', 'nosniff')
  return context.html(experimentPage(nonce))
})
app.use('/experiments/confirmation/*', async (context, next) => {
  if (!confirmationExperimentEnabled(context.env))
    return context.json({ error: 'not_found' }, 404)
  if (
    !(await secureEqual(
      context.req.header('X-NoQueue-Pilot-Token') ?? '',
      context.env.PILOT_ACCESS_TOKEN,
    ))
  )
    return context.json({ error: 'pilot_access_required' }, 401)
  const origin = context.req.header('Origin')
  if (origin && origin !== new URL(context.req.url).origin)
    return context.json({ error: 'origin_not_allowed' }, 403)
  await next()
})
app.get('/experiments/confirmation/state', async (context) =>
  context.json(await experimentSnapshot(context.env)),
)
app.post('/experiments/confirmation/:action', async (context) => {
  const action = context.req.param('action')
  if (action !== 'seed' && action !== 'advance')
    return context.json({ error: 'not_found' }, 404)
  const key = z.string().uuid().safeParse(context.req.header('Idempotency-Key'))
  if (!key.success)
    return context.json({ error: 'invalid_idempotency_key' }, 400)
  const bucket = String(Math.floor(Date.now() / 60000))
  const rate = await context.env.DB.prepare(
    'INSERT INTO pilot_rate(bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(bucket)
    .first<{ count: number }>()
  if (!rate || rate.count > 30)
    return context.json({ error: 'rate_limited' }, 429)
  await context.env.DB.prepare('DELETE FROM pilot_rate WHERE bucket<?')
    .bind(String(Number(bucket) - 5))
    .run()
  const result = await queueCoordinator(
    context.env,
    experimentQueueId,
  ).experiment(action, key.data)
  return Response.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  })
})
app.on(
  'POST',
  [
    '/public/queues/:queueId/entries',
    '/experiments/confirmation/queues/:queueId/entries',
  ],
  async (context) => {
    const experiment = context.req.path.includes('/experiments/confirmation/')
    const queueId = context.req.param('queueId')
    if (
      (!experiment && queueId === experimentQueueId) ||
      (experiment &&
        context.env.APP_ENV !== 'local' &&
        queueId !== experimentQueueId)
    )
      return context.json({ error: 'not_found' }, 404)
    if (experiment && !confirmationExperimentEnabled(context.env))
      return context.json({ error: 'not_found' }, 404)
    if (
      !(await secureEqual(
        context.req.header('X-NoQueue-Pilot-Token') ?? '',
        context.env.PILOT_ACCESS_TOKEN,
      ))
    )
      return context.json({ error: 'pilot_access_required' }, 401)
    if (
      context.req.header('Origin') &&
      context.req.header('Origin') !==
        (experiment
          ? new URL(context.req.url).origin
          : context.env.PUBLIC_APP_ORIGIN)
    )
      return context.json({ error: 'origin_not_allowed' }, 403)
    const key = z
      .string()
      .uuid()
      .safeParse(context.req.header('Idempotency-Key'))
    if (!key.success)
      return context.json({ error: 'invalid_idempotency_key' }, 400)
    if (Number(context.req.header('Content-Length')) > 4096)
      return context.json({ error: 'body_too_large' }, 413)
    let body: unknown
    try {
      body = JSON.parse(await boundedBody(context.req.raw, 4096))
    } catch {
      return context.json({ error: 'invalid_body' }, 400)
    }
    if (experiment) {
      const authorized = confirmationJoinSchema.safeParse(body)
      if (!authorized.success)
        return context.json(
          { error: 'prior_authorization_required_or_invalid_join' },
          400,
        )
      if (context.env.APP_ENV !== 'local' && authorized.data.locale !== 'es')
        return context.json({ error: 'experiment_spanish_only' }, 400)
      body = {
        partySize: authorized.data.partySize,
        locale: authorized.data.locale,
        whatsapp: {
          consent: true,
          phone: authorized.data.phone,
          version: consentVersion,
        },
      }
    }
    const parsed = joinQueueSchema.safeParse(body)
    if (!parsed.success) return context.json({ error: 'invalid_join' }, 400)
    const input = parsed.data
    if (
      input.whatsapp.consent &&
      !openExperimentRecipientAllowed(
        context.env,
        queueId,
        experiment ? 'confirmation' : 'queue_joined',
      ) &&
      !(context.env.WHATSAPP_RECIPIENT_ALLOWLIST ?? '')
        .split(',')
        .map((p) => p.trim())
        .includes(input.whatsapp.phone)
    )
      return context.json({ error: 'recipient_not_allowed' }, 403)
    if (
      input.whatsapp.consent &&
      !experiment &&
      context.env.WHATSAPP_MODE === 'cloud' &&
      context.env.STAGING_CONSENT_APPROVED !== 'true'
    )
      return context.json({ error: 'consent_not_approved' }, 403)
    const bucket = String(Math.floor(Date.now() / 60000))
    const rate = await context.env.DB.prepare(
      'INSERT INTO pilot_rate(bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',
    )
      .bind(bucket)
      .first<{ count: number }>()
    if (!rate || rate.count > 30)
      return context.json({ error: 'rate_limited' }, 429)
    await context.env.DB.prepare('DELETE FROM pilot_rate WHERE bucket<?')
      .bind(String(Number(bucket) - 5))
      .run()
    const namespace =
      context.env.APP_ENV === 'local'
        ? context.env.QUEUE_COORDINATOR
        : context.env.QUEUE_COORDINATOR.jurisdiction('eu')
    const coordinator = namespace.getByName(context.req.param('queueId'))
    const result = await coordinator.join(
      context.req.param('queueId'),
      key.data,
      input,
      experiment,
    )
    return Response.json(result.body, {
      status: result.status,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  },
)
app.get('/public/entries/:recoveryToken', async (context) => {
  const token = context.req.param('recoveryToken')
  if (!/^[a-f0-9]{64}$/.test(token))
    return context.json({ error: 'not_found' }, 404)
  const entry = await readEntry(context.env, token)
  return entry ? context.json(entry) : context.json({ error: 'not_found' }, 404)
})
app.post('/integrations/360dialog/webhook', (context) =>
  receiveWebhook(context.req.raw, context.env),
)
app.post('/integrations/360dialog/webhook/:capability', (context) => {
  if (context.env.WHATSAPP_MODE !== 'sandbox')
    return context.json({ error: 'not_found' }, 404)
  return receiveWebhook(
    context.req.raw,
    context.env,
    context.req.param('capability'),
  )
})
async function boundedBody(request: Request, max: number) {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = '',
    length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > max) {
      await reader.cancel()
      throw new Error('Body too large')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}
