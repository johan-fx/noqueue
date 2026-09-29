import { topology } from '../queue/opening-state'
import { eligibleResources } from '../queue/engine'
import {
  loadQueueState,
  normalizeConfig,
  recalculateQueue,
} from '../queue/projection'
import {
  queueCommandSchema,
  queueSettingsSchema,
  type QueueCommand,
} from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'
import { queueAccess, audit } from '../../auth/access'
import { hash } from '../queue/crypto'
export async function runQueueCommand(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  key: string,
  input: QueueCommand,
) {
  const access = await queueAccess(env, actor, queueId, 'queue.operate')
  queueCommandSchema.parse(input)
  const fingerprint = await hash(JSON.stringify({ queueId, input }))
  const previous = await env.DB.prepare(
    'SELECT request_hash,result FROM staff_command WHERE actor_id=? AND request_key=?',
  )
    .bind(actor, key)
    .first<{ request_hash: string; result: string }>()
  if (previous) {
    if (previous.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    await recalculateQueue(env, queueId)
    return JSON.parse(previous.result) as { ok: true }
  }
  const entry = await env.DB.prepare(
    'SELECT status,version,called_at FROM queue_entry WHERE id=? AND queue_id=?',
  )
    .bind(input.entryId, queueId)
    .first<{ status: string; version: number; called_at: number | null }>()
  if (!entry) throw new HTTPException(404, { message: 'not_found' })
  if (entry.version !== input.version)
    throw new HTTPException(409, { message: 'version_conflict' })
  const transitions: Record<string, readonly string[]> = {
    call: ['waiting'],
    complete: ['called'],
    release: ['completed'],
    cancel: ['waiting', 'called'],
    no_show: ['called'],
    skip: ['waiting'],
  }
  if (!transitions[input.action]!.includes(entry.status))
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (input.action === 'no_show') {
    const q = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
      .bind(queueId)
      .first<{ config: string }>()
    const grace = (JSON.parse(q!.config) as { graceMinutes: number })
      .graceMinutes
    if (!entry.called_at || Date.now() < entry.called_at + grace * 60000)
      throw new HTTPException(409, { message: 'arrival_grace_active' })
  }
  const status = {
    call: 'called',
    complete: 'completed',
    release: 'served',
    cancel: 'cancelled',
    no_show: 'no_show',
    skip: 'waiting',
  }[input.action]
  const now = Date.now()
  const state = await recalculateQueue(env, queueId, now)
  const extra: D1PreparedStatement[] = []
  const active = state.config?.estimationMode === 'active'
  const allocation = state.allocations.find(
    (a) => a.entry_id === input.entryId && a.released_at === null,
  )
  if (input.action === 'call') {
    if (state.inventorySafety.requiresSurvey)
      throw new HTTPException(409, { message: 'inventory_refresh_required' })
    const party = state.parties.find((p) => p.id === input.entryId)!
    const compatible = eligibleResources(
      party,
      state.resources,
      state.config?.assignmentPreference,
    )
    const free = compatible
      .filter(
        (r) =>
          r.callable &&
          r.availableAt !== null &&
          r.availableAt <= now &&
          !state.allocations.some(
            (a) => a.resource_id === r.id && a.released_at === null,
          ),
      )
      .sort((a, b) => a.seats - b.seats || a.id.localeCompare(b.id))
    const resource = free[0]
    // Confirmed physical capacity is a safety invariant, independent of rollout/order enforcement.
    if (
      !resource &&
      (active ||
        state.inventorySafety.managed ||
        (party.preferredSpaceId && party.preferredSpaceId !== 'fastest'))
    )
      throw new HTTPException(409, { message: 'no_free_compatible_resource' })
    const oldest =
      resource &&
      state.parties.find((p) =>
        eligibleResources(
          p,
          state.resources,
          state.config?.assignmentPreference,
        ).some((r) => r.id === resource.id),
      )
    if (active && oldest?.id !== input.entryId && !input.overrideReason)
      throw new HTTPException(409, { message: 'oldest_compatible_required' })
    if (input.overrideReason)
      extra.push(
        env.DB.prepare(
          'INSERT INTO queue_override_audit VALUES (?,?,?,?,?,?)',
        ).bind(
          crypto.randomUUID(),
          queueId,
          input.entryId,
          actor,
          input.overrideReason,
          now,
        ),
      )
    if (resource)
      extra.push(
        env.DB.prepare(
          'INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at) VALUES (?,?,?,?,?,?)',
        ).bind(
          input.entryId,
          queueId,
          resource.id,
          resource.spaceId,
          resource.seats,
          now,
        ),
      )
  }
  if (input.action === 'complete' && allocation)
    extra.push(
      env.DB.prepare(
        'UPDATE queue_allocation SET arrived_at=? WHERE entry_id=? AND released_at IS NULL',
      ).bind(now, input.entryId),
    )
  if (allocation && ['release', 'cancel', 'no_show'].includes(input.action))
    extra.push(
      env.DB.prepare(
        'UPDATE queue_allocation SET released_at=?,outcome=? WHERE entry_id=? AND released_at IS NULL',
      ).bind(now, status, input.entryId),
    )
  if (input.action === 'call') {
    const predicted = await env.DB.prepare(
      'SELECT predicted_at,created_at,legacy_eta_minutes FROM queue_forecast_anchor WHERE entry_id=?',
    )
      .bind(input.entryId)
      .first<{
        predicted_at: number
        created_at: number
        legacy_eta_minutes: number
      }>()
    const position = state.parties.findIndex((p) => p.id === input.entryId)
    extra.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO queue_wait_evidence(entry_id,predicted_at,actual_at,error_minutes,legacy_eta_minutes,forecast_created_at,mode) VALUES (?,?,?,?,?,?,?)',
      ).bind(
        input.entryId,
        predicted?.predicted_at ?? null,
        now,
        predicted?.predicted_at == null
          ? null
          : (now - predicted.predicted_at) / 60000,
        predicted?.legacy_eta_minutes ??
          Math.max(0, position) * state.baseline,
        predicted?.created_at ?? null,
        state.config?.estimationMode ?? 'shadow',
      ),
    )
  }
  await env.DB.batch([
    ...extra,
    env.DB.prepare(
      `UPDATE queue_entry SET status=?,version=version+1,called_at=?,sequence=CASE WHEN ?='skip' THEN (SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?) ELSE sequence END WHERE id=? AND queue_id=? AND version=?`,
    ).bind(
      status,
      input.action === 'call' ? Date.now() : entry.called_at,
      input.action,
      queueId,
      input.entryId,
      queueId,
      input.version,
    ),
    env.DB.prepare(
      'INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      input.entryId,
      status === 'waiting' ? 'skipped' : status,
      Date.now(),
    ),
    audit(
      env,
      actor,
      access.organizationId,
      access.venueId,
      `queue.${input.action}`,
      input.entryId,
    ),
    env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)').bind(
      actor,
      key,
      fingerprint,
      JSON.stringify({ ok: true }),
    ),
  ])
  await recalculateQueue(env, queueId)
  return { ok: true }
}
export async function configureQueue(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  body: unknown,
) {
  const access = await queueAccess(env, actor, queueId, 'queue.configure')
  const parsed = queueSettingsSchema.safeParse(body)
  if (!parsed.success)
    throw new HTTPException(400, { message: 'invalid_settings' })
  const { version, open, ...rawConfig } = parsed.data
  const current = await env.DB.prepare(
    'SELECT version,open FROM queue WHERE id=?',
  )
    .bind(queueId)
    .first<{ version: number; open: number }>()
  if (!current || current.version !== version)
    throw new HTTPException(409, { message: 'version_conflict' })
  const old = await loadQueueState(env, queueId)
  const config = normalizeConfig(rawConfig, old.config)
  if (
    rawConfig.intelligencePolicy !== undefined &&
    rawConfig.intelligencePolicy !==
      (old.config?.intelligencePolicy ?? 'automatic')
  )
    throw new HTTPException(409, { message: 'lifecycle_command_required' })
  config.intelligencePolicy = old.config?.intelligencePolicy ?? 'automatic'
  if (
    open !== !!current.open ||
    (config.estimationMode ?? 'shadow') !==
      (old.config?.estimationMode ?? 'shadow') ||
    !!config.resourceStateKnown !== !!old.config?.resourceStateKnown
  )
    throw new HTTPException(409, { message: 'lifecycle_command_required' })
  const topologyChanged =
    !!old.config && topology(config) !== topology(old.config)
  if (
    topologyChanged &&
    current.open &&
    old.config?.estimationMode === 'active'
  )
    throw new HTTPException(409, { message: 'close_before_topology_change' })
  if (
    JSON.stringify(config.adjustments) !==
    JSON.stringify(old.config?.adjustments)
  )
    await queueAccess(env, actor, queueId, 'queue.operate')
  const adjustmentsChanged =
    JSON.stringify(config.adjustments) !==
    JSON.stringify(old.config?.adjustments)
  if (
    adjustmentsChanged &&
    config.adjustments?.some(
      (a) =>
        a.expiresAt <= Date.now() ||
        a.expiresAt > Date.now() + 24 * 60 * 60000 ||
        (!(
          config.type === 'reception' &&
          a.spaceId === 'reception' &&
          a.seats === 100
        ) &&
          !config.spaces.some(
            (s) =>
              s.id === a.spaceId &&
              s.tableTypes?.some((t) => t.seats === a.seats),
          )),
    )
  )
    throw new HTTPException(400, { message: 'invalid_adjustment' })
  for (const a of [
    ...old.allocations.filter((a) => a.released_at === null),
    ...old.holds,
  ]) {
    const space = config.spaces.find((s) => s.id === a.space_id)
    const type = space?.tableTypes?.find((t) => t.seats === a.seats)
    const index = Number(a.resource_id.split(':').at(-1))
    if (
      config.type !== old.config?.type ||
      (config.type === 'reception'
        ? index >= (config.stations ?? 1)
        : !type || index >= type.count)
    )
      throw new HTTPException(409, {
        message: 'occupied_resource_configuration',
      })
  }
  const preferences = await env.DB.prepare(
    "SELECT preferred_space_id,party_size FROM queue_entry WHERE queue_id=? AND status IN ('waiting','called','completed') AND preferred_space_id IS NOT NULL AND preferred_space_id!='fastest'",
  )
    .bind(queueId)
    .all<{ preferred_space_id: string; party_size: number }>()
  if (
    preferences.results.some(
      (entry) =>
        config.type !== 'restaurant' ||
        !config.spaces.some(
          (space) =>
            space.id === entry.preferred_space_id &&
            (!space.tableTypes?.length ||
              space.tableTypes.some(
                (type) => type.seats >= entry.party_size,
              )),
        ),
    )
  )
    throw new HTTPException(409, { message: 'preferred_space_in_use' })
  if (topologyChanged) {
    config.resourceStateKnown = false
    config.estimationMode = 'shadow'
  }
  await env.DB.batch([
    ...(topologyChanged
      ? [
          env.DB.prepare(
            'UPDATE queue_opening SET complete=0 WHERE queue_id=?',
          ).bind(queueId),
        ]
      : []),
    ...(topologyChanged && old.inventorySafety.managed
      ? [
          env.DB.prepare(
            'INSERT INTO queue_inventory_audit VALUES (?,?,?,?,?,?)',
          ).bind(
            crypto.randomUUID(),
            queueId,
            actor,
            'inventory_invalidated',
            JSON.stringify({ topology: topology(config) }),
            Date.now(),
          ),
        ]
      : []),
    ...(adjustmentsChanged
      ? [
          env.DB.prepare(
            'INSERT INTO queue_adjustment_audit VALUES (?,?,?,?,?)',
          ).bind(
            crypto.randomUUID(),
            queueId,
            actor,
            JSON.stringify(config.adjustments ?? []),
            Date.now(),
          ),
        ]
      : []),
    env.DB.prepare(
      'UPDATE queue SET capacity=?,average_minutes=?,open=?,name=?,config=?,version=version+1 WHERE id=? AND version=?',
    ).bind(
      config.capacity,
      config.averageMinutes,
      Number(open),
      config.name,
      JSON.stringify(config),
      queueId,
      version,
    ),
    audit(
      env,
      actor,
      access.organizationId,
      access.venueId,
      'queue.configured',
      queueId,
    ),
  ])
  await recalculateQueue(env, queueId)
  return { ok: true }
}
