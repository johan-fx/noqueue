/** Live delivery requires all staging gates; sandbox remains simulation-only. */
export function confirmationExperimentEnabled(env: CloudflareBindings) {
  return (
    env.CONFIRMATION_EXPERIMENT_ENABLED === 'true' &&
    (env.APP_ENV === 'local' || liveConfirmationEnabled(env))
  )
}

export async function readConfirmation(
  env: CloudflareBindings,
  entryId: string,
) {
  const row = await env.DB.prepare(
    'SELECT confirmed_at,revoked_at,expires_at FROM queue_confirmation WHERE entry_id=?',
  )
    .bind(entryId)
    .first<{
      confirmed_at: number | null
      revoked_at: number | null
      expires_at: number
    }>()
  if (!row) return {}
  const confirmation =
    row.revoked_at !== null
      ? 'revoked'
      : row.confirmed_at !== null
      ? 'confirmed'
      : row.expires_at <= Date.now()
      ? 'expired'
      : 'pending'
  return { confirmation }
}

export async function confirmEntry(env: CloudflareBindings, eventId: string) {
  if (!confirmationExperimentEnabled(env)) return
  const now = Date.now()
  const awaitingReceipt = await env.DB.prepare(
    `SELECT 1 FROM webhook_event w
    JOIN queue_entry_contact p ON p.phone_hash=w.phone_hash
    JOIN queue_confirmation f ON f.entry_id=p.entry_id
    JOIN notification_outbox n ON n.entry_id=f.entry_id
    WHERE w.id=? AND w.confirmation_entry_id=f.entry_id AND f.confirmed_at IS NULL AND f.revoked_at IS NULL AND f.expires_at>?
      AND w.occurred_at+999>=f.contact_authorized_at
      AND n.provider_id IS NULL AND n.status IN ('sending','unknown')
      AND (w.confirmation_payload IS NULL OR w.confirmation_payload=f.payload) LIMIT 1`,
  )
    .bind(eventId, now)
    .first()
  if (awaitingReceipt) return
  // Select and activate in the same SQL statement: two pending entries never race into an
  // ambiguous text confirmation. A persisted STOP wins even before its queue job runs.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE queue_confirmation SET confirmed_at=? WHERE entry_id=(
      SELECT CASE WHEN COUNT(*)=1 THEN MIN(f.entry_id) ELSE NULL END
      FROM queue_confirmation f
      JOIN queue_entry_contact p ON p.entry_id=f.entry_id
      JOIN notification_outbox n ON n.entry_id=f.entry_id AND n.kind='confirmation'
      JOIN consent c ON c.entry_id=f.entry_id
      JOIN webhook_event w ON w.id=? AND w.kind='confirmation' AND w.processed_at IS NULL
      WHERE f.entry_id=w.confirmation_entry_id AND p.phone_hash=w.phone_hash AND f.confirmed_at IS NULL AND f.revoked_at IS NULL
        AND c.revoked_at IS NULL AND c.purpose='confirmation_contact'
        AND f.expires_at>? AND w.occurred_at<f.expires_at
        AND w.occurred_at+999>=f.contact_authorized_at AND w.occurred_at<=?
        AND n.provider_id IS NOT NULL AND n.status IN ('accepted','sent','delivered','read')
        AND (w.confirmation_payload IS NOT NULL OR (SELECT COUNT(*) FROM queue_confirmation other
          JOIN queue_entry_contact op ON op.entry_id=other.entry_id
          WHERE op.phone_hash=p.phone_hash AND other.confirmed_at IS NULL AND other.revoked_at IS NULL
            AND other.expires_at>?)=1)
        AND ((w.confirmation_payload IS NULL AND w.context_id IS NULL)
          OR (w.confirmation_payload=f.payload AND w.context_id=n.provider_id)
          OR (w.confirmation_payload IS NULL AND w.context_id=n.provider_id))
        AND NOT EXISTS(SELECT 1 FROM webhook_event stop WHERE stop.kind='opt_out'
          AND stop.phone_hash=p.phone_hash AND stop.occurred_at+999>=f.contact_authorized_at)
    )`,
    ).bind(now, eventId, now, now + 1000, now),
    env.DB.prepare(
      `UPDATE consent SET purpose='queue_updates',granted_at=(SELECT confirmed_at FROM queue_confirmation WHERE entry_id=consent.entry_id)
      WHERE purpose='confirmation_contact' AND revoked_at IS NULL AND entry_id IN
      (SELECT entry_id FROM queue_confirmation WHERE confirmed_at IS NOT NULL AND revoked_at IS NULL)`,
    ).bind(),
    env.DB.prepare('UPDATE webhook_event SET processed_at=? WHERE id=?').bind(
      now,
      eventId,
    ),
  ])
}

export function liveConfirmationEnabled(env: CloudflareBindings) {
  return (
    env.APP_ENV === 'staging' &&
    env.WHATSAPP_MODE === 'cloud' &&
    env.CONFIRMATION_EXPERIMENT_ENABLED === 'true' &&
    env.WHATSAPP_ENABLED === 'true' &&
    env.STAGING_EXPERIMENT_APPROVED === 'true'
  )
}
