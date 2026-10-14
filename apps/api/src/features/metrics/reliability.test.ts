import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'
import { processMetrics } from './processor'
import { backfillMetricsQueue } from './backfill'
import { readMetrics } from './read'
import { profileD1 } from '../../../test/d1-profile'

const enabled = {
  ...env,
  METRICS_CAPTURE_ENABLED: 'true',
  METRICS_DASHBOARD_ENABLED: 'true',
}
const now = Date.parse('2026-10-14T10:00:00Z')
async function fixture() {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,name,capacity,average_minutes,config) VALUES (?,'demo-venue','Metrics',100,10,?)",
  )
    .bind(id, JSON.stringify({ type: 'restaurant' }))
    .run()
  return id
}
async function capture(
  queue: string,
  at: number,
  sql: string,
  args: (string | number | null)[],
  origin = 'test',
) {
  return env.DB.batch([
    env.DB.prepare('INSERT INTO metrics_context VALUES(?,?,?)').bind(
      queue,
      at,
      origin,
    ),
    env.DB.prepare(sql).bind(...args),
    env.DB.prepare('DELETE FROM metrics_context WHERE queue_id=?').bind(queue),
  ])
}
async function join(queue: string, at: number, size = 2) {
  const id = crypto.randomUUID()
  await capture(
    queue,
    at,
    `INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES(?,?,?,'h',?,?,?,'es',?,?)`,
    [id, queue, id, id, id, size, at, at],
  )
  return id
}
async function flush(at = now) {
  for (let i = 0; i < 100; i++) {
    await processMetrics(enabled, at)
    const c = await env.DB.prepare(
      'SELECT target_at FROM metrics_control',
    ).first<{ target_at: number | null }>()
    if (c?.target_at === null) return
  }
  throw new Error('flush exhausted')
}
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
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  )
  await env.DB.prepare(
    "UPDATE metrics_control SET cursor=0,lease_token=NULL,lease_until=0,last_complete_at=NULL,target_seq=NULL,target_at=NULL,integrate_after=''",
  ).run()
})
async function tenantOwner() {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES(?,'Metrics',?,datetime('now'),datetime('now'),'commercial_operator')",
  )
    .bind(id, `${id}@test.invalid`)
    .run()
  await env.DB.prepare(
    "INSERT INTO tenant_account(organization_id,created_by) VALUES('demo-org',?) ON CONFLICT(organization_id) DO UPDATE SET created_by=excluded.created_by",
  )
    .bind(id)
    .run()
  return id
}

it('a 400-entry cut fits the paid D1 query budget', async () => {
  const { runMetricsCut } = await import('./processor')
  const q = await fixture()
  for (let i = 0; i < 400; i++) await join(q, now - 60000 + i)
  const measured = profileD1(enabled)
  let batches = 0,
    batchStatements = 0
  const DB = new Proxy(measured.env.DB, {
    get(target, key) {
      if (key === 'batch')
        return async (s: D1PreparedStatement[]) => {
          batches++
          batchStatements += s.length
          return target.batch(s)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const firstCut = await runMetricsCut({ ...measured.env, DB }, now)
  expect(firstCut.exhausted).toBe(true)
  expect(firstCut.queries).toBeLessThanOrEqual(800)
  expect(
    await env.DB.prepare(
      'SELECT lease_token,last_complete_at FROM metrics_control',
    ).first(),
  ).toEqual({ lease_token: null, last_complete_at: null })
  const requests = measured.costs.length - batchStatements + batches
  console.log(
    'AUDIT_COST',
    JSON.stringify({
      queries: measured.costs.length,
      requests,
      rowsRead: measured.costs.reduce((s, c) => s + c.rowsRead, 0),
      rowsWritten: measured.costs.reduce((s, c) => s + c.rowsWritten, 0),
    }),
  )
  expect(requests).toBeLessThanOrEqual(1000)
  expect(measured.costs.length).toBeLessThanOrEqual(800)
  for (let i = 0; i < 20; i++) {
    const result = await runMetricsCut(enabled, now)
    expect(result.queries).toBeLessThanOrEqual(800)
    if (result.complete) break
  }
  expect(
    await env.DB.prepare(
      'SELECT target_at,last_complete_at FROM metrics_control',
    ).first(),
  ).toEqual({ target_at: null, last_complete_at: now })
  expect(
    await env.DB.prepare(
      'SELECT SUM(generated) generated,SUM(pending) pending FROM metrics_daily',
    ).first(),
  ).toEqual({ generated: 400, pending: 400 })
})
it('a fully observed empty queue is zero activity, not unavailable', async () => {
  const owner = await tenantOwner(),
    q = await fixture()
  await backfillMetricsQueue(enabled, q, now - 3 * 86400000)
  await backfillMetricsQueue(enabled, q, now - 3 * 86400000)
  await flush()
  const result = await readMetrics(
    enabled,
    { id: owner, role: 'platform_admin' },
    { from: '2026-10-13', to: '2026-10-13', venueId: 'demo-venue', page: 1 },
    now,
  )
  console.log('AUDIT_EMPTY', JSON.stringify(result.coverage))
  expect(result.executive.completed.value).toBe(0)
})
it('no comparisons against a partially processed current period', async () => {
  const owner = await tenantOwner(),
    q = await fixture()
  const begin = Date.parse('2026-10-11T00:00:00Z')
  await join(q, begin)
  await backfillMetricsQueue(enabled, q, begin)
  await backfillMetricsQueue(enabled, q, begin)
  await env.DB.prepare(
    'INSERT OR IGNORE INTO metrics_backfill(queue_id,started_at,completed_at) SELECT id,?,? FROM queue',
  )
    .bind(begin, begin)
    .run()
  await join(q, Date.parse('2026-10-12T08:00:00Z'))
  await join(q, Date.parse('2026-10-12T08:01:00Z'))
  await join(q, Date.parse('2026-10-13T08:00:00Z'))
  await flush(Date.parse('2026-10-13T10:00:00Z'))
  const result = await readMetrics(
    enabled,
    { id: owner, role: 'platform_admin' },
    { from: '2026-10-13', to: '2026-10-13', page: 1 },
    now,
  )
  console.log(
    'AUDIT_PARTIAL_COMPARISON',
    JSON.stringify({
      coverage: result.coverage,
      comparison: result.services.find((s) => s.serviceType === 'restaurant')
        ?.comparison,
    }),
  )
  expect(
    result.services.find((s) => s.serviceType === 'restaurant')?.comparison
      .reason,
  ).toBe('unavailable')
})
it('capture gaps shorter than cron interval still recover closed entries', async () => {
  const { recordCaptureState } = await import('./reconcile')
  const q = await fixture()
  await backfillMetricsQueue(enabled, q, now - 3600000)
  await backfillMetricsQueue(enabled, q, now - 3600000)
  await flush(now - 3600000)
  // Capture is switched off and back on before any scheduled tick; real operations remain valid.
  const id = crypto.randomUUID()
  const { loadQueueState, commitQueueTransition } = await import(
    '../queue/projection'
  )
  const before = await loadQueueState(enabled, q, now - 60000)
  await commitQueueTransition(
    { ...enabled, METRICS_CAPTURE_ENABLED: 'false' },
    q,
    before,
    {},
    [
      env.DB.prepare(
        "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES(?,?,?,'h',?,?,2,'es',?,1,'cancelled')",
      ).bind(id, q, id, id, id, now - 60000),
    ],
    now - 60000,
  )
  expect(
    await env.DB.prepare(
      'SELECT started_at FROM metrics_capture_gap WHERE ended_at IS NULL',
    ).first(),
  ).not.toBeNull()
  await recordCaptureState(enabled, now)
  await backfillMetricsQueue(enabled, q, now)
  await backfillMetricsQueue(enabled, q, now)
  await flush()
  expect(
    await env.DB.prepare('SELECT entry_id FROM metrics_entry WHERE entry_id=?')
      .bind(id)
      .first(),
  ).not.toBeNull()
})
it('read snapshot cannot mix daily counts and a newer hourly cut', async () => {
  const owner = await tenantOwner(),
    q = await fixture(),
    id = await join(q, now - 60000)
  await flush(now - 30000)
  let injected = false
  const DB = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          expect(statements).toHaveLength(5)
          const snapshot = await target.batch(statements)
          if (!injected) {
            injected = true
            await capture(
              q,
              now,
              "UPDATE queue_entry SET status='called',called_at=?,version=version+1 WHERE id=?",
              [now, id],
            )
            await flush()
          }
          return snapshot
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const result = await readMetrics(
    { ...enabled, DB },
    { id: owner, role: 'platform_admin' },
    { from: '2026-10-14', to: '2026-10-14', page: 1 },
    now,
  )
  console.log(
    'AUDIT_TORN_READ',
    JSON.stringify({
      card: result.summary.meanWaitMs,
      pattern: result.patterns.overall.peakWaitMs,
      freshness: result.freshness,
    }),
  )
  expect(injected).toBe(true)
  expect(result.summary.meanWaitMs).toBeNull()
  expect(result.patterns.overall.peakWaitMs).toBeNull()
  expect(result.freshness.lastCompleteAt).toBe(now - 30000)
  const after = await readMetrics(
    enabled,
    { id: owner, role: 'platform_admin' },
    { from: '2026-10-14', to: '2026-10-14', page: 1 },
    now,
  )
  expect(after.summary.meanWaitMs).toBe(60000)
  expect(after.patterns.overall.peakWaitMs).toBe(60000)
  expect(after.freshness.lastCompleteAt).toBe(now)
})
it('a late backfill page does not rescan the imported prefix', async () => {
  const q = await fixture(),
    start = now - 86400000
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000)
    INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence)
    SELECT 'audit-'||i,?,'audit-'||i,'h','audit-'||i,'audit-'||i,2,'es',?+i,i FROM n`,
  )
    .bind(q, start)
    .run()
  await env.DB.prepare(
    'INSERT INTO metrics_backfill(queue_id,started_at,phase,after_created,after_id) VALUES(?,?,1,0,?)',
  )
    .bind(q, now, '')
    .run()
  const first = profileD1(enabled)
  await backfillMetricsQueue(first.env, q, now)
  await env.DB.prepare(
    'UPDATE metrics_backfill SET after_created=?,after_id=? WHERE queue_id=?',
  )
    .bind(start + 900, 'audit-900', q)
    .run()
  const late = profileD1(enabled)
  await backfillMetricsQueue(late.env, q, now)
  const reads = (p: ReturnType<typeof profileD1>) =>
    p.costs.find((c) => c.sql.includes('SELECT e.id,e.version'))!.rowsRead
  console.log(
    'AUDIT_BACKFILL_SEEK',
    JSON.stringify({ first: reads(first), late: reads(late) }),
  )
  expect(reads(late)).toBeLessThanOrEqual(reads(first) + 20)
})

it('rolls back the capture gap with a failed operational transaction', async () => {
  const { loadQueueState, commitQueueTransition } = await import(
    '../queue/projection'
  )
  const q = await fixture(),
    before = await loadQueueState(enabled, q, now)
  await expect(
    commitQueueTransition(
      { ...enabled, METRICS_CAPTURE_ENABLED: 'false' },
      q,
      before,
      {},
      [env.DB.prepare('INSERT INTO metrics_fence VALUES(0)')],
      now,
    ),
  ).rejects.toThrow()
  expect(
    await env.DB.prepare('SELECT COUNT(*) n FROM metrics_capture_gap').first(),
  ).toEqual({ n: 0 })
})

it('does not restart a completed repair when resumption is retried', async () => {
  const { recordCaptureState } = await import('./reconcile')
  const q = await fixture()
  await backfillMetricsQueue(enabled, q, now - 3600000)
  await backfillMetricsQueue(enabled, q, now - 3600000)
  await recordCaptureState(
    { ...enabled, METRICS_CAPTURE_ENABLED: 'false' },
    now - 60000,
  )
  await Promise.all([
    recordCaptureState(enabled, now),
    recordCaptureState(enabled, now),
  ])
  await backfillMetricsQueue(enabled, q, now)
  await backfillMetricsQueue(enabled, q, now)
  await recordCaptureState(enabled, now + 1000)
  expect(
    await env.DB.prepare(
      'SELECT phase,completed_at FROM metrics_backfill WHERE queue_id=?',
    )
      .bind(q)
      .first(),
  ).toEqual({ phase: 1, completed_at: now })
})

it('keyset backfill preserves siblings with identical creation timestamps and excludes expired history', async () => {
  const q = await fixture(),
    at = now - 86400000
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<45)
    INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status)
    SELECT 'same-'||i,?,'same-'||i,'h','same-'||i,'same-'||i,2,'es',?,i,'cancelled' FROM n`,
  )
    .bind(q, at)
    .run()
  for (let i = 0; i < 5; i++) await backfillMetricsQueue(enabled, q, now)
  expect(
    await env.DB.prepare(
      'SELECT COUNT(*) n FROM metrics_event WHERE queue_id=?',
    )
      .bind(q)
      .first(),
  ).toEqual({ n: 45 })
  expect(
    await env.DB.prepare(
      'SELECT completed_at FROM metrics_backfill WHERE queue_id=?',
    )
      .bind(q)
      .first(),
  ).toEqual({ completed_at: now })
})

it('a baseline does not invent prior coverage or overwrite a live waiting balance', async () => {
  const owner = await tenantOwner(),
    q = await fixture()
  await backfillMetricsQueue(enabled, q, now)
  await backfillMetricsQueue(enabled, q, now)
  const id = await join(q, now + 1000, 3)
  await flush(now + 2000)
  await backfillMetricsQueue(enabled, q, now + 3000)
  expect(
    await env.DB.prepare('SELECT people FROM metrics_queue WHERE queue_id=?')
      .bind(q)
      .first(),
  ).toEqual({ people: 3 })
  const before = await readMetrics(
    enabled,
    { id: owner, role: 'platform_admin' },
    { from: '2026-10-13', to: '2026-10-13', page: 1 },
    now + 3000,
  )
  expect(before.coverage.volume).toBe('unavailable')
  expect(before.executive.completed.value).toBeNull()
  expect(
    await env.DB.prepare('SELECT entry_id FROM metrics_entry WHERE entry_id=?')
      .bind(id)
      .first(),
  ).not.toBeNull()
})

it('resumes eight-hour integration chunks within a small explicit query budget', async () => {
  const { runMetricsCut } = await import('./processor')
  const q = await fixture(),
    at = now - 3 * 86400000
  await join(q, at)
  const low = { ...enabled, METRICS_D1_QUERY_BUDGET: '64' }
  let result
  for (let i = 0; i < 40; i++) {
    result = await runMetricsCut(low, now)
    expect(result.queries).toBeLessThanOrEqual(64)
    if (result.complete) break
  }
  expect(result?.complete).toBe(true)
  expect(
    await env.DB.prepare('SELECT SUM(people_ms) n FROM metrics_hourly').first(),
  ).toEqual({ n: 2 * (now - at) })
})

it('profiles a maximum-range read with ten venues and three dense services each', async () => {
  const owner = await tenantOwner(),
    from = Date.parse('2026-10-13T00:00:00Z') - 365 * 86400000
  const types = ['restaurant', 'reception', 'pool']
  for (let i = 0; i < 10; i++) {
    const venue = `dense-v-${i}`
    await env.DB.prepare(
      "INSERT INTO venue(id,organization_id,name,timezone) VALUES(?,'demo-org',?,'UTC')",
    )
      .bind(venue, venue)
      .run()
    for (const type of types) {
      const q = `dense-q-${i}-${type}`,
        d = JSON.stringify([q, type, 'UTC'])
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO queue(id,venue_id,name,capacity,average_minutes,config) VALUES(?,?,?,100,10,?)',
        ).bind(q, venue, q, JSON.stringify({ type })),
        env.DB.prepare(
          "INSERT INTO metrics_queue VALUES(?,?,?,'demo-org',?,'UTC',0,?,?)",
        ).bind(d, q, venue, type, now, from),
        env.DB.prepare(
          'INSERT INTO metrics_backfill(queue_id,started_at,completed_at) VALUES(?,?,?)',
        ).bind(q, from, from),
        env.DB.prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<365)
          INSERT INTO metrics_daily(dimension,queue_id,venue_id,organization_id,service_type,timezone,date,generated,completed,wait_sum_ms,wait_samples,people_ms,observed_ms,first_wait_at,last_wait_at)
          SELECT ?,?,?,'demo-org',?,'UTC',date((?+i*86400000)/1000,'unixepoch'),1,1,60000,1,7200000,86400000,?+i*86400000+28800000,?+i*86400000+32400000 FROM n`,
        ).bind(d, q, venue, type, from, from, from),
        env.DB.prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<8783)
          INSERT INTO metrics_hourly(dimension,queue_id,venue_id,organization_id,service_type,timezone,date,hour,bucket_at,bucket_end,generated,wait_sum_ms,wait_samples,people_ms,observed_ms)
          SELECT ?,?,?,'demo-org',?,'UTC',date((?+i*3600000)/1000,'unixepoch'),i%24,?+i*3600000,?+(i+1)*3600000,i%24=8,CASE WHEN i%24=8 THEN 60000 ELSE 0 END,i%24=8,CASE WHEN i%24=8 THEN 7200000 ELSE 0 END,3600000 FROM n`,
        ).bind(d, q, venue, type, from, from, from),
      ])
    }
  }
  await env.DB.prepare('UPDATE metrics_control SET last_complete_at=?')
    .bind(now)
    .run()
  const profiled = profileD1(enabled),
    start = Date.now()
  const result = await readMetrics(
    profiled.env,
    { id: owner, role: 'platform_admin' },
    {
      from: new Date(from).toISOString().slice(0, 10),
      to: '2026-10-13',
      page: 1,
    },
    now,
  )
  console.info(
    'METRICS_DENSE_READ',
    JSON.stringify({
      wallMs: Date.now() - start,
      statements: profiled.costs.length,
      rowsRead: profiled.costs.reduce((n, c) => n + c.rowsRead, 0),
      rowsWritten: profiled.costs.reduce((n, c) => n + c.rowsWritten, 0),
    }),
  )
  expect(result.summary.generated).toBe(366 * 30)
  expect(result.summary.completed).toBe(366 * 30)
  expect(result.summary.meanWaitMs).toBe(60000)
  expect(result.patterns.overall.peakQueuePeople).toBe(2)
  expect(result.venues.items).toHaveLength(10)
  expect(result.trend).toHaveLength(366)
  expect(profiled.costs.every((c) => c.rowsWritten === 0)).toBe(true)
}, 60000)

it('gap repair seeks new admissions without scanning or resurrecting purged history', async () => {
  const q = await fixture(),
    at = now - 86400000
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000)
    INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status)
    SELECT 'repair-'||i,?,'repair-'||i,'h','repair-'||i,'repair-'||i,2,'es',?+i,i,'cancelled' FROM n`,
  )
    .bind(q, at)
    .run()
  await env.DB.prepare(
    'INSERT INTO metrics_backfill(queue_id,started_at,phase,repair_since) VALUES(?,?,1,?)',
  )
    .bind(q, now, at + 980)
    .run()
  const measured = profileD1(enabled)
  await backfillMetricsQueue(measured.env, q, now)
  const reads = measured.costs.find((c) =>
    c.sql.includes('SELECT e.id,e.version'),
  )!.rowsRead
  expect(reads).toBeLessThan(150)
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<9000)
    INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status)
    SELECT 'purged-'||i,?,'purged-'||i,'h','purged-'||i,'purged-'||i,2,'es',?+i,1000+i,'cancelled' FROM n`,
  )
    .bind(q, at - 86400000)
    .run()
  await env.DB.prepare(
    "UPDATE metrics_backfill SET after_created=0,after_id='' WHERE queue_id=?",
  )
    .bind(q)
    .run()
  const larger = profileD1(enabled)
  await backfillMetricsQueue(larger.env, q, now)
  expect(
    larger.costs.find((c) => c.sql.includes('SELECT e.id,e.version'))!.rowsRead,
  ).toBeLessThanOrEqual(reads + 2)
  await backfillMetricsQueue(enabled, q, now)
  expect(
    await env.DB.prepare(
      'SELECT COUNT(*) n FROM metrics_event WHERE queue_id=?',
    )
      .bind(q)
      .first(),
  ).toEqual({ n: 21 })
})

it('a capture gap does not turn an unfinished initial backfill into a filtered repair', async () => {
  const { recordCaptureState } = await import('./reconcile')
  const q = await fixture()
  await backfillMetricsQueue(enabled, q, now - 3600000)
  await recordCaptureState(
    { ...enabled, METRICS_CAPTURE_ENABLED: 'false' },
    now - 60000,
  )
  await recordCaptureState(enabled, now)
  expect(
    await env.DB.prepare(
      'SELECT phase,repair_since FROM metrics_backfill WHERE queue_id=?',
    )
      .bind(q)
      .first(),
  ).toEqual({ phase: 0, repair_since: null })
})

it('reopens a second capture gap even when the completed cut has not advanced', async () => {
  const { recordCaptureState } = await import('./reconcile')
  const q = await fixture()
  await env.DB.prepare('UPDATE metrics_control SET last_complete_at=?')
    .bind(now - 3600000)
    .run()
  await backfillMetricsQueue(enabled, q, now - 3500000)
  await backfillMetricsQueue(enabled, q, now - 3500000)
  const disabled = { ...enabled, METRICS_CAPTURE_ENABLED: 'false' }
  await recordCaptureState(disabled, now - 3000000)
  await recordCaptureState(enabled, now - 2000000)
  await backfillMetricsQueue(enabled, q, now - 1000000)
  await backfillMetricsQueue(enabled, q, now - 1000000)
  await recordCaptureState(disabled, now - 60000)
  expect(
    await env.DB.prepare(
      'SELECT COUNT(*) n FROM metrics_capture_gap WHERE ended_at IS NULL',
    ).first(),
  ).toEqual({ n: 1 })
  await recordCaptureState(enabled, now)
  expect(
    await env.DB.prepare(
      'SELECT completed_at,repair_since FROM metrics_backfill WHERE queue_id=?',
    )
      .bind(q)
      .first(),
  ).toEqual({ completed_at: null, repair_since: now - 3600000 })
})

it('a new gap after a completed repair does not reuse its old import boundary', async () => {
  const { recordCaptureState } = await import('./reconcile')
  const q = await fixture()
  await env.DB.prepare(
    'INSERT INTO metrics_backfill(queue_id,started_at,completed_at,repair_since) VALUES(?,?,?,?)',
  )
    .bind(q, now - 100 * 86400000, now - 99 * 86400000, now - 100 * 86400000)
    .run()
  await env.DB.prepare('UPDATE metrics_control SET last_complete_at=?')
    .bind(now - 900000)
    .run()
  await recordCaptureState(
    { ...enabled, METRICS_CAPTURE_ENABLED: 'false' },
    now - 60000,
  )
  await recordCaptureState(enabled, now)
  expect(
    await env.DB.prepare(
      'SELECT repair_since FROM metrics_backfill WHERE queue_id=?',
    )
      .bind(q)
      .first(),
  ).toEqual({ repair_since: now - 900000 })
})
