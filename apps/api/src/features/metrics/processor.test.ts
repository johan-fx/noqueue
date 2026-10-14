import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'
import { processMetrics, purgeMetrics } from './processor'
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
it('captures atomically, excludes PII and deduplicates journal revisions', async () => {
  const q = await fixture(),
    id = await join(q, now)
  const event = await env.DB.prepare(
    'SELECT * FROM metrics_event WHERE entry_id=?',
  )
    .bind(id)
    .first()
  expect(event).toMatchObject({
    entry_id: id,
    revision: 0,
    status: 'waiting',
    service_type: 'restaurant',
  })
  expect(Object.keys(event!)).not.toEqual(
    expect.arrayContaining(['phone_hash', 'display_name', 'recovery_hash']),
  )
  await expect(
    env.DB.batch([
      env.DB.prepare('INSERT INTO metrics_context VALUES(?,?,?)').bind(
        q,
        now,
        'fail',
      ),
      env.DB.prepare(
        "UPDATE queue_entry SET status='cancelled',version=version+1 WHERE id=?",
      ).bind(id),
      env.DB.prepare('INSERT INTO metrics_fence VALUES(0)'),
    ]),
  ).rejects.toThrow()
  expect(
    await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ status: 'waiting' })
  expect(
    (await env.DB.prepare('SELECT COUNT(*) n FROM metrics_event').first<{
      n: number
    }>())!.n,
  ).toBe(1)
  await flush()
  await flush()
  expect(
    await env.DB.prepare('SELECT generated,pending FROM metrics_daily').first(),
  ).toEqual({ generated: 1, pending: 1 })
})
it('keeps first actual call across direct completion, restore, second call and cohort corrections', async () => {
  const q = await fixture(),
    at = now - 86400000,
    id = await join(q, at)
  await capture(
    q,
    at + 60000,
    "UPDATE queue_entry SET status='completed',called_at=?,version=version+1 WHERE id=?",
    [at + 60000, id],
    'staff.call',
  )
  await flush(at + 120000)
  expect(
    await env.DB.prepare(
      'SELECT generated,completed,wait_sum_ms,wait_samples FROM metrics_daily',
    ).first(),
  ).toEqual({ generated: 1, completed: 1, wait_sum_ms: 60000, wait_samples: 1 })
  // State replacements remove the old result instead of counting another generated entry.
  await capture(
    q,
    at + 180000,
    "UPDATE queue_entry SET status='expired',version=version+1 WHERE id=?",
    [id],
  )
  await capture(
    q,
    at + 240000,
    "UPDATE queue_entry SET status='waiting',called_at=NULL,version=version+1 WHERE id=?",
    [id],
  )
  await capture(
    q,
    now,
    "UPDATE queue_entry SET status='called',called_at=?,version=version+1 WHERE id=?",
    [now, id],
  )
  await flush()
  const rows = await env.DB.prepare(
    'SELECT SUM(generated) generated,SUM(completed) completed,SUM(no_show) no_show,SUM(pending) pending,SUM(wait_sum_ms) wait_sum_ms FROM metrics_daily',
  ).first()
  expect(rows).toEqual({
    generated: 1,
    completed: 0,
    no_show: 0,
    pending: 1,
    wait_sum_ms: 60000,
  })
})
it('integrates real people-time, size changes, zero intervals and queues with no new events', async () => {
  const q = await fixture(),
    at = Date.parse('2026-10-13T08:00:00Z'),
    id = await join(q, at, 2)
  await capture(
    q,
    at + 900000,
    'UPDATE queue_entry SET party_size=4,version=version+1 WHERE id=?',
    [id],
  )
  await capture(
    q,
    at + 1800000,
    "UPDATE queue_entry SET status='called',called_at=?,version=version+1 WHERE id=?",
    [at + 1800000, id],
  )
  await flush(at + 3600000)
  expect(
    await env.DB.prepare(
      'SELECT people_ms,observed_ms FROM metrics_hourly WHERE generated=1',
    ).first(),
  ).toEqual({ people_ms: 2 * 900000 + 4 * 900000, observed_ms: 3600000 })
  await flush(at + 7200000)
  expect(
    await env.DB.prepare(
      'SELECT SUM(people_ms) people_ms,SUM(observed_ms) observed_ms FROM metrics_hourly',
    ).first(),
  ).toEqual({ people_ms: 5400000, observed_ms: 7200000 })
})
it('fences simultaneous runners and resumes bounded work without double counting', async () => {
  const q = await fixture()
  await join(q, now - 60000)
  await join(q, now - 30000)
  const results = await Promise.all([
    processMetrics(enabled, now, 1),
    processMetrics(enabled, now, 1),
  ])
  expect(results.some((r) => r.busy)).toBe(true)
  await flush()
  expect(
    (await env.DB.prepare('SELECT SUM(generated) n FROM metrics_daily').first<{
      n: number
    }>())!.n,
  ).toBe(2)
  await env.DB.prepare('UPDATE metrics_control SET lease_token=?,lease_until=?')
    .bind('old', Date.now() - 1)
    .run()
  expect((await processMetrics(enabled, now)).busy).toBe(false)
})
it('backfills only evidence and never overwrites a live captured revision', async () => {
  const q = await fixture(),
    id = await join(q, now - 60000)
  await backfillMetricsQueue(enabled, q, now)
  await backfillMetricsQueue(enabled, q, now)
  await capture(
    q,
    now,
    "UPDATE queue_entry SET status='cancelled',version=version+1 WHERE id=?",
    [id],
    'customer.cancel',
  )
  await flush()
  expect(
    await env.DB.prepare(
      'SELECT generated,cancelled,historical FROM metrics_daily',
    ).first(),
  ).toEqual({ generated: 1, cancelled: 1, historical: 0 })
})
it('preserves pending/reopenable state and unprocessed events when purging', async () => {
  const q = await fixture(),
    at = now - 100 * 86400000,
    id = await join(q, at)
  await capture(
    q,
    at + 60000,
    "UPDATE queue_entry SET status='expired',called_at=?,version=version+1 WHERE id=?",
    [at + 60000, id],
  )
  await flush(at + 60000)
  await purgeMetrics(enabled, now)
  expect(
    await env.DB.prepare('SELECT entry_id FROM metrics_entry WHERE entry_id=?')
      .bind(id)
      .first(),
  ).not.toBeNull()
  await capture(
    q,
    now,
    "UPDATE queue_entry SET status='waiting',called_at=NULL,version=version+1 WHERE id=?",
    [id],
  )
  await purgeMetrics(enabled, now + 100 * 86400000)
  expect(
    (await env.DB.prepare('SELECT COUNT(*) n FROM metrics_event').first<{
      n: number
    }>())!.n,
  ).toBe(1)
})
it('enforces role and tenant scope before reading analytics', async () => {
  await expect(
    readMetrics(
      enabled,
      { id: 'nobody', role: 'viewer' },
      { from: '2026-10-01', to: '2026-10-13', page: 1 },
      now,
    ),
  ).rejects.toMatchObject({ status: 403 })
  await expect(
    readMetrics(
      enabled,
      { id: 'nobody', role: 'commercial_operator' },
      { from: '2026-10-01', to: '2026-10-13', venueId: 'demo-venue', page: 1 },
      now,
    ),
  ).rejects.toMatchObject({ status: 404 })
  const measured = profileD1(enabled)
  const result = await readMetrics(
    measured.env,
    { id: 'nobody', role: 'commercial_operator' },
    { from: '2026-10-01', to: '2026-10-13', page: 1 },
    now,
  )
  expect(result.coverage.status).toBe('unavailable')
  expect(
    measured.costs.some((c) =>
      /queue_entry|queue_event|queue_projection/.test(c.sql),
    ),
  ).toBe(false)
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
it('aggregates a ten-venue scenario and keeps range reads bounded at 10x unrelated history', async () => {
  const owner = await tenantOwner(),
    at = now - 86400000
  const queues: string[] = []
  for (let i = 0; i < 10; i++) {
    const v = crypto.randomUUID(),
      q = crypto.randomUUID()
    queues.push(q)
    await env.DB.prepare(
      "INSERT INTO venue(id,organization_id,name) VALUES(?,'demo-org',?)",
    )
      .bind(v, `Venue ${i}`)
      .run()
    await env.DB.prepare(
      "INSERT INTO queue(id,venue_id,name,capacity,average_minutes,config) VALUES(?,?,'Metrics',100,10,?)",
    )
      .bind(q, v, JSON.stringify({ type: 'restaurant' }))
      .run()
    const id = await join(q, at, 2)
    await capture(
      q,
      at + 60000,
      "UPDATE queue_entry SET status='completed',called_at=?,version=version+1 WHERE id=?",
      [at + 60000, id],
    )
  }
  const writeProfile = profileD1(enabled)
  await processMetrics(writeProfile.env, now)
  await flush()
  const reads: number[] = []
  for (const count of [100, 1000]) {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
      INSERT OR IGNORE INTO metrics_daily(dimension,queue_id,venue_id,organization_id,service_type,timezone,date)
      SELECT 'unrelated:'||i,?,'demo-venue','demo-org','restaurant','Europe/Madrid','2025-11-01' FROM n`,
    )
      .bind(count, queues[0]!)
      .run()
    const profile = profileD1(enabled)
    const result = await readMetrics(
      profile.env,
      { id: owner, role: 'commercial_operator' },
      { from: '2026-10-13', to: '2026-10-13', page: 1 },
      now,
    )
    expect(result.summary).toMatchObject({
      generated: 10,
      completed: 10,
      activeServices: 10,
      activeVenues: 10,
      meanWaitMs: 60000,
      attentionRate: 100,
    })
    expect(result.venues.items).toHaveLength(10)
    expect(result.trend).toEqual([
      { date: '2026-10-13', generated: 10, completed: 10 },
    ])
    reads.push(profile.costs.reduce((n, c) => n + c.rowsRead, 0))
    expect(profile.costs.every((c) => c.rowsWritten === 0)).toBe(true)
  }
  expect(reads[1]).toBe(reads[0])
  console.info({
    event: 'metrics_cost_local',
    venues: 10,
    rangeRowsRead: reads,
    processorRowsRead: writeProfile.costs.reduce((s, c) => s + c.rowsRead, 0),
    processorRowsWritten: writeProfile.costs.reduce(
      (s, c) => s + c.rowsWritten,
      0,
    ),
    sqlDurationMs: writeProfile.costs.reduce((s, c) => s + c.durationMs, 0),
  })
})
it('includes suspended venues, revalidates portfolio ownership and validates ranges', async () => {
  const owner = await tenantOwner(),
    q = await fixture()
  await join(q, now - 86400000)
  await flush()
  await env.DB.prepare(
    "UPDATE tenant_account SET status='suspended' WHERE organization_id='demo-org'",
  ).run()
  const input = {
    from: '2026-10-13',
    to: '2026-10-13',
    venueId: 'demo-venue',
    page: 1,
  }
  expect(
    (
      await readMetrics(
        enabled,
        { id: owner, role: 'commercial_operator' },
        input,
        now,
      )
    ).summary.generated,
  ).toBe(1)
  await tenantOwner()
  await expect(
    readMetrics(
      enabled,
      { id: owner, role: 'commercial_operator' },
      input,
      now,
    ),
  ).rejects.toMatchObject({ status: 404 })
  expect(
    (
      await readMetrics(
        enabled,
        { id: owner, role: 'platform_admin' },
        input,
        now,
      )
    ).summary.generated,
  ).toBe(1)
  await expect(
    readMetrics(
      enabled,
      { id: owner, role: 'platform_admin' },
      { ...input, from: '2024-01-01' },
      now,
    ),
  ).rejects.toMatchObject({ status: 400 })
})
it('captures through the real shared transition boundary, including two-entry handoff', async () => {
  const { loadQueueState, commitQueueTransition } = await import(
    '../queue/projection'
  )
  const q = await fixture(),
    a = await join(q, now - 60000),
    b = await join(q, now - 30000)
  await capture(
    q,
    now - 20000,
    "UPDATE queue_entry SET status='called',called_at=?,version=version+1 WHERE id=?",
    [now - 20000, a],
  )
  const state = await loadQueueState(enabled, q, now)
  await commitQueueTransition(
    enabled,
    q,
    state,
    {},
    [
      env.DB.prepare(
        "UPDATE queue_entry SET status='waiting',called_at=NULL,version=version+1 WHERE id=?",
      ).bind(a),
      env.DB.prepare(
        "UPDATE queue_entry SET status='called',called_at=?,version=version+1 WHERE id=?",
      ).bind(now, b),
    ],
    now,
    'customer.yield',
  )
  await flush()
  const events = await env.DB.prepare(
    "SELECT entry_id,origin FROM metrics_event WHERE origin='customer.yield' ORDER BY entry_id",
  ).all()
  expect(events.results).toHaveLength(2)
  expect(
    await env.DB.prepare(
      'SELECT SUM(generated) generated,SUM(wait_samples) samples FROM metrics_daily',
    ).first(),
  ).toEqual({ generated: 2, samples: 2 })
})

it('corrects a reopenable cohort after detail retention without rebuilding its old aggregate', async () => {
  const q = await fixture(),
    at = now - 100 * 86400000,
    id = await join(q, at)
  await capture(
    q,
    at + 60000,
    "UPDATE queue_entry SET status='expired',called_at=?,version=version+1 WHERE id=?",
    [at + 60000, id],
  )
  await flush(at + 60000)
  await purgeMetrics(enabled, now)
  // Represents the balance carried by intervening scheduled cuts (expired = zero waiting).
  await env.DB.prepare('UPDATE metrics_queue SET integrated_at=?')
    .bind(now - 60000)
    .run()
  await capture(
    q,
    now,
    "UPDATE queue_entry SET status='waiting',called_at=NULL,version=version+1 WHERE id=?",
    [id],
  )
  await flush()
  expect(
    await env.DB.prepare(
      'SELECT SUM(generated) generated,SUM(no_show) no_show,SUM(pending) pending,SUM(wait_samples) wait_samples FROM metrics_daily',
    ).first(),
  ).toEqual({ generated: 1, no_show: 0, pending: 1, wait_samples: 1 })
})
it('keeps events after a frozen cut for the next run', async () => {
  const q = await fixture()
  await join(q, now)
  await processMetrics(enabled, now - 30000)
  expect(
    await env.DB.prepare(
      'SELECT cursor,last_complete_at FROM metrics_control',
    ).first(),
  ).toEqual({ cursor: 0, last_complete_at: now - 30000 })
  await flush()
  expect(
    (await env.DB.prepare(
      'SELECT SUM(generated) generated FROM metrics_daily',
    ).first<{ generated: number }>())!.generated,
  ).toBe(1)
})

it.each(['before', 'after'] as const)(
  'recovers a failure %s the contribution commit',
  async (mode) => {
    const q = await fixture()
    await join(q, now - 60000)
    let batches = 0
    const DB = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            batches++
            if (batches === 2 && mode === 'before')
              throw new Error('test_interruption')
            const result = await target.batch(statements)
            if (batches === 2 && mode === 'after')
              throw new Error('test_interruption')
            return result
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    await expect(processMetrics({ ...enabled, DB }, now)).rejects.toThrow(
      'test_interruption',
    )
    await flush()
    expect(
      await env.DB.prepare(
        'SELECT SUM(generated) generated,SUM(pending) pending FROM metrics_daily',
      ).first(),
    ).toEqual({ generated: 1, pending: 1 })
  },
)
it('rolls back a stale worker batch after another owner takes the lease', async () => {
  const q = await fixture()
  await join(q, now - 60000)
  let batches = 0
  const DB = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          if (++batches === 2)
            await target
              .prepare(
                "UPDATE metrics_control SET lease_token='new-owner',lease_until=?",
              )
              .bind(Date.now() + 60000)
              .run()
          return target.batch(statements)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  await expect(processMetrics({ ...enabled, DB }, now)).rejects.toThrow()
  expect(
    await env.DB.prepare('SELECT COUNT(*) n FROM metrics_daily').first(),
  ).toEqual({ n: 0 })
  expect(
    await env.DB.prepare('SELECT lease_token FROM metrics_control').first(),
  ).toEqual({ lease_token: 'new-owner' })
  await env.DB.prepare('UPDATE metrics_control SET lease_until=0').run()
  await flush()
  expect(
    await env.DB.prepare('SELECT SUM(generated) n FROM metrics_daily').first(),
  ).toEqual({ n: 1 })
})
it('repairs status changes across a deliberate capture gap and marks history incomplete', async () => {
  const { recordCaptureState } = await import('./reconcile')
  const owner = await tenantOwner(),
    q = await fixture(),
    id = await join(q, now - 3600000)
  await backfillMetricsQueue(enabled, q, now - 3500000)
  await backfillMetricsQueue(enabled, q, now - 3500000)
  await flush(now - 3400000)
  await recordCaptureState(
    { ...enabled, METRICS_CAPTURE_ENABLED: 'false' },
    now - 3000000,
  )
  await env.DB.prepare(
    "UPDATE queue_entry SET status='cancelled',version=version+1 WHERE id=?",
  )
    .bind(id)
    .run()
  await recordCaptureState(enabled, now - 1000000)
  await backfillMetricsQueue(enabled, q, now - 900000)
  await backfillMetricsQueue(enabled, q, now - 900000)
  await flush()
  const response = await readMetrics(
    enabled,
    { id: owner, role: 'platform_admin' },
    { from: '2026-10-14', to: '2026-10-14', page: 1 },
    now,
  )
  expect(response.summary).toMatchObject({
    generated: 1,
    cancelled: 1,
    pending: 0,
  })
  expect(response.coverage.status).toBe('partial')
})

it('drains multiple queue pages within one quarter-hour invocation', async () => {
  const { runMetricsCut } = await import('./processor')
  for (let i = 0; i < 21; i++) {
    const q = await fixture()
    await join(q, now - 60000)
  }
  await runMetricsCut(enabled, now)
  expect(
    await env.DB.prepare(
      'SELECT last_complete_at,target_at FROM metrics_control',
    ).first(),
  ).toEqual({ last_complete_at: now, target_at: null })
  expect(
    await env.DB.prepare(
      'SELECT COUNT(*) n FROM metrics_queue WHERE integrated_at=?',
    )
      .bind(now)
      .first(),
  ).toEqual({ n: 21 })
})

it('imports genuinely uncaptured history without inventing type, wait or occupancy', async () => {
  const owner = await tenantOwner(),
    q = await fixture(),
    id = await join(q, now - 86400000)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM metrics_event'),
    env.DB.prepare('DELETE FROM metrics_identity'),
    env.DB.prepare("UPDATE queue_entry SET status='served' WHERE id=?").bind(
      id,
    ),
  ])
  await backfillMetricsQueue(enabled, q, now)
  await backfillMetricsQueue(enabled, q, now)
  await flush()
  const result = await readMetrics(
    enabled,
    { id: owner, role: 'platform_admin' },
    { from: '2026-10-13', to: '2026-10-13', page: 1 },
    now,
  )
  expect(result.summary).toMatchObject({
    generated: 1,
    completed: 1,
    waitSamples: 0,
    meanWaitMs: null,
  })
  expect(result.coverage).toMatchObject({
    status: 'partial',
    historical: true,
    occupancy: 'unavailable',
  })
  expect(
    result.services.find((s) => s.serviceType === 'unknown')?.generated,
  ).toBe(1)
  expect(result.patterns.overall.peakQueuePeople).toBeNull()
})
it('repairs an old active balance even when its cohort is outside aggregate retention', async () => {
  const q = await fixture(),
    at = now - 430 * 86400000,
    id = await join(q, at)
  await flush(at)
  await purgeMetrics(enabled, now)
  // State survives retention while the cohort aggregate does not.
  await env.DB.prepare('UPDATE metrics_queue SET integrated_at=?')
    .bind(now)
    .run()
  await env.DB.prepare(
    "UPDATE queue_entry SET status='cancelled',version=version+1 WHERE id=?",
  )
    .bind(id)
    .run()
  await backfillMetricsQueue(enabled, q, now)
  await backfillMetricsQueue(enabled, q, now)
  await flush()
  expect(
    await env.DB.prepare('SELECT people FROM metrics_queue WHERE queue_id=?')
      .bind(q)
      .first(),
  ).toEqual({ people: 0 })
  expect(
    await env.DB.prepare('SELECT SUM(generated) n FROM metrics_daily').first(),
  ).toEqual({ n: null })
})

it('uses null series points for dates before any analytical coverage', async () => {
  const owner = await tenantOwner(),
    q = await fixture()
  await join(q, now)
  await flush()
  const result = await readMetrics(
    enabled,
    { id: owner, role: 'platform_admin' },
    { from: '2026-10-13', to: '2026-10-14', page: 1 },
    now,
  )
  expect(result.trend).toEqual([
    { date: '2026-10-13', generated: null, completed: null },
    { date: '2026-10-14', generated: 1, completed: 0 },
  ])
})
