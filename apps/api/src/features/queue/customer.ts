import { maintainServiceEntries } from './service-expiry'
import { noticeStatement, publishNotice } from './notices'
import { HTTPException } from 'hono/http-exception'
import {
  customerCommandSchema,
  type CustomerCommand,
} from '@noqueue/contracts/queue'
import { encryptDisplayName, hash, hmac, secureEqual } from './crypto'
import { eligibleResources } from './engine'
import { loadQueueState, recalculateQueue } from './projection'
import type { QueueNoticeSnapshot } from './notices'
import {
  parseWhatsAppAction,
  renderWhatsAppActionError,
  renderWhatsAppActionResult,
  signWhatsAppAction,
  type TrustedWhatsAppAction,
} from './whatsapp-actions'

export function customerPhase(
  status: string,
  _position: number,
  eta: number,
  quality: string | undefined,
  config: { approachTurns?: number; approachMinutes?: number },
) {
  if (status === 'completed' || status === 'served') return 'arrived'
  if (status === 'no_show' || status === 'expired') return 'expired'
  if (status === 'called' || status === 'cancelled') return status
  return quality !== 'unknown' &&
    quality !== undefined &&
    eta <= (config.approachMinutes ?? 10)
    ? 'approaching'
    : 'waiting'
}

/** Called inside the queue coordinator; every statement commits together. */
export async function expireArrivals(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  const due = await env.DB.prepare(
    `SELECT e.id,e.call_cycle,e.arrival_deadline_at,q.config,a.space_id
     FROM queue_entry e JOIN queue q ON q.id=e.queue_id
     LEFT JOIN queue_allocation a ON a.entry_id=e.id AND a.released_at IS NULL
     WHERE e.queue_id=? AND e.status='called' AND e.arrival_deadline_at<=?`,
  )
    .bind(queueId, now)
    .all<{
      id: string
      call_cycle: number
      arrival_deadline_at: number
      config: string | null
      space_id: string | null
    }>()
  if (!due.results.length) return
  const statements = due.results.flatMap((entry) => {
    let serviceName = 'Service'
    let resourceName: string | null = null
    try {
      if (entry.config) {
        const config = JSON.parse(entry.config) as {
          name?: string
          type?: string
          spaces?: Array<{ id?: string; name?: string }>
        }
        serviceName = config.name ?? serviceName
        resourceName =
          config.spaces?.find((space) => space.id === entry.space_id)?.name ??
          (config.type === 'reception'
            ? 'Recepción'
            : config.type === 'pool'
            ? 'Piscina / bar'
            : null)
      }
    } catch {
      // Keep the safe service fallback; do not break an expiry transition.
    }
    const snapshot: QueueNoticeSnapshot = {
      schemaVersion: 2,
      serviceName,
      ahead: null,
      etaMinutes: null,
      predictedAt: null,
      estimateQuality: 'unknown',
      resourceName,
      arrivalDeadlineAt: entry.arrival_deadline_at,
    }
    return [
    noticeStatement(
      env,
      entry.id,
      'expired',
      now,
      snapshot,
      0,
      entry.call_cycle,
      !!entry.config,
    ),
    env.DB.prepare(
      "INSERT INTO queue_event(id,entry_id,kind,created_at) SELECT ?,id,'expired',? FROM queue_entry WHERE id=? AND status='called'",
    ).bind(crypto.randomUUID(), now, entry.id),
    env.DB.prepare(
      "UPDATE queue_allocation SET released_at=?,outcome='expired' WHERE entry_id=? AND released_at IS NULL AND EXISTS(SELECT 1 FROM queue_entry WHERE id=? AND status='called')",
    ).bind(now, entry.id, entry.id),
    env.DB.prepare(
      "UPDATE queue_entry SET status='expired',version=version+1 WHERE id=? AND status='called' AND arrival_deadline_at<=?",
    ).bind(entry.id, now),
  ]})
  await env.DB.batch(statements)
  for (const { id } of due.results) await publishNotice(env, id, 'expired')
}

export async function runCustomerCommand(
  env: CloudflareBindings,
  queueId: string,
  token: string,
  key: string,
  input: CustomerCommand,
  now = Date.now(),
  origin?: TrustedWhatsAppAction,
) {
  customerCommandSchema.parse(input)
  await maintainServiceEntries(env, queueId, now)
  await expireArrivals(env, queueId, now)
  const entry = await env.DB.prepare(
    origin
      ? 'SELECT id,status,version,sequence,party_size,preferred_space_id,call_cycle,locale FROM queue_entry WHERE id=? AND queue_id=?'
      : 'SELECT id,status,version,sequence,party_size,preferred_space_id,call_cycle,locale FROM queue_entry WHERE recovery_hash=? AND queue_id=?',
  )
    .bind(origin ? origin.entryId : await hash(token), queueId)
    .first<{
      id: string
      status: string
      version: number
      sequence: number
      party_size: number
      preferred_space_id: string | null
      call_cycle: number
      locale: 'es' | 'en'
    }>()
  if (!entry) throw new HTTPException(404, { message: 'not_found' })
  // Keyed fingerprints do not reveal names through offline dictionary attacks.
  const fingerprint = await hmac(
    env.RECOVERY_TOKEN_KEY,
    origin
      ? JSON.stringify([
          'whatsapp-action-command:v1',
          origin.notificationId,
          origin.action,
        ])
      : JSON.stringify(input),
  )
  const prior = await env.DB.prepare(
    'SELECT request_hash,result FROM customer_command WHERE entry_id=? AND request_key=?',
  )
    .bind(entry.id, key)
    .first<{ request_hash: string; result: string }>()
  if (prior) {
    if (prior.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    if (origin)
      await env.DB.prepare(
        'UPDATE webhook_event SET processed_at=? WHERE id=? AND processed_at IS NULL',
      )
        .bind(now, origin.webhookEventId)
        .run()
    return JSON.parse(prior.result) as { ok: true }
  }
  if (
    origin &&
    (entry.status !== origin.phase ||
      entry.call_cycle !== origin.callCycle ||
      now >= origin.expiresAt ||
      origin.occurredAt > origin.expiresAt ||
      origin.occurredAt > now + 1_000)
  )
    throw new HTTPException(409, { message: 'stale_action' })
  if (entry.version !== input.version)
    throw new HTTPException(409, { message: 'version_conflict' })
  const calledAction =
    entry.status === 'called' &&
    (input.action === 'cancel' || input.action === 'yield')
  if (entry.status !== 'waiting' && !calledAction)
    throw new HTTPException(409, { message: 'invalid_transition' })
  const state = await loadQueueState(env, queueId, now)
  if (
    !state.config ||
    (input.action === 'update' && state.config.type !== 'restaurant')
  )
    throw new HTTPException(409, { message: 'unsupported_service' })
  const statements: D1PreparedStatement[] = []
  let metadata: Record<string, unknown> = {}
  let notifyCancellation = false
  let notifyReadyEntryId: string | null = null
  if (input.action === 'update') {
    const party = { id: entry.id, sequence: entry.sequence, ...input }
    if (
      !eligibleResources(
        party,
        state.resources,
        state.config.assignmentPreference,
      ).length
    )
      throw new HTTPException(400, { message: 'invalid_space_preference' })
    statements.push(
      env.DB.prepare(
        'UPDATE queue_entry SET display_name_cipher=?,party_size=?,preferred_space_id=?,locale=?,version=version+1 WHERE id=?',
      ).bind(
        await encryptDisplayName(env.PII_ENCRYPTION_KEY, input.displayName),
        input.partySize,
        input.preferredSpaceId,
        input.locale,
        entry.id,
      ),
    )
    metadata = {
      partySize: input.partySize,
      preferredSpaceId: input.preferredSpaceId,
    }
  } else if (input.action === 'cancel') {
    const snapshot: QueueNoticeSnapshot = {
      schemaVersion: 2,
      serviceName: state.config.name,
      ahead: null,
      etaMinutes: null,
      predictedAt: null,
      estimateQuality: 'unknown',
      resourceName: null,
      arrivalDeadlineAt: null,
      reason: 'customer_cancel',
    }
    if (!origin)
      statements.push(
        noticeStatement(
          env, entry.id, 'cancelled', now, snapshot, 0, 0, !!state.config,
        ),
      )
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO notification_trace(id,notification_id,event,recorded_at) SELECT id||':obsolete',id,'obsolete',? FROM notification_outbox WHERE entry_id=? AND kind IN ('queue_joined','approaching','delayed','improved') AND status='pending'",
      ).bind(now, entry.id),
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE entry_id=? AND kind IN ('queue_joined','approaching','delayed','improved','ready') AND status='pending'",
      ).bind(now, entry.id),
      env.DB.prepare(
        "UPDATE queue_allocation SET released_at=?,outcome='cancelled' WHERE entry_id=? AND released_at IS NULL",
      ).bind(now, entry.id),
      env.DB.prepare(
        "UPDATE queue_entry SET status='cancelled',version=version+1,called_at=NULL,arrival_deadline_at=NULL,call_cycle=CASE WHEN status='called' THEN call_cycle+1 ELSE call_cycle END WHERE id=?",
      ).bind(entry.id),
    )
    notifyCancellation = !origin
    metadata = { outcome: 'cancelled' }
  } else if (entry.status === 'called') {
    const allocation = state.allocations.find(
      (item) => item.entry_id === entry.id && item.released_at === null,
    )
    const calledParty = {
      id: entry.id,
      sequence: entry.sequence,
      partySize: entry.party_size,
      preferredSpaceId: entry.preferred_space_id,
    }
    const releasedResource = allocation
      ? state.resources.filter((resource) => resource.id === allocation.resource_id)
      : state.config.type === 'restaurant'
        ? []
        : state.resources.filter(
            (resource) =>
              eligibleResources(
                calledParty,
                [resource],
                state.config!.assignmentPreference,
              ).length > 0,
          )
    const successors = state.parties
      .filter((candidate) => candidate.sequence > entry.sequence)
      .sort((a, b) => a.sequence - b.sequence)
    const successor = successors.find(
      (candidate) =>
        eligibleResources(
          candidate,
          releasedResource,
          state.config!.assignmentPreference,
        ).length > 0,
    )
    statements.push(
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE entry_id=? AND kind='ready' AND status='pending'",
      ).bind(now, entry.id),
      env.DB.prepare(
        "UPDATE queue_allocation SET released_at=?,outcome='yielded' WHERE entry_id=? AND released_at IS NULL",
      ).bind(now, entry.id),
    )
    if (successor) {
      const priorCycle = await env.DB.prepare(
        'SELECT call_cycle FROM queue_entry WHERE id=?',
      )
        .bind(successor.id)
        .first<{ call_cycle: number }>()
      const nextCycle = (priorCycle?.call_cycle ?? 0) + 1
      const resource = allocation
        ? state.resources.find((item) => item.id === allocation.resource_id)
        : null
      const deadline = now + (state.config.graceMinutes ?? 5) * 60_000
      const resourceName = resource
        ? state.config.spaces.find((space) => space.id === resource.spaceId)?.name ?? null
        : state.config.type === 'pool'
          ? 'Piscina / bar'
          : state.config.type === 'reception'
            ? 'Recepción'
            : null
      statements.push(
        env.DB.prepare(
          'UPDATE queue_entry SET sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?) WHERE id=?',
        ).bind(queueId, entry.id),
        env.DB.prepare(
          "UPDATE queue_entry SET sequence=?,status='called',version=version+1,progress_initial_eta_minutes=COALESCE(progress_initial_eta_minutes,?),call_cycle=call_cycle+1,called_at=?,arrival_deadline_at=? WHERE id=? AND status='waiting'",
        ).bind(
          entry.sequence,
          state.config.graceMinutes ?? 5,
          now,
          deadline,
          successor.id,
        ),
        env.DB.prepare(
          "UPDATE queue_entry SET sequence=?,status='waiting',version=version+1,call_cycle=call_cycle+1,called_at=NULL,arrival_deadline_at=NULL WHERE id=? AND status='called'",
        ).bind(successor.sequence, entry.id),
        env.DB.prepare(
          "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'yield_received',?)",
        ).bind(crypto.randomUUID(), successor.id, now),
        env.DB.prepare(
          "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'called',?)",
        ).bind(crypto.randomUUID(), successor.id, now),
      )
      if (allocation && resource)
        statements.push(
          env.DB.prepare(
            'INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(entry_id) DO UPDATE SET resource_id=excluded.resource_id,space_id=excluded.space_id,seats=excluded.seats,reserved_at=excluded.reserved_at,arrived_at=NULL,released_at=NULL,outcome=NULL WHERE queue_allocation.released_at IS NOT NULL',
          ).bind(
            successor.id,
            queueId,
            resource.id,
            resource.spaceId,
            resource.seats,
            now,
          ),
        )
      statements.push(
        noticeStatement(
          env,
          successor.id,
          'ready',
          now,
          {
            schemaVersion: 2,
            serviceName: state.config.name,
            ahead: null,
            etaMinutes: null,
            predictedAt: null,
            estimateQuality: 'unknown',
            resourceName,
            arrivalDeadlineAt: deadline,
          },
          0,
          nextCycle,
          true,
        ),
      )
      metadata = {
        successorId: successor.id,
        fromSequence: entry.sequence,
        toSequence: successor.sequence,
        outcome: 'called_handoff',
      }
      notifyReadyEntryId = successor.id
    } else {
      statements.push(
        env.DB.prepare(
          "UPDATE queue_entry SET status='waiting',version=version+1,call_cycle=call_cycle+1,called_at=NULL,arrival_deadline_at=NULL WHERE id=? AND status='called'",
        ).bind(entry.id),
      )
      metadata = { outcome: 'returned_to_waiting', sequence: entry.sequence }
    }
  } else {
    const party = state.parties.find((p) => p.id === entry.id)!
    const resources = new Set(
      eligibleResources(
        party,
        state.resources,
        state.config.assignmentPreference,
      ).map((r) => r.id),
    )
    const successor = state.parties.find(
      (p) =>
        p.sequence > entry.sequence &&
        eligibleResources(
          p,
          state.resources,
          state.config!.assignmentPreference,
        ).some((r) => resources.has(r.id)),
    )
    if (!successor)
      throw new HTTPException(409, { message: 'no_compatible_successor' })
    statements.push(
      env.DB.prepare(
        'UPDATE queue_entry SET sequence=(SELECT MAX(sequence)+1 FROM queue_entry WHERE queue_id=?) WHERE id=?',
      ).bind(queueId, entry.id),
      env.DB.prepare(
        'UPDATE queue_entry SET sequence=?,version=version+1 WHERE id=?',
      ).bind(entry.sequence, successor.id),
      env.DB.prepare(
        'UPDATE queue_entry SET sequence=?,version=version+1,call_cycle=call_cycle+1 WHERE id=?',
      ).bind(successor.sequence, entry.id),
      env.DB.prepare(
        "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'yield_received',?)",
      ).bind(crypto.randomUUID(), successor.id, now),
    )
    metadata = {
      successorId: successor.id,
      fromSequence: entry.sequence,
      toSequence: successor.sequence,
      outcome: 'yielded_waiting',
    }
  }
  const eventId = crypto.randomUUID()
  statements.push(
    env.DB.prepare(
      'INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,?,?)',
    ).bind(eventId, entry.id, `customer_${input.action}`, now),
    env.DB.prepare('INSERT INTO customer_event_detail VALUES (?,?)').bind(
      eventId,
      JSON.stringify(metadata),
    ),
    env.DB.prepare('INSERT INTO customer_command VALUES (?,?,?,?,?)').bind(
      entry.id,
      key,
      fingerprint,
      JSON.stringify({ ok: true }),
      now,
    ),
  )
  if (origin) {
    if (origin.replyWithinServiceWindow)
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind,payload_version,payload_snapshot) VALUES (?,?,?,'pending',?,'action_result',0,?)",
        ).bind(
          crypto.randomUUID(),
          entry.id,
          `wa-action-result:${origin.notificationId}:${origin.action}`,
          now,
          JSON.stringify({
            schemaVersion: 1,
            copyVersion: 4,
            action: origin.action,
            textBody: renderWhatsAppActionResult(
              entry.locale,
              origin.action,
              String(metadata.outcome ?? 'yielded_waiting'),
            ),
            webhookEventId: origin.webhookEventId,
            providerContextId: origin.providerContextId,
            occurredAt: origin.occurredAt,
          }),
        ),
      )
    statements.push(
      env.DB.prepare(
        'UPDATE webhook_event SET processed_at=? WHERE id=? AND processed_at IS NULL',
      ).bind(now, origin.webhookEventId),
    )
  }
  await env.DB.batch(statements)
  await recalculateQueue(env, queueId, now)
  if (notifyCancellation) await publishNotice(env, entry.id, 'cancelled')
  if (notifyReadyEntryId) await publishNotice(env, notifyReadyEntryId, 'ready')
  if (origin?.replyWithinServiceWindow)
    await publishNotice(env, entry.id, 'action_result')
  return { ok: true }
}

export async function runWhatsAppAction(
  env: CloudflareBindings,
  queueId: string,
  webhookEventId: string,
  now = Date.now(),
) {
  const event = await env.DB.prepare(
    'SELECT kind,phone_hash,occurred_at,confirmation_payload,context_id,processed_at FROM webhook_event WHERE id=?',
  )
    .bind(webhookEventId)
    .first<{
      kind: string
      phone_hash: string | null
      occurred_at: number
      confirmation_payload: string | null
      context_id: string | null
      processed_at: number | null
    }>()
  if (!event || event.processed_at !== null || event.kind !== 'action') return
  const action = parseWhatsAppAction(event.confirmation_payload ?? '')
  if (!action || !event.context_id || !event.phone_hash) {
    await env.DB.prepare(
      'UPDATE webhook_event SET processed_at=? WHERE id=? AND processed_at IS NULL',
    )
      .bind(now, webhookEventId)
      .run()
    return
  }
  const notice = await env.DB.prepare(
    `SELECT n.id,n.entry_id,n.kind,n.status,n.provider_id,n.accepted_at,n.call_cycle,n.payload_snapshot,
      e.queue_id,e.locale,e.status AS entry_status,e.version,e.call_cycle AS entry_call_cycle,
      c.phone_hash
     FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id
     JOIN queue_entry_contact c ON c.entry_id=e.id
     WHERE n.provider_id=? AND n.kind IN ('approaching','improved','ready') AND e.queue_id=?`,
  )
    .bind(event.context_id, queueId)
    .first<{
      id: string
      entry_id: string
      kind: string
      status: string
      provider_id: string | null
      accepted_at: number | null
      call_cycle: number
      payload_snapshot: string | null
      queue_id: string
      locale: 'es' | 'en'
      entry_status: string
      version: number
      entry_call_cycle: number
      phone_hash: string
    }>()
  // A missing context may be a button reply received before provider acceptance is stored.
  if (!notice) return
  let snapshot: QueueNoticeSnapshot | null = null
  try {
    snapshot = notice.payload_snapshot
      ? (JSON.parse(notice.payload_snapshot) as QueueNoticeSnapshot)
      : null
  } catch {
    // Malformed immutable snapshots fail closed.
  }
  const context = snapshot?.actionContext
  const copyVariant = snapshot?.copyVariant ?? ''
  const validVariant =
    copyVariant === 'approaching' ||
    copyVariant === 'improved_wait_recommended' ||
    copyVariant === 'improved_wait_neutral' ||
    copyVariant === 'ready' ||
    copyVariant === 'improved_ready'
  const authenticated =
    snapshot?.copyVersion === 4 &&
    validVariant &&
    !!context &&
    notice.provider_id === event.context_id &&
    event.phone_hash === notice.phone_hash &&
    context.callCycle === notice.call_cycle &&
    notice.accepted_at !== null &&
    ['accepted', 'sent', 'delivered', 'read'].includes(notice.status) &&
    ((context.phase === 'waiting' &&
      ['approaching', 'improved_wait_recommended', 'improved_wait_neutral'].includes(
        copyVariant,
      )) ||
      (context.phase === 'called' &&
        ['ready', 'improved_ready'].includes(copyVariant)))
  if (!authenticated || !context) {
    await env.DB.prepare(
      'UPDATE webhook_event SET processed_at=? WHERE id=? AND processed_at IS NULL',
    )
      .bind(now, webhookEventId)
      .run()
    return
  }
  const expected = await signWhatsAppAction(env.RECOVERY_TOKEN_KEY, {
    notificationId: notice.id,
    entryId: notice.entry_id,
    action,
    ...context,
  })
  if (!(await secureEqual(event.confirmation_payload ?? '', expected))) {
    await env.DB.prepare(
      'UPDATE webhook_event SET processed_at=? WHERE id=? AND processed_at IS NULL',
    )
      .bind(now, webhookEventId)
      .run()
    return
  }
  const origin: TrustedWhatsAppAction = {
    notificationId: notice.id,
    entryId: notice.entry_id,
    webhookEventId,
    providerContextId: event.context_id,
    phoneHash: event.phone_hash,
    occurredAt: event.occurred_at,
    action,
    ...context,
    replyWithinServiceWindow:
      event.occurred_at <= now + 1_000 &&
      event.occurred_at > now - 86_400_000,
  }
  try {
    await runCustomerCommand(
      env,
      queueId,
      '',
      `wa-action:${notice.id}:${action}`,
      { action, version: notice.version },
      now,
      origin,
    )
  } catch (error) {
    const committed = await env.DB.prepare(
      'SELECT 1 FROM customer_command WHERE entry_id=? AND request_key=?',
    )
      .bind(notice.entry_id, `wa-action:${notice.id}:${action}`)
      .first()
    if (committed) return
    if (!(error instanceof HTTPException)) throw error
    const code = error.message
    const statements: D1PreparedStatement[] = []
    if (origin.replyWithinServiceWindow)
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind,payload_version,payload_snapshot) VALUES (?,?,?,'pending',?,'action_result',0,?)",
        ).bind(
          crypto.randomUUID(),
          notice.entry_id,
          `wa-action-error:${webhookEventId}`,
          now,
          JSON.stringify({
            schemaVersion: 1,
            copyVersion: 4,
            action: origin.action,
            textBody: renderWhatsAppActionError(notice.locale, code),
            webhookEventId,
            providerContextId: event.context_id,
            occurredAt: event.occurred_at,
          }),
        ),
      )
    statements.push(
      env.DB.prepare(
        'UPDATE webhook_event SET processed_at=? WHERE id=? AND processed_at IS NULL',
      ).bind(now, webhookEventId),
    )
    await env.DB.batch(statements)
    if (origin.replyWithinServiceWindow)
      await publishNotice(env, notice.entry_id, 'action_result')
  }
}
