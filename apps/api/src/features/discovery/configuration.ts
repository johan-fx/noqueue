import { serviceSchema } from '@noqueue/contracts/staff'
import { normalizeConfig } from '../queue/projection'

function normalizedSnapshot(source: string): string | null {
  try {
    const parsed = serviceSchema.safeParse(JSON.parse(source))
    if (!parsed.success) return null
    return JSON.stringify(serviceSchema.parse(normalizeConfig(parsed.data)))
  } catch {
    return null
  }
}

/** Add after a config mutation in the same batch; never attest bytes read before a concurrent write. */
export function directoryConfigStatement(
  env: CloudflareBindings,
  queueId: string,
  source: string,
  auditId: string | null = null,
) {
  return env.DB.prepare(
    `
    INSERT INTO service_directory_config(queue_id,source_config,normalized_config)
    SELECT id,?,? FROM queue WHERE id=? AND config=?
      AND (? IS NULL OR EXISTS(SELECT 1 FROM staff_audit WHERE id=?))
    ON CONFLICT(queue_id) DO UPDATE SET source_config=excluded.source_config,normalized_config=excluded.normalized_config
  `,
  ).bind(source, normalizedSnapshot(source), queueId, source, auditId, auditId)
}

/** Location confirmation upgrades existing services in its location/version/audit transaction. */
export async function venueDirectoryStatements(
  env: CloudflareBindings,
  venueId: string,
  auditId: string,
) {
  const queues = await env.DB.prepare(
    'SELECT id,config FROM queue WHERE venue_id=? AND config IS NOT NULL',
  )
    .bind(venueId)
    .all<{ id: string; config: string }>()
  return queues.results.map((row) =>
    directoryConfigStatement(env, row.id, row.config, auditId),
  )
}

/** Migration compatibility: bounded, deterministic work outside public requests; invalid markers prevent starvation. */
export async function backfillDirectoryConfigs(
  env: CloudflareBindings,
  limit = 50,
) {
  const queues = await env.DB.prepare(
    `
    SELECT q.id,q.config FROM queue q JOIN venue v ON v.id=q.venue_id
    LEFT JOIN service_directory_config d ON d.queue_id=q.id AND d.source_config=q.config
    WHERE v.location_confirmed_at IS NOT NULL AND q.config IS NOT NULL AND d.queue_id IS NULL
    ORDER BY q.id LIMIT ?
  `,
  )
    .bind(limit)
    .all<{ id: string; config: string }>()
  if (queues.results.length)
    await env.DB.batch(
      queues.results.map((row) =>
        directoryConfigStatement(env, row.id, row.config),
      ),
    )
  return queues.results.length
}
