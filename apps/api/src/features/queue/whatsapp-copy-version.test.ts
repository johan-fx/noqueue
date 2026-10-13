import { env } from 'cloudflare:workers'
import { beforeAll, afterAll, afterEach, expect, it } from 'vitest'
import { setupNetwork } from '../../../test/fake-network'
import { http, HttpResponse } from 'msw'
import { joinQueue } from './entries'
import { dispatchNotificationSerialized } from './notifications'
import { runQueueCommand } from '../staff/commands'
import { readProjection, recalculateQueue } from './projection'
import { noticeStatement, type QueueNoticeSnapshot } from './notices'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { serviceWindow } from '../staff/availability'
import { topology } from './opening-state'

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
it('freezes v4 action lifecycle context without binding buttons to ETA revision', () => {
  let captured: unknown[] = []
  const bindings = {
    WHATSAPP_COPY_VERSION: '4',
    DB: {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          captured = [sql, ...values]
          return { run: async () => ({ meta: { changes: 1 } }) }
        },
      }),
    },
  } as unknown as CloudflareBindings
  noticeStatement(bindings, 'entry', 'approaching', 100, snapshot, 7, 3, true)
  const frozen = JSON.parse(String(captured[6]))
  expect(frozen).toMatchObject({
    copyVersion: 4,
    copyVariant: 'approaching',
    actionContext: {
      phase: 'waiting',
      callCycle: 3,
      expiresAt: 86_400_100,
    },
  })
  expect(frozen.actionContext).not.toHaveProperty('revision')
})
async function joined(
  profile: '2' | '3' | '4',
  options: {
    type?: 'reception' | 'restaurant'
    resourceStateKnown?: boolean
    waitingBefore?: number
    blockedMinutes?: number
    estimatorVersion?: 1 | 2
  } = {},
) {
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
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,'owner',?)",
    ).bind(crypto.randomUUID(), org, actor, 'now'),
    env.DB.prepare(
      "INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,?,'owner')",
    ).bind(actor, venue),
  ])
  const type = options.type ?? 'reception'
  const config: ServiceInput = {
    name: 'Example service',
    type,
    capacity: 20,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: ['check_in'],
    estimationMode: 'active',
    estimatorVersion: options.estimatorVersion ?? 1,
    resourceStateKnown: options.resourceStateKnown ?? true,
    approachTurns: 0,
    approachMinutes: 0,
    stations: 1,
    spaces:
      type === 'restaurant'
        ? [
            {
              id: 'main',
              name: 'Main room',
              tables: 1,
              tableTypes: [{ seats: 2, count: 1, averageMinutes: 30 }],
            },
          ]
        : [],
    ...(options.blockedMinutes
      ? {
          adjustments: [
            {
              kind: 'availability' as const,
              spaceId: 'main',
              seats: 2,
              reason: 'Temporary test block',
              expiresAt: Date.now() + options.blockedMinutes * 60_000,
            },
          ],
        }
      : {}),
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,20,30,1,'Example service',?)",
  )
    .bind(queueId, venue, JSON.stringify(config))
    .run()
  if (type === 'restaurant')
    await env.DB.prepare(
      'INSERT INTO queue_opening(queue_id,topology,complete,opened_at,actor_id) VALUES (?,?,1,?,?)',
    )
      .bind(queueId, topology(config), Date.now(), actor)
      .run()
  const venueRow = await env.DB.prepare(
    'SELECT timezone FROM venue WHERE id=?',
  )
    .bind(venue)
    .first<{ timezone: string }>()
  const window = serviceWindow(config, venueRow?.timezone ?? 'UTC')
  await env.DB.prepare(
    "INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)",
  )
    .bind(queueId, window.windowId, Date.now())
    .run()
  for (let index = 0; index < (options.waitingBefore ?? 0); index++) {
    const existing = await joinQueue(
      { ...env, WHATSAPP_COPY_VERSION: profile },
      queueId,
      crypto.randomUUID(),
      { partySize: 2, locale: 'es', whatsapp: { consent: false } },
    )
    expect(existing.status).toBe(201)
  }
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
    "SELECT id,entry_id,payload_snapshot,payload_version,idempotency_key,revision,status FROM notification_outbox WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?) AND kind='queue_joined' ORDER BY rowid DESC LIMIT 1",
  )
    .bind(queueId)
    .first<{
      id: string
      entry_id: string
      payload_snapshot: string
      payload_version: number
      idempotency_key: string
      revision: number
      status: string
    }>()
  if (!row) throw new Error('Missing joined snapshot')
  return { ...row, queueId, actor }
}
it('does not send a v4 action notice after its frozen button context expires', async () => {
  const row = await joined('4')
  const projection = await env.DB.prepare(
    'SELECT revision FROM queue_projection WHERE entry_id=?',
  )
    .bind(row.entry_id)
    .first<{ revision: number }>()
  const frozen = JSON.parse(row.payload_snapshot) as QueueNoticeSnapshot & {
    copyVersion: number
    copyVariant: string
    actionContext: { phase: string; callCycle: number; expiresAt: number }
  }
  frozen.copyVariant = 'approaching'
  frozen.actionContext = {
    phase: 'waiting',
    callCycle: 0,
    expiresAt: Date.now() - 1,
  }
  await env.DB.prepare(
    "UPDATE notification_outbox SET kind='approaching',revision=?,payload_snapshot=? WHERE id=?",
  )
    .bind(projection?.revision ?? 0, JSON.stringify(frozen), row.id)
    .run()
  let sends = 0
  network.use(
    http.post(endpoint, async () => {
      sends++
      return HttpResponse.json({ messages: [{ id: 'wamid.expired-action' }] })
    }),
  )

  await dispatchNotificationSerialized(env, row.id)

  expect(sends).toBe(0)
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
      .bind(row.id)
      .first(),
  ).toEqual({ status: 'cancelled' })
})
it('accepts a current adaptive safety delay once and records the accepted safety revision', async () => {
  const row = await joined('2', { estimatorVersion: 2 })
  const now = Date.now()
  const initial = await env.DB.prepare(
    'SELECT a.predicted_at,a.cadence_ms,p.revision FROM queue_adaptive_projection a JOIN queue_projection p USING(entry_id) WHERE entry_id=?',
  )
    .bind(row.entry_id)
    .first<{ predicted_at: number; cadence_ms: number; revision: number }>()
  expect(initial).not.toBeNull()

  // Emulate an active safety-delay episode. Recalculation below creates the
  // durable notice intent at the canonical projection revision.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE queue_adaptive_projection SET predicted_at=?,cadence_ms=240000,
       safety_review_at=?,delay_reason='safety',delay_since=?,delay_baseline_at=?,
       correction_reason='safety',safety_revision=8,notice_baseline_at=? WHERE entry_id=?`,
    ).bind(now + 30_000, now, now, now + 10_000, now + 60_000, row.entry_id),
    env.DB.prepare(
      "UPDATE queue_projection SET predicted_at=?,quality='provisional',updated_at=?,estimator_version=2 WHERE entry_id=?",
    ).bind(now + 30_000, now, row.entry_id),
  ])
  await recalculateQueue(env, row.queueId, now)
  const delayed = await env.DB.prepare(
    "SELECT id,revision,payload_snapshot FROM notification_outbox WHERE entry_id=? AND kind='delayed' AND status='pending' ORDER BY rowid DESC LIMIT 1",
  )
    .bind(row.entry_id)
    .first<{ id: string; revision: number; payload_snapshot: string }>()
  expect(delayed).not.toBeNull()
  const frozen = JSON.parse(delayed!.payload_snapshot) as QueueNoticeSnapshot
  expect(frozen).toMatchObject({
    estimatorVersion: 2,
    estimationRevision: delayed!.revision,
    correctionReason: 'safety',
    safetyRevision: 8,
    predictedAt: expect.any(Number),
  })

  const dispatchEnv = {
    ...env,
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_MODE: 'sandbox',
    D360DIALOG_API_KEY: 'mock-key',
    WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
    WHATSAPP_COPY_VERSION: '2',
  }
  let sends = 0
  network.use(
    http.post(endpoint, () => {
      sends++
      return HttpResponse.json({ messages: [{ id: 'wamid.adaptive-safety' }] })
    }),
  )
  await dispatchNotificationSerialized(dispatchEnv, delayed!.id)

  expect(sends).toBe(1)
  expect(
    await env.DB.prepare(
      'SELECT last_accepted_safety_revision FROM queue_notification_state WHERE entry_id=?',
    )
      .bind(row.entry_id)
      .first(),
  ).toEqual({ last_accepted_safety_revision: 8 })

  await dispatchNotificationSerialized(dispatchEnv, delayed!.id)
  expect(sends).toBe(1)
})
it('rejects a legacy adaptive delay whose frozen projection revision is obsolete', async () => {
  const row = await joined('2', { estimatorVersion: 2 })
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE queue_adaptive_projection SET predicted_at=?,cadence_ms=240000,
       safety_review_at=?,delay_reason='safety',delay_since=?,delay_baseline_at=?,
       correction_reason='safety',safety_revision=3,notice_baseline_at=? WHERE entry_id=?`,
    ).bind(now + 30_000, now, now, now + 10_000, now + 60_000, row.entry_id),
    env.DB.prepare(
      "UPDATE queue_projection SET predicted_at=?,quality='provisional',updated_at=?,estimator_version=2 WHERE entry_id=?",
    ).bind(now + 30_000, now, row.entry_id),
  ])
  await recalculateQueue(env, row.queueId, now)
  const delayed = await env.DB.prepare(
    "SELECT id,revision,payload_snapshot FROM notification_outbox WHERE entry_id=? AND kind='delayed' AND status='pending' ORDER BY rowid DESC LIMIT 1",
  )
    .bind(row.entry_id)
    .first<{ id: string; revision: number; payload_snapshot: string }>()
  expect(delayed).not.toBeNull()
  const obsolete = JSON.parse(delayed!.payload_snapshot) as QueueNoticeSnapshot
  delete obsolete.extensionSequence // Pre-0023 snapshots remain revision-bound.
  obsolete.estimationRevision = Math.max(0, delayed!.revision - 1)
  await env.DB.prepare(
    'UPDATE notification_outbox SET revision=?,payload_snapshot=? WHERE id=?',
  )
    .bind(obsolete.estimationRevision, JSON.stringify(obsolete), delayed!.id)
    .run()

  let sends = 0
  network.use(
    http.post(endpoint, () => {
      sends++
      return HttpResponse.json({ messages: [{ id: 'wamid.obsolete-adaptive' }] })
    }),
  )
  await dispatchNotificationSerialized(
    {
      ...env,
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_MODE: 'sandbox',
      D360DIALOG_API_KEY: 'mock-key',
      WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
      WHATSAPP_COPY_VERSION: '2',
    },
    delayed!.id,
  )

  expect(sends).toBe(0)
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
      .bind(delayed!.id)
      .first(),
  ).toEqual({ status: 'cancelled' })
})
it('cancels a pending adaptive delay when ready supersedes it and sends the ready notice', async () => {
  const row = await joined('2', { estimatorVersion: 2, type: 'restaurant' })
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE queue_adaptive_projection SET predicted_at=?,cadence_ms=240000,
       safety_review_at=?,delay_reason='safety',delay_since=?,delay_baseline_at=?,
       correction_reason='safety',safety_revision=4,notice_baseline_at=? WHERE entry_id=?`,
    ).bind(now + 30_000, now, now, now + 10_000, now + 60_000, row.entry_id),
    env.DB.prepare(
      "UPDATE queue_projection SET predicted_at=?,quality='provisional',updated_at=?,estimator_version=2 WHERE entry_id=?",
    ).bind(now + 30_000, now, row.entry_id),
  ])
  await recalculateQueue(env, row.queueId, now)
  const delayed = await env.DB.prepare(
    "SELECT id FROM notification_outbox WHERE entry_id=? AND kind='delayed' AND status='pending' ORDER BY rowid DESC LIMIT 1",
  )
    .bind(row.entry_id)
    .first<{ id: string }>()
  expect(delayed).not.toBeNull()

  await runQueueCommand(
    { ...env, WHATSAPP_COPY_VERSION: '2' },
    row.actor,
    row.queueId,
    crypto.randomUUID(),
    { action: 'call', entryId: row.entry_id, version: 0 },
  )
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
      .bind(delayed!.id)
      .first(),
  ).toEqual({ status: 'cancelled' })
  const ready = await env.DB.prepare(
    "SELECT id FROM notification_outbox WHERE entry_id=? AND kind='ready' AND status='pending' ORDER BY rowid DESC LIMIT 1",
  )
    .bind(row.entry_id)
    .first<{ id: string }>()
  expect(ready).not.toBeNull()

  let sends = 0
  network.use(
    http.post(endpoint, () => {
      sends++
      return HttpResponse.json({ messages: [{ id: 'wamid.ready-supersedes' }] })
    }),
  )
  const dispatchEnv = {
    ...env,
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_MODE: 'sandbox',
    D360DIALOG_API_KEY: 'mock-key',
    WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
    WHATSAPP_COPY_VERSION: '2',
  }
  await dispatchNotificationSerialized(dispatchEnv, delayed!.id)
  await dispatchNotificationSerialized(dispatchEnv, ready!.id)
  expect(sends).toBe(1)
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
      .bind(ready!.id)
      .first(),
  ).toEqual({ status: 'accepted' })
})
it('cancels an approaching notice when only position is close and the known ETA is outside the cutoff', async () => {
  const row = await joined('4')
  const predictedAt = Date.now() + 30 * 60_000
  await env.DB.prepare(
    "UPDATE queue SET config=json_set(config,'$.approachTurns',0,'$.approachMinutes',5) WHERE id=?",
  )
    .bind(row.queueId)
    .run()
  await env.DB.prepare(
    "UPDATE queue_projection SET position=1,eta_minutes=30,predicted_at=?,quality='estimated' WHERE entry_id=?",
  )
    .bind(predictedAt, row.entry_id)
    .run()
  const projection = await env.DB.prepare(
    'SELECT revision FROM queue_projection WHERE entry_id=?',
  )
    .bind(row.entry_id)
    .first<{ revision: number }>()
  const frozen = JSON.parse(row.payload_snapshot) as QueueNoticeSnapshot & {
    copyVersion: number
    copyVariant: string
    actionContext: { phase: string; callCycle: number; expiresAt: number }
  }
  frozen.copyVariant = 'approaching'
  frozen.actionContext = {
    phase: 'waiting',
    callCycle: 0,
    expiresAt: predictedAt,
  }
  await env.DB.prepare(
    "UPDATE notification_outbox SET kind='approaching',revision=?,payload_snapshot=? WHERE id=?",
  )
    .bind(projection?.revision ?? 0, JSON.stringify(frozen), row.id)
    .run()

  let sends = 0
  network.use(
    http.post(endpoint, async () => {
      sends++
      return HttpResponse.json({ messages: [{ id: 'wamid.position-only' }] })
    }),
  )
  await dispatchNotificationSerialized(
    {
      ...env,
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_MODE: 'sandbox',
      D360DIALOG_API_KEY: 'mock-key',
      WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
      WHATSAPP_COPY_VERSION: '4',
    },
    row.id,
  )

  expect(sends).toBe(0)
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
      .bind(row.id)
      .first(),
  ).toEqual({ status: 'cancelled' })
})
it('freezes the canonical v4 joined projection and dispatches it successfully', async () => {
  const row = await joined('4')
  expect(row.payload_version).toBe(2)
  const projection = await env.DB.prepare(
    'SELECT position,eta_minutes,predicted_at,quality,revision FROM queue_projection WHERE entry_id=?',
  )
    .bind(row.entry_id)
    .first<{
      position: number
      eta_minutes: number
      predicted_at: number | null
      quality: 'estimated' | 'provisional' | 'unknown'
      revision: number
    }>()
  expect(projection).not.toBeNull()
  const frozen = JSON.parse(row.payload_snapshot) as QueueNoticeSnapshot & {
    copyVersion: number
    copyVariant: string
    projectionPending?: boolean
  }
  expect(frozen).toMatchObject({
    schemaVersion: 2,
    copyVersion: 4,
    copyVariant: 'queue_joined',
    serviceName: 'Example service',
    ahead: Math.max(0, projection!.position - 1),
    etaMinutes: 30,
    predictedAt: expect.any(Number),
    estimateQuality: 'provisional',
  })
  expect(row.revision).toBe(projection!.revision)
  expect(frozen.projectionPending).toBeUndefined()

  const dispatchEnv = {
    ...env,
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_MODE: 'sandbox',
    D360DIALOG_API_KEY: 'mock-key',
    WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
  }
  const sent: unknown[] = []
  network.use(
    http.post(endpoint, async ({ request }) => {
      sent.push(await request.json())
      return sent.length === 1
        ? new HttpResponse(null, { status: 429 })
        : HttpResponse.json({ messages: [{ id: 'wamid.v4-joined' }] })
    }),
  )
  await dispatchNotificationSerialized(
    { ...dispatchEnv, WHATSAPP_COPY_VERSION: '2' },
    row.id,
  )
  await env.DB.prepare(
    'UPDATE notification_outbox SET next_attempt_at=0 WHERE id=?',
  )
    .bind(row.id)
    .run()
  await dispatchNotificationSerialized(
    { ...dispatchEnv, WHATSAPP_COPY_VERSION: '3' },
    row.id,
  )
  expect(sent).toHaveLength(2)
  expect(sent[0]).toEqual(sent[1])
  expect(
    await env.DB.prepare('SELECT status FROM notification_outbox WHERE id=?')
      .bind(row.id)
      .first(),
  ).toEqual({ status: 'accepted' })
})

it('uses the canonical serial estimate without claiming restaurant availability', async () => {
  const row = await joined('4', {
    type: 'restaurant',
    resourceStateKnown: false,
    waitingBefore: 1,
  })
  const projection = await readProjection(env, row.entry_id, true)
  const frozen = JSON.parse(row.payload_snapshot) as QueueNoticeSnapshot
  expect(projection).toMatchObject({
    estimatorVersion: 2,
    estimateQuality: 'provisional',
    etaMinutes: 60,
    callable: true,
    resourceId: null,
  })
  expect(projection?.predictedAt).toEqual(expect.any(Number))
  expect(frozen).toMatchObject({
    ahead: 1,
    etaMinutes: 60,
    predictedAt: expect.any(Number),
    estimateQuality: 'provisional',
  })
  expect(row.revision).toBe(projection!.estimationRevision)
})

it('ignores legacy availability holds and keeps WhatsApp aligned with the canonical ETA', async () => {
  const row = await joined('4', {
    type: 'restaurant',
    resourceStateKnown: true,
    waitingBefore: 1,
    blockedMinutes: 15,
  })
  const projection = await readProjection(env, row.entry_id, true)
  const frozen = JSON.parse(row.payload_snapshot) as QueueNoticeSnapshot
  expect(projection).toMatchObject({
    estimatorVersion: 2,
    estimateQuality: 'provisional',
    etaMinutes: 60,
    callable: true,
    resourceId: null,
  })
  expect(projection?.predictedAt).toEqual(expect.any(Number))
  expect(frozen).toMatchObject({
    ahead: 1,
    etaMinutes: 60,
    predictedAt: expect.any(Number),
    estimateQuality: 'provisional',
  })
  expect(row.revision).toBe(projection!.estimationRevision)
})

it('repairs a durable v4 join intent if projection finalization was interrupted', async () => {
  const row = await joined('4')
  const frozen = JSON.parse(row.payload_snapshot) as QueueNoticeSnapshot & {
    copyVersion: number
    copyVariant: string
    projectionPending?: boolean
  }
  frozen.projectionPending = true
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE notification_outbox SET revision=0,payload_snapshot=? WHERE id=? AND status='pending'",
    ).bind(JSON.stringify(frozen), row.id),
    env.DB.prepare('DELETE FROM queue_projection WHERE entry_id=?').bind(
      row.entry_id,
    ),
  ])
  const dispatchEnv = {
    ...env,
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_MODE: 'sandbox',
    D360DIALOG_API_KEY: 'mock-key',
    WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
  }
  let failFinalization = true
  let finalizationPrepared = false
  let injectedFailure = false
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) => {
          if (
            sql.includes('UPDATE notification_outbox') &&
            sql.includes('payload_snapshot') &&
            sql.includes('revision')
          )
            finalizationPrepared = true
          return target.prepare(sql)
        }
      if (property === 'batch')
        return async (statements: Parameters<typeof target.batch>[0]) => {
          if (failFinalization && finalizationPrepared) {
            failFinalization = false
            finalizationPrepared = false
            injectedFailure = true
            throw new Error('Injected projection finalization failure')
          }
          finalizationPrepared = false
          return target.batch(statements)
        }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const retryEnv = { ...dispatchEnv, DB: db }
  let sends = 0
  network.use(
    http.post(endpoint, () => {
      sends++
      return HttpResponse.json({ messages: [{ id: 'wamid.reconciled-join' }] })
    }),
  )

  let dispatchError: unknown
  try {
    await dispatchNotificationSerialized(retryEnv, row.id)
  } catch (error) {
    dispatchError = error
  }
  expect(injectedFailure).toBe(true)
  expect(dispatchError).toMatchObject({
    message: 'Injected projection finalization failure',
  })
  expect(sends).toBe(0)
  const pending = await env.DB.prepare(
    'SELECT n.status,n.revision,n.payload_snapshot,p.revision AS projection_revision FROM notification_outbox n LEFT JOIN queue_projection p ON p.entry_id=n.entry_id WHERE n.id=?',
  )
    .bind(row.id)
    .first<{
      status: string
      revision: number
      payload_snapshot: string
      projection_revision: number | null
    }>()
  expect(pending).toMatchObject({
    status: 'pending',
    revision: 0,
    projection_revision: null,
  })
  expect(JSON.parse(pending!.payload_snapshot)).toMatchObject({
    copyVersion: 4,
    copyVariant: 'queue_joined',
    projectionPending: true,
  })

  await dispatchNotificationSerialized(retryEnv, row.id)
  expect(sends).toBe(1)
  const repaired = await env.DB.prepare(
    'SELECT n.status,n.revision,n.payload_snapshot,p.position,p.eta_minutes,p.predicted_at,p.quality,p.revision AS projection_revision FROM notification_outbox n JOIN queue_projection p ON p.entry_id=n.entry_id WHERE n.id=?',
  )
    .bind(row.id)
    .first<{
      status: string
      revision: number
      payload_snapshot: string
      position: number
      eta_minutes: number
      predicted_at: number | null
      quality: 'estimated' | 'provisional' | 'unknown'
      projection_revision: number
    }>()
  if (!repaired) throw new Error('Missing recovered joined notification')
  expect(repaired).toMatchObject({
    status: 'accepted',
    revision: repaired?.projection_revision,
  })
  expect(JSON.parse(repaired.payload_snapshot)).toMatchObject({
    ahead: Math.max(0, repaired.position - 1),
    etaMinutes: 30,
    predictedAt: expect.any(Number),
    estimateQuality: 'provisional',
  })
  expect(JSON.parse(repaired!.payload_snapshot)).not.toHaveProperty(
    'projectionPending',
  )
})
it('freezes joined v3 at enqueue, keeps rate-limit retries identical after profile changes, and never retries unknown automatically', async () => {
  const row = await joined('3')
  expect(row.payload_version).toBe(2)
  expect(JSON.parse(row.payload_snapshot)).toMatchObject({
    schemaVersion: 2,
    copyVersion: 3,
    approachRecommended: false,
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
    ': estás en la lista. Queda 1 turno por delante. Tiempo estimado: 30 min.',
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
