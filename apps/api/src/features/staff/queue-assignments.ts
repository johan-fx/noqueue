import { HTTPException } from 'hono/http-exception'

export async function validateQueueIds(
  env: CloudflareBindings,
  venueId: string,
  queueIds: string[],
) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM queue WHERE venue_id=? AND id IN (SELECT value FROM json_each(?))',
  )
    .bind(venueId, JSON.stringify(queueIds))
    .first<{ n: number }>()
  if (row?.n !== queueIds.length)
    throw new HTTPException(400, { message: 'invalid_queue_assignments' })
}

// All writes are gated by the caller's transaction-local audit row. The FKs
// also protect against a queue being removed/moved between validation and write.
export function replaceQueueAssignments(
  env: CloudflareBindings,
  userId: string,
  venueId: string,
  queueIds: string[],
  auditId: string,
) {
  return [
    env.DB.prepare(
      'DELETE FROM staff_queue_assignment WHERE user_id=? AND venue_id=? AND EXISTS (SELECT 1 FROM staff_audit WHERE id=?)',
    ).bind(userId, venueId, auditId),
    env.DB.prepare(
      'INSERT INTO staff_queue_assignment(user_id,venue_id,queue_id) SELECT ?,?,value FROM json_each(?) WHERE EXISTS (SELECT 1 FROM staff_audit WHERE id=?)',
    ).bind(userId, venueId, JSON.stringify(queueIds), auditId),
  ]
}
