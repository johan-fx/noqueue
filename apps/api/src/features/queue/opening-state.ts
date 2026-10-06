import { directoryConfigStatement } from '../discovery/configuration'
import {
  serviceSchema,
  type ServiceInput,
  type QueueReadiness,
} from '@noqueue/contracts/staff'

export function resourceGroups(config: ServiceInput) {
  if (config.type === 'reception')
    return [
      {
        spaceId: 'reception',
        spaceName: 'Recepción',
        seats: 100,
        count: config.stations ?? 1,
      },
    ]
  return config.spaces.flatMap((space) =>
    (space.tableTypes ?? []).map((group) => ({
      spaceId: space.id!,
      spaceName: space.name,
      seats: group.seats,
      count: group.count,
    })),
  )
}
export function topology(config: ServiceInput) {
  return JSON.stringify([
    config.type,
    config.stations ?? 1,
    config.spaces
      .map((space) => [
        space.id,
        space.tables,
        [...(space.tableTypes ?? [])]
          .sort((a, b) => a.seats - b.seats)
          .map((g) => [g.seats, g.count]),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ])
}
export function configurationComplete(config: ServiceInput) {
  return (
    config.type === 'reception' ||
    (config.spaces.length > 0 &&
      config.spaces.every((s) => !!s.id && !!s.tableTypes?.length))
  )
}
/** Unknown legacy capacity is not the same as invalidated previously managed capacity. */
export async function inventorySafety(
  env: CloudflareBindings,
  queueId: string,
  config: ServiceInput | null,
) {
  const evidence = await env.DB.prepare(
    `SELECT
    EXISTS(SELECT 1 FROM queue_opening WHERE queue_id=? AND complete=1)
    OR EXISTS(SELECT 1 FROM queue_inventory_audit WHERE queue_id=? AND action IN ('inventory_confirmed','inventory_invalidated','activated'))
    OR EXISTS(SELECT 1 FROM queue_external_occupancy WHERE queue_id=?)
    OR EXISTS(SELECT 1 FROM queue_allocation WHERE queue_id=? AND released_at IS NULL) AS managed`,
  )
    .bind(queueId, queueId, queueId, queueId)
    .first<{ managed: number }>()
  const managed =
    !!config?.resourceStateKnown ||
    config?.estimationMode === 'active' ||
    !!evidence?.managed
  return { managed, requiresSurvey: managed && !config?.resourceStateKnown }
}

export async function readiness(
  env: CloudflareBindings,
  queueId: string,
  config: ServiceInput,
): Promise<QueueReadiness> {
  const row = await env.DB.prepare(
    `SELECT q.open,
    (SELECT topology FROM queue_opening WHERE queue_id=q.id AND complete=1) AS topology,
    (SELECT COUNT(*) FROM queue_entry e WHERE e.queue_id=q.id AND e.status IN ('called','completed') AND NOT EXISTS (SELECT 1 FROM queue_allocation a WHERE a.entry_id=e.id AND a.released_at IS NULL)) AS untracked
    FROM queue q WHERE q.id=?`,
  )
    .bind(queueId)
    .first<{
      open: number
      topology: string | null
      untracked: number
    }>()
  const safety = await inventorySafety(env, queueId, config)
  const reasons: QueueReadiness['reasons'] = []
  if (safety.requiresSurvey) reasons.push('inventory_refresh_required')
  if (!configurationComplete(config)) reasons.push('configuration_missing')
  if (!row?.open || row.topology !== topology(config))
    reasons.push('inventory_required')
  if (row?.untracked) reasons.push('legacy_occupancy')
  return {
    state:
      config.intelligencePolicy === 'disabled'
        ? 'disabled'
        : config.estimationMode === 'active'
        ? 'active'
        : 'pending',
    reasons,
  }
}
/** Only valid confirmed inventory grants automatic activation; unknown live occupancy is never inferred. */
export async function activateIfReady(
  env: CloudflareBindings,
  queueId: string,
) {
  const row = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
    .bind(queueId)
    .first<{ config: string | null }>()
  if (!row?.config) return
  const parsed = serviceSchema.safeParse(JSON.parse(row.config))
  if (
    !parsed.success ||
    parsed.data.intelligencePolicy === 'disabled' ||
    parsed.data.estimationMode === 'active'
  )
    return
  const status = await readiness(env, queueId, parsed.data)
  if (status.reasons.length) return
  const source = JSON.stringify({
    ...parsed.data,
    estimationMode: 'active',
    resourceStateKnown: true,
  })
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE queue SET config=?,version=version+1 WHERE id=?',
    ).bind(source, queueId),
    directoryConfigStatement(env, queueId, source),
    env.DB.prepare(
      'INSERT INTO queue_inventory_audit VALUES (?,?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      queueId,
      'system',
      'activated',
      '{}',
      Date.now(),
    ),
  ])
}

/** Confirmation belongs to the current topology, independently of the admissions switch. */
export async function inventoryConfirmed(
  env: CloudflareBindings,
  queueId: string,
  config: ServiceInput,
) {
  const record = await env.DB.prepare(
    'SELECT topology FROM queue_opening WHERE queue_id=? AND complete=1',
  )
    .bind(queueId)
    .first<{ topology: string }>()
  return (
    !!config.resourceStateKnown &&
    configurationComplete(config) &&
    record?.topology === topology(config)
  )
}
