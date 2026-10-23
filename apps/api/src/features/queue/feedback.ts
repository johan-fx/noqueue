import type { QueueAutomationEvent, QueueFeedbackEntry } from '@noqueue/contracts/staff'
import { decryptDisplayName } from './crypto'

/** Callers must already hold queue.read or queue.operate for this entry's queue. */
export async function feedbackEntry(env: CloudflareBindings, id: string): Promise<QueueFeedbackEntry> {
  const row = await env.DB.prepare('SELECT id,code,display_name_cipher FROM queue_entry WHERE id=?')
    .bind(id).first<{ id: string; code: string; display_name_cipher: string | null }>()
  if (!row) throw new Error('feedback_entry_missing')
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name_cipher ? await decryptDisplayName(env.PII_ENCRYPTION_KEY, row.display_name_cipher) : null,
  }
}

/** A missing cursor is a baseline read, never a request to replay old activity. */
export async function readQueueFeedback(env: CloudflareBindings, queueId: string, after?: number) {
  const latest = await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS cursor FROM queue_staff_event WHERE queue_id=?')
    .bind(queueId).first<{ cursor: number }>()
  const highWater = latest?.cursor ?? 0
  if (after === undefined || after > highWater)
    return { cursor: highWater, events: [] as QueueAutomationEvent[], hasMore: false }
  const rows = await env.DB.prepare(`SELECT f.id,f.entry_id,f.successor_entry_id,f.cycle_id,f.cause,f.created_at,
      e.code AS entry_code,e.display_name_cipher AS entry_name,
      s.code AS successor_code,s.display_name_cipher AS successor_name
    FROM queue_staff_event f
    JOIN queue_entry e ON e.id=f.entry_id AND e.queue_id=f.queue_id
    JOIN queue_entry s ON s.id=f.successor_entry_id AND s.queue_id=f.queue_id
    WHERE f.queue_id=? AND f.id>? AND f.id<=? ORDER BY f.id LIMIT 101`)
    .bind(queueId, after, highWater).all<{
      id: number; entry_id: string; successor_entry_id: string; cycle_id: string;
      cause: QueueAutomationEvent['cause']; created_at: number;
      entry_code: string; entry_name: string | null; successor_code: string; successor_name: string | null;
    }>()
  const page = rows.results.slice(0, 100)
  const events = await Promise.all(page.map(async row => ({
    id: row.id, cause: row.cause, cycleId: row.cycle_id, createdAt: row.created_at,
    entry: { id: row.entry_id, code: row.entry_code,
      displayName: row.entry_name ? await decryptDisplayName(env.PII_ENCRYPTION_KEY, row.entry_name) : null },
    successor: { id: row.successor_entry_id, code: row.successor_code,
      displayName: row.successor_name ? await decryptDisplayName(env.PII_ENCRYPTION_KEY, row.successor_name) : null },
  })))
  const hasMore = rows.results.length > 100
  return { cursor: hasMore ? page[page.length - 1]!.id : highWater, events, hasMore }
}
