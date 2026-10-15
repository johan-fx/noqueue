import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'
import { historicalServiceType } from './historical-service'
import { backfillMetricsQueue } from './backfill'
import { processMetrics } from './processor'
import { repairHistoricalService } from './repair-historical-service'

const since = '2026-10-11T00:00:00Z'
const created = Date.parse('2026-10-12T10:00:00Z')
const now = Date.parse('2026-10-14T10:00:00Z')
const enabled = { ...env, METRICS_CAPTURE_ENABLED: 'true' }
const staging = { DB: env.DB, APP_ENV: 'staging' }
const snapshot = (type: string) =>
  `continuous:groups:${JSON.stringify([
    'Europe/Madrid',
    type,
    30,
    { allDayDays: [0, 1, 2, 3, 4, 5, 6], schedules: [] },
  ])}`

it('recovers both historical window formats and all service types without current config', () => {
  for (const type of ['reception', 'restaurant', 'pool']) {
    expect(historicalServiceType(snapshot(type), created, since)).toBe(type)
    expect(
      historicalServiceType(
        `2026-10-12:09:00:20:00:${JSON.stringify([
          'Europe/Madrid',
          type,
          false,
          15,
          [],
        ])}`,
        created,
        since
      )
    ).toBe(type)
    expect(
      historicalServiceType(
        `2026-10-12:full-day:${JSON.stringify([
          'Europe/Madrid',
          type,
          15,
          { allDayDays: [1], schedules: [] },
        ])}`,
        created,
        since
      )
    ).toBe(type)
  }
})
it('fails closed for missing provenance, pre-deployment, synthetic, malformed and conflicting-date snapshots', () => {
  expect(historicalServiceType(snapshot('restaurant'), created)).toBe('unknown')
  expect(
    historicalServiceType(snapshot('restaurant'), created, 'not-a-date')
  ).toBe('unknown')
  expect(
    historicalServiceType(snapshot('restaurant'), Date.parse(since) - 1, since)
  ).toBe('unknown')
  for (const value of [
    null,
    '',
    'legacy:closed',
    'continuous:synthetic',
    'continuous:["UTC","restaurant"]',
    snapshot('invalid'),
    snapshot('restaurant').replace('Europe/Madrid', 'bad-zone'),
    `2026-10-13:09:00:20:00:["UTC","restaurant",false,15,[]]`,
    `2026-10-01:full-day:["UTC","restaurant",15,{"allDayDays":[],"schedules":[]}]`,
  ])
    expect(historicalServiceType(value, created, since)).toBe('unknown')
})
beforeEach(async () => {
  await env.DB.batch(
    [
      'metrics_event',
      'metrics_identity',
      'metrics_entry',
      'metrics_queue',
      'metrics_daily',
      'metrics_hourly',
      'metrics_backfill',
      'metrics_fence',
      'metrics_context',
      'metrics_dirty',
      'metrics_capture_gap',
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`))
  )
  await env.DB.prepare(
    "UPDATE metrics_control SET cursor=0,lease_token=NULL,lease_until=0,last_complete_at=NULL,target_seq=NULL,target_at=NULL,integrate_after=''"
  ).run()
})
async function seed(
  count = 1,
  type = 'restaurant',
  name = 'QA retained',
  venue = 'demo-venue'
) {
  const queue = crypto.randomUUID(),
    ids: string[] = []
  await env.DB.prepare(
    'INSERT INTO queue(id,venue_id,name,capacity,average_minutes,config) VALUES(?,?,?,100,10,?)'
  )
    .bind(queue, venue, name, JSON.stringify({ type }))
    .run()
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID()
    ids.push(id)
    await env.DB.prepare(
      `INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status,service_window_id)
      VALUES(?,?,?,'h',?,?,2,'es',?,?,'cancelled',?)`
    )
      .bind(id, queue, id, id, id, created + i, i, snapshot(type))
      .run()
  }
  return { queue, ids }
}
async function importQueue(queue: string, recover = false) {
  for (let n = 0; n < 10; n++) {
    await backfillMetricsQueue(
      {
        ...enabled,
        ...(recover ? { METRICS_SERVICE_SNAPSHOT_CAPTURE_SINCE: since } : {}),
      },
      queue,
      now
    )
    if (
      (
        await env.DB.prepare(
          'SELECT completed_at FROM metrics_backfill WHERE queue_id=?'
        )
          .bind(queue)
          .first<{ completed_at: number | null }>()
      )?.completed_at
    )
      return
  }
  throw new Error('backfill incomplete')
}
async function flush() {
  for (let n = 0; n < 80; n++)
    if ((await processMetrics(enabled, now)).complete) return
  throw new Error('cut incomplete')
}
const options = (ids: string[]) => ({
  venueId: 'demo-venue',
  entryIds: ids,
  capturedSince: since,
  apply: true,
})
async function totals() {
  return env.DB.prepare(
    `SELECT SUM(generated) generated,SUM(completed) completed,SUM(cancelled) cancelled,
    SUM(no_show) no_show,SUM(pending) pending,SUM(unknown) unknown,SUM(wait_sum_ms) wait_sum_ms,SUM(wait_samples) wait_samples
    FROM metrics_daily`
  ).first()
}
it('backfills proven types, preserves unknowns and does not overwrite a captured identity', async () => {
  const f = await seed(2, 'reception')
  await env.DB.prepare('UPDATE queue SET config=\'{"type":"pool"}\' WHERE id=?')
    .bind(f.queue)
    .run()
  await env.DB.prepare(
    'UPDATE queue_entry SET service_window_id=NULL WHERE id=?'
  )
    .bind(f.ids[1])
    .run()
  await importQueue(f.queue, true)
  await flush()
  expect(
    (
      await env.DB.prepare(
        'SELECT service_type,historical FROM metrics_identity ORDER BY service_type'
      ).all()
    ).results
  ).toEqual([
    { service_type: 'reception', historical: 1 },
    { service_type: 'unknown', historical: 1 },
  ])
  await env.DB.prepare(
    "UPDATE metrics_identity SET service_type='pool',historical=0 WHERE entry_id=?"
  )
    .bind(f.ids[0])
    .run()
  await env.DB.prepare('DELETE FROM metrics_backfill WHERE queue_id=?')
    .bind(f.queue)
    .run()
  await importQueue(f.queue, true)
  expect(
    await env.DB.prepare(
      'SELECT service_type,historical FROM metrics_identity WHERE entry_id=?'
    )
      .bind(f.ids[0])
      .first()
  ).toEqual({ service_type: 'pool', historical: 0 })
})
it('atomically reclassifies 55 including QA, preserves all totals, scopes isolation, and is idempotent', async () => {
  const fixtures = await Promise.all([
    seed(18, 'reception', 'Front Desk'),
    seed(31, 'restaurant', 'Snack bar'),
    seed(5),
    seed(1),
  ])
  const allIds = fixtures.flatMap((f) => f.ids)
  for (const [n, id] of allIds.entries()) {
    await env.DB.prepare('UPDATE queue_entry SET status=? WHERE id=?')
      .bind(n < 11 ? 'completed' : n < 49 ? 'cancelled' : 'expired', id)
      .run()
    if (n < 23)
      await env.DB.prepare(
        "INSERT INTO queue_wait_evidence(entry_id,actual_at,legacy_eta_minutes,mode) VALUES(?,?,1,'test')"
      )
        .bind(id, created + 60000)
        .run()
  }
  for (const f of fixtures) await importQueue(f.queue)
  const otherVenue = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO venue(id,organization_id,name,timezone) SELECT ?,organization_id,'Other venue',timezone FROM venue WHERE id='demo-venue'"
  )
    .bind(otherVenue)
    .run()
  const foreign = await seed(2, 'pool', 'Other queue not in cohort', otherVenue)
  await importQueue(foreign.queue)
  await flush()
  const ids = fixtures.flatMap((f) => f.ids),
    before = await totals()
  const operational = await env.DB.prepare(
    'SELECT id,version,status,service_window_id FROM queue_entry ORDER BY id'
  ).all()
  expect(
    await repairHistoricalService(staging, { ...options(ids), apply: false })
  ).toEqual({
    changed: 55,
    totals: { reception: 18, restaurant: 37 },
    applied: false,
  })
  expect(await repairHistoricalService(staging, options(ids))).toEqual({
    changed: 55,
    totals: { reception: 18, restaurant: 37 },
    applied: true,
  })
  expect(await totals()).toEqual(before)
  expect(
    (
      await env.DB.prepare(
        'SELECT service_type,SUM(generated) n FROM metrics_daily GROUP BY service_type HAVING n>0 ORDER BY service_type'
      ).all()
    ).results
  ).toEqual([
    { service_type: 'reception', n: 18 },
    { service_type: 'restaurant', n: 37 },
    { service_type: 'unknown', n: 2 },
  ])
  expect(
    (
      await env.DB.prepare(
        'SELECT id,version,status,service_window_id FROM queue_entry ORDER BY id'
      ).all()
    ).results
  ).toEqual(operational.results)
  expect((await repairHistoricalService(staging, options(ids))).changed).toBe(0)
  expect(await totals()).toEqual(before)
  await flush()
  expect(await totals()).toEqual(before)
  expect(
    await env.DB.prepare(
      'SELECT COUNT(*) n FROM metrics_entry e JOIN metrics_identity i ON i.entry_id=e.entry_id WHERE e.dimension!=json_array(i.queue_id,i.service_type,i.timezone)'
    ).first()
  ).toEqual({ n: 0 })
})
it('refuses wrong venue, production, ambiguous and partial dimensions without any changes', async () => {
  const f = await seed(2)
  await importQueue(f.queue)
  await flush()
  const before = await totals()
  await expect(
    repairHistoricalService(
      { ...staging, APP_ENV: 'production' },
      options(f.ids)
    )
  ).rejects.toThrow('staging_only')
  await expect(
    repairHistoricalService(staging, {
      ...options(f.ids),
      venueId: 'another-venue',
    })
  ).rejects.toThrow('cohort_missing')
  await expect(
    repairHistoricalService(staging, options([f.ids[0]!]))
  ).rejects.toThrow()
  await expect(
    repairHistoricalService(staging, {
      ...options(f.ids),
      capturedSince: '2026-10-15',
    })
  ).rejects.toThrow('ambiguous')
  expect(await totals()).toEqual(before)
})
it('rolls back when a cut is active, capture is pending, or unknown occupancy is nonzero', async () => {
  const f = await seed()
  await importQueue(f.queue)
  await flush()
  const before = await totals()
  await env.DB.prepare('UPDATE metrics_control SET lease_until=?')
    .bind(Date.now() + 60000)
    .run()
  await expect(
    repairHistoricalService(staging, options(f.ids))
  ).rejects.toThrow()
  await env.DB.prepare('UPDATE metrics_control SET lease_until=0,target_at=?')
    .bind(now)
    .run()
  await expect(
    repairHistoricalService(staging, options(f.ids))
  ).rejects.toThrow()
  await env.DB.prepare(
    'UPDATE metrics_control SET target_at=NULL,cursor=0'
  ).run()
  await expect(
    repairHistoricalService(staging, options(f.ids))
  ).rejects.toThrow()
  await env.DB.prepare(
    'UPDATE metrics_control SET cursor=(SELECT MAX(seq) FROM metrics_event)'
  ).run()
  await env.DB.prepare(
    "UPDATE metrics_daily SET people_ms=1 WHERE service_type='unknown'"
  ).run()
  await expect(
    repairHistoricalService(staging, options(f.ids))
  ).rejects.toThrow()
  expect(await totals()).toEqual(before)
  expect(
    await env.DB.prepare(
      'SELECT service_type FROM metrics_identity WHERE entry_id=?'
    )
      .bind(f.ids[0])
      .first()
  ).toEqual({ service_type: 'unknown' })
})
it('rolls back earlier dimension writes when a later dimension guard fails', async () => {
  const a = await seed(),
    b = await seed(2)
  await importQueue(a.queue)
  await importQueue(b.queue)
  await flush()
  const before = await totals()
  await expect(
    repairHistoricalService(staging, options([...a.ids, b.ids[0]!]))
  ).rejects.toThrow()
  expect(await totals()).toEqual(before)
  expect(
    (
      await env.DB.prepare(
        'SELECT DISTINCT service_type FROM metrics_identity'
      ).all()
    ).results
  ).toEqual([{ service_type: 'unknown' }])
})
it('keeps subsequent captured updates in the corrected dimension without double counting', async () => {
  const f = await seed()
  await importQueue(f.queue)
  await flush()
  await repairHistoricalService(staging, options(f.ids))
  await env.DB.batch([
    env.DB.prepare("INSERT INTO metrics_context VALUES(?,?,'test')").bind(
      f.queue,
      now
    ),
    env.DB.prepare(
      "UPDATE queue_entry SET status='completed',version=version+1 WHERE id=?"
    ).bind(f.ids[0]),
    env.DB.prepare('DELETE FROM metrics_context WHERE queue_id=?').bind(
      f.queue
    ),
  ])
  await flush()
  expect(await totals()).toMatchObject({
    generated: 1,
    completed: 1,
    cancelled: 0,
  })
  expect(
    (
      await env.DB.prepare(
        'SELECT DISTINCT service_type FROM metrics_event'
      ).all()
    ).results
  ).toEqual([{ service_type: 'restaurant' }])
})
it('merges into a destination with existing live counts without changing live provenance or coverage', async () => {
  const f = await seed()
  await importQueue(f.queue)
  await flush()
  const id = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare("INSERT INTO metrics_context VALUES(?,?,'test')").bind(
      f.queue,
      now
    ),
    env.DB.prepare(
      `INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status)
      VALUES(?,?,?,'h',?,?,1,'es',?,100,'completed')`
    ).bind(id, f.queue, id, id, id, created),
    env.DB.prepare('DELETE FROM metrics_context WHERE queue_id=?').bind(
      f.queue
    ),
  ])
  await flush()
  const before = await totals()
  const coverage = await env.DB.prepare(
    "SELECT SUM(observed_ms) n FROM metrics_daily WHERE service_type='restaurant'"
  ).first()
  await repairHistoricalService(staging, options(f.ids))
  expect(await totals()).toEqual(before)
  expect(await totals()).toMatchObject({
    generated: 2,
    completed: 1,
    cancelled: 1,
  })
  expect(
    await env.DB.prepare(
      "SELECT SUM(observed_ms) n FROM metrics_daily WHERE service_type='restaurant'"
    ).first()
  ).toEqual(coverage)
  expect(
    await env.DB.prepare(
      'SELECT service_type,historical FROM metrics_identity WHERE entry_id=?'
    )
      .bind(id)
      .first()
  ).toEqual({ service_type: 'restaurant', historical: 0 })
})
