import { activateIfReady, inventorySafety } from './opening-state'
import { serviceSchema, type ServiceInput } from '@noqueue/contracts/staff'
import { groupMinutes, projectQueue, type Resource } from './engine'

export function normalizeConfig(
  config: ServiceInput,
  previous?: ServiceInput | null,
): ServiceInput {
  const used = new Set(
    config.spaces.flatMap((space) => (space.id ? [space.id] : [])),
  )
  const spaces = config.spaces.map((space, index) => {
    const matches =
      previous?.spaces.filter(
        (old) => old.name === space.name && !used.has(old.id!),
      ) ?? []
    const id =
      space.id ??
      (matches.length === 1
        ? matches[0]!.id!
        : previous
        ? crypto.randomUUID()
        : `legacy-${index}`)
    used.add(id)
    const old = previous?.spaces.find((s) => s.id === id)
    return {
      ...space,
      id,
      tableTypes: space.tableTypes?.map((type) => ({
        ...type,
        averageMinutes:
          type.averageMinutes ??
          old?.tableTypes?.find((t) => t.seats === type.seats)
            ?.averageMinutes ??
          config.queueBySeat?.find((row) => row.seats === type.seats)
            ?.averageMinutes ??
          config.averageMinutes,
      })),
    }
  })
  return {
    ...config,
    spaces,
    assignmentPreference:
      spaces.find((s) => s.name === config.assignmentPreference)?.id ??
      config.assignmentPreference,
  }
}
export type Allocation = {
  entry_id: string
  resource_id: string
  space_id: string
  seats: number
  reserved_at: number
  arrived_at: number | null
  released_at: number | null
  outcome: string | null
}
export async function loadQueueState(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  const queue = await env.DB.prepare(
    'SELECT config,average_minutes FROM queue WHERE id=?',
  )
    .bind(queueId)
    .first<{ config: string | null; average_minutes: number }>()
  if (!queue) throw new Error('Queue missing')
  const parsed = serviceSchema.safeParse(
    queue.config ? JSON.parse(queue.config) : null,
  )
  const config = parsed.success ? normalizeConfig(parsed.data) : null
  const allocations = (
    await env.DB.prepare(
      'SELECT * FROM queue_allocation WHERE queue_id=? ORDER BY released_at',
    )
      .bind(queueId)
      .all<Allocation>()
  ).results
  const holds = (
    await env.DB.prepare(
      'SELECT resource_id,space_id,seats FROM queue_external_occupancy WHERE queue_id=?',
    )
      .bind(queueId)
      .all<{ resource_id: string; space_id: string; seats: number }>()
  ).results
  const parties = (
    await env.DB.prepare(
      "SELECT id,sequence,party_size AS partySize,preferred_space_id AS preferredSpaceId FROM queue_entry WHERE queue_id=? AND status='waiting' ORDER BY sequence",
    )
      .bind(queueId)
      .all<{
        id: string
        sequence: number
        partySize: number
        preferredSpaceId: string | null
      }>()
  ).results
  const resources: Resource[] = []
  const spaces =
    config?.type === 'reception'
      ? [
          {
            id: 'reception',
            name: 'Reception',
            tables: config.stations ?? 1,
            tableTypes: [
              {
                seats: 100,
                count: config.stations ?? 1,
                averageMinutes: config.averageMinutes,
              },
            ],
          },
        ]
      : config?.spaces ?? []
  for (const space of spaces)
    for (const type of space.tableTypes?.length
      ? space.tableTypes
      : [
          {
            seats: 100,
            count: space.tables,
            averageMinutes: config!.averageMinutes,
          },
        ]) {
      const observations = allocations
        .filter(
          (a) =>
            a.space_id === space.id &&
            a.seats === type.seats &&
            a.outcome === 'served' &&
            a.arrived_at !== null &&
            a.released_at !== null,
        )
        .map((a) => (a.released_at! - a.arrived_at!) / 60000)
      const adjustment = config?.adjustments
        ?.filter((a) => a.kind !== 'availability')
        .find(
          (a) =>
            a.spaceId === space.id &&
            a.seats === type.seats &&
            a.expiresAt > now,
        )
      const averageMinutes = groupMinutes(
        type.averageMinutes ?? config!.averageMinutes,
        observations,
        adjustment,
        now,
      )
      const blockedUntil = Math.max(
        0,
        ...(config?.adjustments ?? [])
          .filter(
            (a) =>
              a.kind === 'availability' &&
              a.spaceId === space.id &&
              a.seats === type.seats &&
              a.expiresAt > now,
          )
          .map((a) => a.expiresAt),
      )
      for (let i = 0; i < type.count; i++) {
        const id = `${space.id}:${type.seats}:${i}`
        const occupied = allocations.find(
          (a) => a.resource_id === id && a.released_at === null,
        )
        const external = holds.some((h) => h.resource_id === id)
        const expected = occupied?.arrived_at
          ? occupied.arrived_at + averageMinutes * 60000
          : null
        const availableAt = external
          ? null
          : occupied
          ? expected !== null && expected > now
            ? Math.max(expected, blockedUntil)
            : null
          : config?.resourceStateKnown
          ? Math.max(now, blockedUntil)
          : null
        resources.push({
          id,
          spaceId: space.id!,
          seats: type.seats,
          averageMinutes,
          known:
            !external &&
            !!config?.resourceStateKnown &&
            !!space.tableTypes?.length,
          availableAt,
          callable:
            !!config?.resourceStateKnown &&
            !occupied &&
            !external &&
            blockedUntil <= now,
        })
      }
    }
  const calls = (
    await env.DB.prepare(
      "SELECT created_at FROM queue_event WHERE entry_id IN (SELECT id FROM queue_entry WHERE queue_id=?) AND kind='called' ORDER BY created_at DESC LIMIT 11",
    )
      .bind(queueId)
      .all<{ created_at: number }>()
  ).results
  const progress =
    calls.length >= 3
      ? (calls[0]!.created_at - calls[calls.length - 1]!.created_at) /
        (calls.length - 1) /
        60000
      : undefined
  const projections = projectQueue(
    parties,
    resources,
    now,
    config?.assignmentPreference,
    progress && progress > 0
      ? { lastCallAt: calls[0]!.created_at, cadenceMinutes: progress }
      : undefined,
  )
  return {
    config,
    inventorySafety: await inventorySafety(env, queueId, config),
    allocations,
    holds,
    parties,
    resources,
    projections,
    baseline: queue.average_minutes,
  }
}
export async function recalculateQueue(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
) {
  await activateIfReady(env, queueId)
  const state = await loadQueueState(env, queueId, now)
  const statements: D1PreparedStatement[] = []
  for (const p of state.projections) {
    const prior = await env.DB.prepare(
      'SELECT position,predicted_at,quality,resource_id,callable,revision FROM queue_projection WHERE entry_id=?',
    )
      .bind(p.id)
      .first<{
        position: number
        predicted_at: number | null
        quality: string
        resource_id: string | null
        callable: number
        revision: number
      }>()
    // Minute buckets avoid a new intent on every poll while retaining real changes.
    const changed =
      !prior ||
      prior.position !== p.position ||
      prior.quality !== p.quality ||
      prior.resource_id !== p.resourceId ||
      !!prior.callable !== p.callable ||
      Math.floor((prior.predicted_at ?? 0) / 60000) !==
        Math.floor((p.predictedAt ?? 0) / 60000)
    const revision = (prior?.revision ?? 0) + Number(changed)
    statements.push(
      env.DB.prepare(
        'INSERT INTO queue_projection(entry_id,position,eta_minutes,predicted_at,quality,resource_id,callable,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET position=excluded.position,eta_minutes=excluded.eta_minutes,predicted_at=excluded.predicted_at,quality=excluded.quality,resource_id=excluded.resource_id,callable=excluded.callable,revision=excluded.revision,updated_at=excluded.updated_at',
      ).bind(
        p.id,
        p.position,
        p.etaMinutes,
        p.predictedAt,
        p.quality,
        p.resourceId,
        Number(p.callable),
        revision,
        now,
      ),
    )
    if (p.predictedAt !== null)
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO queue_forecast_anchor(entry_id,predicted_at,created_at,legacy_eta_minutes) VALUES (?,?,?,?)',
        ).bind(
          p.id,
          p.predictedAt,
          now,
          Math.max(0, p.position - 1) * state.baseline,
        ),
      )
    if (changed)
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO queue_estimate_intent(entry_id,revision,payload,created_at) VALUES (?,?,?,?)',
        ).bind(p.id, revision, JSON.stringify(p), now),
      )
  }
  if (statements.length) await env.DB.batch(statements)
  return state
}
export async function readProjection(
  env: CloudflareBindings,
  entryId: string,
) {
  const row = await env.DB.prepare(
    'SELECT position,eta_minutes AS etaMinutes,predicted_at AS predictedAt,quality AS estimateQuality,resource_id AS resourceId,callable FROM queue_projection WHERE entry_id=?',
  )
    .bind(entryId)
    .first<{
      position: number
      etaMinutes: number
      predictedAt: number | null
      estimateQuality: 'estimated' | 'provisional' | 'unknown'
      resourceId: string | null
      callable: number
    }>()
  return row ? { ...row, callable: !!row.callable } : null
}
