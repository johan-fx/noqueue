import type { QueueAutomationAttention, ServiceInput } from '@noqueue/contracts/staff'
import { feedbackEntry } from './feedback'

/** Run under the queue coordinator, after the operational writes in its batch.
 * A cleared queue/window must never revive an old incident on a later join. */
export function clearObsoleteAutomationAttention(env: CloudflareBindings, queueId: string, now: number) {
  return env.DB.prepare(`UPDATE queue_automation_attention SET resolved_at=?,
    resolution=CASE WHEN EXISTS(SELECT 1 FROM queue_automation_cycle c WHERE c.id=cycle_id AND c.service_ends_at<=?)
      THEN 'service_ended' ELSE 'empty' END
    WHERE queue_id=? AND resolved_at IS NULL AND (
      EXISTS(SELECT 1 FROM queue_automation_cycle c WHERE c.id=cycle_id AND c.service_ends_at<=?)
      OR NOT EXISTS(SELECT 1 FROM queue_entry e WHERE e.queue_id=? AND e.status='waiting'
        AND e.manual_only=0 AND (e.service_ends_at IS NULL OR e.service_ends_at>?)))`)
    .bind(now, now, queueId, now, queueId, now)
}

export function createAutomationAttention(env: CloudflareBindings, queueId: string, cycleId: string, entryId: string, now: number) {
  return env.DB.prepare(`INSERT OR IGNORE INTO queue_automation_attention(cycle_id,queue_id,entry_id,created_at)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM queue_entry WHERE queue_id=? AND status='waiting'
      AND manual_only=0 AND (service_ends_at IS NULL OR service_ends_at>?))`)
    .bind(cycleId, queueId, entryId, now, queueId, now)
}

export async function readAutomationAttention(env: CloudflareBindings, queueId: string, config: ServiceInput | null, now: number): Promise<QueueAutomationAttention[]> {
  const rows = await env.DB.prepare(`SELECT a.cycle_id,a.entry_id,a.created_at,c.capacity,c.space_id
    FROM queue_automation_attention a JOIN queue_automation_cycle c ON c.id=a.cycle_id AND c.queue_id=a.queue_id
    WHERE a.queue_id=? AND a.resolved_at IS NULL
      AND (c.service_ends_at IS NULL OR c.service_ends_at>?)
      AND EXISTS(SELECT 1 FROM queue_entry e WHERE e.queue_id=a.queue_id AND e.status='waiting'
        AND e.manual_only=0 AND (e.service_ends_at IS NULL OR e.service_ends_at>?))
    ORDER BY a.created_at,a.cycle_id`).bind(queueId, now, now)
    .all<{cycle_id: string; entry_id: string; created_at: number; capacity: number; space_id: string}>()
  return Promise.all(rows.results.map(async row => ({
    id: row.cycle_id, createdAt: row.created_at, entry: await feedbackEntry(env, row.entry_id),
    capacity: row.capacity, spaceId: row.space_id,
    spaceName: config?.spaces?.find(space => space.id === row.space_id)?.name ?? 'Espacio no disponible',
  })))
}
