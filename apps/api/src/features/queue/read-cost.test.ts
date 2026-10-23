import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { loadQueueState, refreshQueue } from './projection'
import { profileD1 } from '../../../test/d1-profile'
import worker from '../../index'

async function fixture(history: number) {
  const id = crypto.randomUUID()
  const config = {
    name: 'Profile',
    type: 'restaurant',
    capacity: 1000,
    averageMinutes: 30,
    graceMinutes: 5,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: [],
    resourceStateKnown: true,
    estimationMode: 'active',
    spaces: [
      {
        id: 'room',
        name: 'Room',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1 }],
      },
    ],
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,name,capacity,average_minutes,config) VALUES (?,'demo-venue','Profile',1000,30,?)",
  )
    .bind(id, JSON.stringify(config))
    .run()
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
    INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status,service_window_id)
    SELECT ?||':'||i,?,?||':'||i,'hash',?||':'||i,?||':H'||i,2,'en',i,i,'served','continuous:profile' FROM n`,
  )
    .bind(history, id, id, id, id, id)
    .run()
  await env.DB.prepare(
    `INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at,released_at,outcome)
    SELECT id,queue_id,'room:4:0','room',4,sequence*100000,sequence*100000,sequence*100000+CASE WHEN sequence%7=0 THEN 1000 ELSE 120000 END,'served' FROM queue_entry WHERE queue_id=?`,
  )
    .bind(id)
    .run()
  const waiting = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status,service_window_id) VALUES (?,?,?,'hash',?,?,2,'en',0,10000,'waiting','continuous:profile')",
  )
    .bind(waiting, id, waiting, waiting, waiting)
    .run()
  return { id, waiting }
}
it.each(['inferred', 'confirmed', 'mixed'])('bounds contextual assignment reads at 10x %s history', async (provenance) => {
  const measurements = []
  for (const history of [100, 1000]) {
    const { id } = await fixture(history),
      measured = profileD1(env)
    await env.DB.prepare(
      `INSERT INTO queue_assignment_observation(entry_id,call_cycle,queue_id,episode_id,assigned_at,space_id,seats,baseline_ms,interval_ms,ratio,source,provenance,model_revision)
      SELECT id,1,queue_id,'read-cost',sequence,'room',4,1800000,3600000,2,'staff',CASE WHEN ?='mixed' THEN CASE WHEN sequence<=35 THEN 'confirmed' ELSE 'inferred' END ELSE ? END,2
      FROM queue_entry WHERE queue_id=? AND status='served'`,
    ).bind(provenance, provenance, id).run()
    const state = await loadQueueState(measured.env, id, 1_900_000_000_000)
    expect(state.allocations).toEqual([])
    expect(state.resources).toEqual([])
    expect(state.adaptive?.factors.service).toBeGreaterThan(1)
    const observations = measured.costs.filter((cost) =>
      cost.sql.includes('queue_assignment_observation'),
    )
    expect(observations.length).toBeGreaterThan(0)
    const observationRowsRead = observations.reduce(
      (sum, cost) => sum + cost.rowsRead,
      0,
    )
    // The model performs bounded indexed windows for service, zone and each
    // configured type; allow the fixed per-query overhead while still proving
    // the 1k-row fixture does not scale with the 10x historical dataset.
    expect(observationRowsRead).toBeLessThan(400)
    expect(measured.costs.some((cost) => cost.sql.includes('FROM queue_allocation'))).toBe(false)
    expect(
      measured.costs.some((cost) => cost.sql.includes('FROM queue_event')),
    ).toBe(false)
    measurements.push({ history, observationRowsRead })
  }
  expect(measurements[0]!.observationRowsRead).toBe(measurements[1]!.observationRowsRead)
})
it('coalesces projection writes within 5 seconds but repairs missing projections and expires before the gate', async () => {
  const { id, waiting } = await fixture(10),
    measured = profileD1(env),
    start = 1_900_000_000_000
  await refreshQueue(measured.env, id, start)
  const revision = (
    await env.DB.prepare(
      'SELECT updated_at FROM queue_projection WHERE entry_id=?',
    )
      .bind(waiting)
      .first()
  )?.updated_at
  await refreshQueue(measured.env, id, start + 1000)
  await refreshQueue(measured.env, id, start + 4000)
  expect(
    (
      await env.DB.prepare(
        'SELECT updated_at FROM queue_projection WHERE entry_id=?',
      )
        .bind(waiting)
        .first()
    )?.updated_at,
  ).toBe(revision)
  await env.DB.prepare('DELETE FROM queue_projection WHERE entry_id=?')
    .bind(waiting)
    .run()
  await refreshQueue(measured.env, id, start + 4001)
  expect(
    (
      await env.DB.prepare(
        'SELECT updated_at FROM queue_projection WHERE entry_id=?',
      )
        .bind(waiting)
        .first()
    )?.updated_at,
  ).toBe(start + 4001)
  await env.DB.prepare('UPDATE queue_entry SET service_ends_at=? WHERE id=?')
    .bind(start + 4500, waiting)
    .run()
  await refreshQueue(measured.env, id, start + 4500)
  expect(
    await env.DB.prepare('SELECT status,manual_only FROM queue_entry WHERE id=?')
      .bind(waiting)
      .first(),
  ).toEqual({ status: 'waiting', manual_only: 1 })
})
it('skips truly empty and terminal-only cron queues but expires called entries even on inactive queues', async () => {
  const now = Date.now(),
    terminal = await fixture(100),
    called = await fixture(1)
  await env.DB.prepare('DELETE FROM queue_entry WHERE id=?')
    .bind(terminal.waiting)
    .run()
  await env.DB.prepare(
    "UPDATE queue_entry SET status='called',called_at=?,arrival_deadline_at=? WHERE id=?",
  )
    .bind(now - 60000, now - 1, called.waiting)
    .run()
  await env.DB.prepare('UPDATE queue SET open=0 WHERE id=?')
    .bind(called.id)
    .run()
  const empty = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,name,capacity,average_minutes) VALUES (?,'demo-venue','Empty',10,30)",
  )
    .bind(empty)
    .run()
  const refreshed: string[] = []
  const coordinator = {
    getByName: (id: string) => ({
      refresh: async () => {
        refreshed.push(id)
        await refreshQueue(env, id, now)
      },
    }),
  }
  await worker.scheduled(
    {} as ScheduledController,
    {
      ...env,
      APP_ENV: 'local',
      QUEUE_COORDINATOR: coordinator,
    } as unknown as typeof env,
  )
  expect(refreshed).not.toContain(terminal.id)
  expect(refreshed).not.toContain(empty)
  expect(refreshed).toContain(called.id)
  expect(
    (
      await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
        .bind(called.waiting)
        .first()
    )?.status,
  ).toBe('expired')
})
it('does not load historical reservation durations into the cadence model', async () => {
  const { id } = await fixture(100),
    now = 1_900_000_000_000
  const state = await loadQueueState(env, id, now)
  expect(state.allocations).toEqual([])
  expect(state.resources).toEqual([])
  expect(state.adaptive?.factors.service).toBe(1)
  expect(
    (
      await env.DB.prepare(
        'SELECT COUNT(*) n FROM queue_allocation WHERE queue_id=?',
      )
        .bind(id)
        .first<{ n: number }>()
    )?.n,
  ).toBe(100)
})
it('does not treat prior calls or holds as resource slots when projecting a new turn', async () => {
  const { id } = await fixture(1),
    now = 1_900_000_000_000
  const calls = Array.from({ length: 11 }, (_, index) => ({
    created_at: now - (index + 2) * 60000,
  }))
  const after = await loadQueueState(env, id, now, {
    calls,
    appendedCallAt: now,
    holds: [{ resource_id: 'room:4:0', space_id: 'room', seats: 4 }],
  })
  expect(calls).toHaveLength(11)
  expect(after.calls).toHaveLength(11)
  expect(after.projections[0]?.predictedAt).toBe(now + 30 * 60000)
  expect(after.adaptiveProjections[0]?.cadenceMs).toBe(30 * 60000)
  expect(after.resources).toEqual([])
  expect(after.allocations).toEqual([])
})

it('avoids automation and retired-decision writes when no cycle or legacy decision exists', async () => {
  const { id } = await fixture(1)
  const measured = profileD1(env)
  await refreshQueue(measured.env, id)
  expect(measured.costs.some(cost => /UPDATE queue_automation_cycle/.test(cost.sql))).toBe(false)
  expect(measured.costs.some(cost => /UPDATE queue_replacement_decision/.test(cost.sql))).toBe(false)
})
