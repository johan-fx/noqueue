import {
  storedServiceSchema,
  type QueueConfigurationContext,
} from '@noqueue/contracts/staff'
import { queueAccess } from '../../auth/access'
import { normalizeConfig, recalculateQueue } from '../queue/projection'

/** Called inside the coordinator: initialization must precede the edit baseline. */
export async function configurationContext(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
): Promise<QueueConfigurationContext> {
  await queueAccess(env, actor, queueId, 'queue.configure')
  // Unlike polling, opening an editor cannot coalesce against a fresh projection:
  // automatic configuration activation must have completed before we read version.
  await recalculateQueue(env, queueId)
  const row = await env.DB.prepare(
    'SELECT id,version,open,config FROM queue WHERE id=?',
  )
    .bind(queueId)
    .first<{ id: string; version: number; open: number; config: string }>()
  return {
    ...row!,
    config: normalizeConfig(storedServiceSchema.parse(JSON.parse(row!.config))),
  }
}

