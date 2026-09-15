import {
  confirmationExperimentEnabled,
  liveConfirmationEnabled,
} from './confirmation'

export const experimentQueueId = 'confirmation-experiment'
/** Recipient expansion is scoped to the authenticated staging experiment only. */
export function openExperimentRecipientAllowed(
  env: CloudflareBindings,
  queueId: string,
  kind: string,
) {
  return (
    liveConfirmationEnabled(env) &&
    env.STAGING_EXPERIMENT_OPEN_RECIPIENTS === 'true' &&
    queueId === experimentQueueId &&
    (kind === 'confirmation' || kind === 'position_update')
  )
}
export function queueCoordinator(env: CloudflareBindings, queueId: string) {
  const namespace =
    env.APP_ENV === 'local'
      ? env.QUEUE_COORDINATOR
      : env.QUEUE_COORDINATOR.jurisdiction('eu')
  return namespace.getByName(queueId)
}

export async function experimentSnapshot(env: CloudflareBindings) {
  const entries = await env.DB.prepare(
    `SELECT e.code,e.party_size AS partySize,e.status,
    (SELECT COUNT(*) FROM queue_entry p WHERE p.queue_id=e.queue_id AND p.status='waiting' AND p.sequence<=e.sequence) AS position,
    CASE WHEN f.entry_id IS NULL THEN 'placeholder' WHEN f.revoked_at IS NOT NULL THEN 'revoked'
      WHEN f.confirmed_at IS NOT NULL THEN 'confirmed' WHEN f.expires_at<=? THEN 'expired' ELSE 'pending' END AS confirmation,
    (SELECT status FROM notification_outbox n WHERE n.entry_id=e.id ORDER BY rowid DESC LIMIT 1) AS notification
    FROM queue_entry e LEFT JOIN queue_confirmation f ON f.entry_id=e.id
    WHERE e.queue_id=? AND e.status='waiting' ORDER BY e.sequence`,
  )
    .bind(Date.now(), experimentQueueId)
    .all()
  return { entries: entries.results }
}

/** Called only through the queue's serialized Durable Object. D1 batch is the commit boundary. */
export async function changeExperiment(
  env: CloudflareBindings,
  action: 'seed' | 'advance',
  key: string,
) {
  if (!confirmationExperimentEnabled(env))
    return { status: 404, body: { error: 'not_found' } }
  const prior = await env.DB.prepare(
    'SELECT action,result FROM experiment_action WHERE idempotency_key=?',
  )
    .bind(key)
    .first<{ action: string; result: string }>()
  if (prior)
    return prior.action === action
      ? { status: 200, body: JSON.parse(prior.result) as { action: string } }
      : { status: 409, body: { error: 'idempotency_conflict' } }
  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  if (action === 'seed') {
    // Never destroy consent/STOP evidence or reset an unknown provider outcome.
    statements.push(
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE status='pending' AND entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)",
      ).bind(now, experimentQueueId),
    )
    statements.push(
      env.DB.prepare(
        'UPDATE queue_confirmation SET revoked_at=? WHERE revoked_at IS NULL AND entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)',
      ).bind(now, experimentQueueId),
    )
    statements.push(
      env.DB.prepare(
        'UPDATE consent SET revoked_at=? WHERE revoked_at IS NULL AND entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)',
      ).bind(now, experimentQueueId),
    )
    statements.push(
      env.DB.prepare(
        "UPDATE queue_entry SET status='cancelled' WHERE queue_id=? AND status='waiting'",
      ).bind(experimentQueueId),
    )
    const sequence = await env.DB.prepare(
      'SELECT COALESCE(MAX(sequence),0) AS n FROM queue_entry WHERE queue_id=?',
    )
      .bind(experimentQueueId)
      .first<{ n: number }>()
    for (let i = 1; i <= 3; i++) {
      const id = crypto.randomUUID()
      statements.push(
        env.DB.prepare(
          `INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,?,1,'es',?,?)`,
        ).bind(
          id,
          experimentQueueId,
          id,
          'synthetic',
          id,
          `TEST-${id.slice(0, 8)}`,
          now,
          (sequence?.n ?? 0) + i,
        ),
      )
    }
  } else {
    const front = await env.DB.prepare(
      "SELECT id FROM queue_entry WHERE queue_id=? AND status='waiting' ORDER BY sequence LIMIT 1",
    )
      .bind(experimentQueueId)
      .first<{ id: string }>()
    if (!front) return { status: 409, body: { error: 'queue_empty' } }
    statements.push(
      env.DB.prepare(
        "UPDATE queue_entry SET status='served' WHERE id=? AND status='waiting'",
      ).bind(front.id),
    )
    statements.push(
      env.DB.prepare('INSERT INTO queue_event VALUES (?,?,?,?)').bind(
        crypto.randomUUID(),
        front.id,
        'experiment_advanced',
        now,
      ),
    )
    // Coalesce pending snapshots. Sending/unknown messages are never blindly resent.
    statements.push(
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE kind='position_update' AND status='pending' AND entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?)",
      ).bind(now, experimentQueueId),
    )
    statements.push(
      env.DB.prepare(
        `INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind,position)
      SELECT ?,e.id,?,'pending',?,'position_update',
        (SELECT COUNT(*) FROM queue_entry p WHERE p.queue_id=e.queue_id AND p.status='waiting' AND p.sequence<=e.sequence)
      FROM queue_entry e JOIN queue_confirmation f ON f.entry_id=e.id JOIN consent c ON c.entry_id=e.id
      JOIN queue_entry_contact p ON p.entry_id=e.id JOIN whatsapp_contact_state w ON w.phone_hash=p.phone_hash
      WHERE e.queue_id=? AND e.status='waiting' AND f.confirmed_at IS NOT NULL AND f.revoked_at IS NULL
        AND c.purpose='queue_updates' AND c.revoked_at IS NULL AND w.stopped_at IS NULL AND w.last_inbound_at>?
      ORDER BY e.sequence LIMIT 1`,
      ).bind(
        crypto.randomUUID(),
        `advance:${key}`,
        now,
        experimentQueueId,
        now - 86400000,
      ),
    )
  }
  const body = { action }
  statements.push(
    env.DB.prepare('INSERT INTO experiment_action VALUES (?,?,?)').bind(
      key,
      action,
      JSON.stringify(body),
    ),
  )
  await env.DB.batch(statements)
  // The outbox sweep repairs a crash or publication failure after commit.
  const pending = await env.DB.prepare(
    "SELECT id FROM notification_outbox WHERE status='pending' AND idempotency_key=?",
  )
    .bind(`advance:${key}`)
    .first<{ id: string }>()
  if (pending) {
    try {
      await env.NOTIFICATIONS.send({
        kind: 'dispatch-notification',
        notificationId: pending.id,
      })
    } catch {
      console.warn('notification_publish_deferred')
    }
  }
  return { status: 200, body }
}
