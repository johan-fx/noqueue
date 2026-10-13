import { loadQueueState, commitQueueTransition } from './projection'
import { directoryConfigStatement } from '../discovery/configuration'
import {
  storedServiceSchema as serviceSchema,
  type ServiceInput,
  type QueueReadiness,
} from '@noqueue/contracts/staff'

export function resourceGroups(config: ServiceInput) {
  if (config.type !== 'restaurant')
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
export function configurationComplete(_config: ServiceInput) {
  return true
}
/** Retained solely for old readers; inventory never gates queue operation. */
export async function inventorySafety(
  _env: CloudflareBindings,
  _queueId: string,
  _config: ServiceInput | null,
) {
  return { managed: false, requiresSurvey: false }
}
export async function readiness(
  _env: CloudflareBindings,
  _queueId: string,
  config: ServiceInput,
): Promise<QueueReadiness> {
  return {
    state: config.intelligencePolicy === 'disabled' ? 'disabled' : 'active',
    reasons: [],
  }
}
/** Configuration suffices for activation; physical occupancy is irrelevant. */
export async function activateIfReady(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
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
  })
  const before = await loadQueueState(env, queueId, now)
  await commitQueueTransition(
    env,
    queueId,
    before,
    {
      config: {
        ...parsed.data,
        estimationMode: 'active',
      },
      allocations: before.allocations,
      parties: before.parties,
      holds: before.holds,
    },
    [
      env.DB.prepare(
        'UPDATE queue SET config=?,version=version+1 WHERE id=?',
      ).bind(source, queueId),
      directoryConfigStatement(env, queueId, source),
    ],
    now,
  )
}

/** Compatibility field: no confirmation is required in the queue-only model. */
export async function inventoryConfirmed(
  _env: CloudflareBindings,
  _queueId: string,
  _config: ServiceInput,
) {
  return false
}
