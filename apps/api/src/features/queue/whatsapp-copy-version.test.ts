import { env } from 'cloudflare:workers'
import { beforeAll, afterAll, afterEach, expect, it } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { joinQueue } from './entries'
import { dispatchNotificationSerialized } from './notifications'
import { noticeStatement, type QueueNoticeSnapshot } from './notices'

const network = setupNetwork()
beforeAll(() => network.enable())
afterAll(() => network.disable())
afterEach(() => network.resetHandlers())
const endpoint = 'https://waba-sandbox.360dialog.io/v1/messages'
const snapshot: QueueNoticeSnapshot = {
  schemaVersion: 2,
  serviceName: 'Example service',
  ahead: 3,
  etaMinutes: 12,
  predictedAt: null,
  estimateQuality: 'estimated',
  resourceName: null,
  arrivalDeadlineAt: null,
  approachRecommended: false,
}

it('stamps the central notice version without changing schema, SQL payload version or idempotency keys', () => {
  let captured: unknown[] = []
  const bindings = {
    WHATSAPP_COPY_VERSION: '3',
    DB: {
      prepare: () => ({
        bind: (...args: unknown[]) => {
          captured = args
        },
      }),
    },
  } as unknown as CloudflareBindings
  noticeStatement(bindings, 'entry', 'improved', 123, snapshot, 7, 2, true)
  expect(captured[2]).toBe('entry:improved:v2:r7:c2')
  expect(JSON.parse(String(captured[5]))).toMatchObject({
    schemaVersion: 2,
    copyVersion: 3,
    approachRecommended: false,
  })
})
async function joined(profile: '2' | '3') {
  const queueId = crypto.randomUUID(),
    actor = crypto.randomUUID(),
    org = crypto.randomUUID(),
    venue = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)',
    ).bind(actor, 'Example actor', `${actor}@test.invalid`, 'now', 'now'),
    env.DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(
      org,
      'Example organization',
    ),
    env.DB.prepare(
      'INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)',
    ).bind(org, actor),
    env.DB.prepare(
      'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
    ).bind(venue, org, 'Example venue'),
  ])
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,20,30,1,'Example service',?)",
  )
    .bind(
      queueId,
      venue,
      JSON.stringify({
        name: 'Example service',
        type: 'reception',
        capacity: 20,
        averageMinutes: 30,
        graceMinutes: 5,
        cutoffMinutes: 0,
        twentyFourHours: true,
        schedules: [],
        receptionServices: ['check_in'],
        estimationMode: 'active',
        resourceStateKnown: true,
        approachTurns: 0,
        approachMinutes: 0,
        stations: 1,
        spaces: [],
      }),
    )
    .run()
  const result = await joinQueue(
    { ...env, WHATSAPP_COPY_VERSION: profile },
    queueId,
    crypto.randomUUID(),
    {
      partySize: 2,
      locale: 'es',
      whatsapp: {
        consent: true,
        phone: '+34600000000',
        version: 'whatsapp-queue-updates-v1',
      },
    },
  )
  expect(result.status).toBe(201)
  const row = await env.DB.prepare(
    "SELECT id,payload_snapshot,payload_version,idempotency_key FROM notification_outbox WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?) AND kind='queue_joined'",
  )
    .bind(queueId)
    .first<{
      id: string
      payload_snapshot: string
      payload_version: number
      idempotency_key: string
    }>()
  if (!row) throw new Error('Missing joined snapshot')
  return row
}
it('freezes joined v3 at enqueue, keeps rate-limit retries identical after profile changes, and never retries unknown automatically', async () => {
  const row = await joined('3')
  expect(row.payload_version).toBe(2)
  expect(JSON.parse(row.payload_snapshot)).toMatchObject({
    schemaVersion: 2,
    copyVersion: 3,
    approachRecommended: true,
  })
  const sent: unknown[] = []
  network.use(
    http.post(endpoint, async ({ request }) => {
      sent.push(await request.json())
      return sent.length === 1
        ? new HttpResponse(null, { status: 429 })
        : new HttpResponse(null, { status: 500 })
    }),
  )
  await dispatchNotificationSerialized(
    { ...env, WHATSAPP_COPY_VERSION: '2' },
    row.id,
  )
  await env.DB.prepare(
    'UPDATE notification_outbox SET next_attempt_at=0 WHERE id=?',
  )
    .bind(row.id)
    .run()
  await dispatchNotificationSerialized(
    { ...env, WHATSAPP_COPY_VERSION: 'invalid' },
    row.id,
  )
  expect(sent).toHaveLength(2)
  expect(sent[0]).toEqual(sent[1])
  expect(JSON.stringify(sent)).toContain(
    'Ya estás en la cola. Te avisaremos cuando sea tu turno.',
  )
  await dispatchNotificationSerialized(env, row.id)
  expect(sent).toHaveLength(2)
  expect(
    await env.DB.prepare(
      'SELECT status,attempts FROM notification_outbox WHERE id=?',
    )
      .bind(row.id)
      .first(),
  ).toEqual({ status: 'unknown', attempts: 2 })
})
it('renders historical missing-version snapshots as exact v2 despite current v3 profile', async () => {
  const row = await joined('2')
  const old = JSON.parse(row.payload_snapshot)
  delete old.copyVersion
  await env.DB.prepare(
    'UPDATE notification_outbox SET payload_snapshot=? WHERE id=?',
  )
    .bind(JSON.stringify(old), row.id)
    .run()
  const sent: { text?: { body: string } }[] = []
  network.use(
    http.post(endpoint, async ({ request }) => {
      sent.push((await request.json()) as (typeof sent)[number])
      return HttpResponse.json({ messages: [{ id: 'mock-history' }] })
    }),
  )
  await dispatchNotificationSerialized(
    { ...env, WHATSAPP_COPY_VERSION: '3' },
    row.id,
  )
  expect(sent).toHaveLength(1)
  expect(sent[0]?.text?.body).toContain(
    ': estás en la lista. Quedan 0 turnos por delante. Tiempo estimado: 0 min.',
  )
  expect(sent[0]?.text?.body).not.toContain('Ya estás en la cola.')
})

it('records an observable failed intent rather than v1 fallback for new snapshotless v3 lifecycle notices', () => {
  let sql = ''
  let captured: unknown[] = []
  const bindings = {
    WHATSAPP_COPY_VERSION: '3',
    DB: {
      prepare: (value: string) => {
        sql = value
        return {
          bind: (...args: unknown[]) => {
            captured = args
          },
        }
      },
    },
  } as unknown as CloudflareBindings
  noticeStatement(bindings, 'legacy-entry', 'ready', 123)
  expect(sql).toContain("'failed'")
  expect(JSON.stringify(captured)).toContain('configured_service_required')
})

it('refuses new real v3 legacy joins but preserves controlled local offline admission without sending fallback copy', async () => {
  const { whatsappV3Catalog } = await import(
    '../../integrations/whatsapp-copy-v3'
  )
  const queueId = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name) VALUES (?,'demo-venue',20,30,1,'Legacy')",
  )
    .bind(queueId)
    .run()
  const input = {
    partySize: 2,
    locale: 'es' as const,
    whatsapp: {
      consent: true as const,
      phone: '+34600000000',
      version: 'whatsapp-public-service-updates-v1' as const,
    },
  }
  const real = {
    ...env,
    APP_ENV: 'staging',
    PUBLIC_APP_ORIGIN: 'https://example.test',
    WHATSAPP_COPY_VERSION: '3',
    WHATSAPP_MODE: 'cloud',
    D360DIALOG_PHONE_NUMBER_ID: 'mock-phone-id',
    STAGING_CONSENT_APPROVED: 'true',
    WHATSAPP_V3_TEMPLATES_APPROVED: 'true',
    ...Object.fromEntries(whatsappV3Catalog.map((t) => [t.binding, t.name])),
  } as CloudflareBindings
  const denied = await joinQueue(
    real,
    queueId,
    crypto.randomUUID(),
    input,
    false,
    undefined,
    'public-queue',
  )
  expect(denied).toMatchObject({
    status: 503,
    body: { error: 'whatsapp_unavailable' },
  })
  const local = await joinQueue(
    { ...env, WHATSAPP_COPY_VERSION: '3' },
    queueId,
    crypto.randomUUID(),
    input,
  )
  expect(local.status).toBe(201)
  expect(
    await env.DB.prepare(
      "SELECT status,payload_version FROM notification_outbox WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?) AND kind='queue_joined'",
    )
      .bind(queueId)
      .first(),
  ).toEqual({ status: 'failed', payload_version: 2 })
})
