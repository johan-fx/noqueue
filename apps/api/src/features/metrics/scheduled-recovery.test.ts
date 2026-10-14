import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import worker from '../../index'
import { backfillMetricsQueue } from './backfill'
import { recoverScheduledMetrics } from './scheduled'

const now = Date.parse('2026-10-14T19:00:00Z')
const enabled = { ...env, APP_ENV: 'staging', METRICS_CAPTURE_ENABLED: 'true', METRICS_CRON_RECOVERY_ENABLED: 'true' }
const minute = { cron: '* * * * *' } as ScheduledController
let backfill: ReturnType<typeof vi.fn>
let bindings: CloudflareBindings
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  await env.DB.batch(['metrics_event', 'metrics_identity', 'metrics_entry', 'metrics_queue', 'metrics_daily', 'metrics_hourly', 'metrics_backfill', 'metrics_capture_gap', 'metrics_fence', 'metrics_dirty'].map(t => env.DB.prepare(`DELETE FROM ${t}`)))
  await env.DB.prepare("UPDATE metrics_control SET cursor=0,lease_token=NULL,lease_until=0,last_complete_at=NULL,target_at=NULL,target_seq=NULL,integrate_after=''").run()
  backfill = vi.fn((id: string) => backfillMetricsQueue(enabled, id))
  const coordinator = { jurisdiction: vi.fn(), getByName: () => ({ metricsBackfill: backfill, refresh: vi.fn() }) }
  coordinator.jurisdiction.mockReturnValue(coordinator)
  bindings = { ...enabled, QUEUE_COORDINATOR: coordinator as unknown as CloudflareBindings['QUEUE_COORDINATOR'] }
})
afterEach(() => vi.restoreAllMocks())
async function ready(last = now - 30000) {
  await env.DB.prepare("INSERT INTO metrics_backfill(queue_id,started_at,completed_at) SELECT id,?,? FROM queue WHERE id!='confirmation-experiment'").bind(now - 120000, now - 60000).run()
  await env.DB.prepare('UPDATE metrics_control SET last_complete_at=?').bind(last).run()
}

it.each(['production', 'sandbox', 'local'])('never recovers in %s even if the flag is accidentally enabled', async (APP_ENV) => {
  const prepare = vi.fn(() => { throw new Error('must not access DB') })
  await recoverScheduledMetrics({ ...bindings, APP_ENV, DB: { prepare } as unknown as D1Database })
  expect(prepare).not.toHaveBeenCalled()
})
it('has no database overhead without explicit opt-in', async () => {
  const prepare = vi.fn(() => { throw new Error('must not access DB') })
  const disabled = { ...bindings, DB: { prepare } as unknown as D1Database }
  delete disabled.METRICS_CRON_RECOVERY_ENABLED
  await recoverScheduledMetrics(disabled)
  expect(prepare).not.toHaveBeenCalled()
})
it.each(['800', '64'])('starts a missing cut with capped budget, respecting a configured %s limit', async (limit) => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  await recoverScheduledMetrics({ ...bindings, METRICS_D1_QUERY_BUDGET: limit })
  expect(backfill).toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'metrics_cut', complete: true, queryLimit: Math.min(256, Number(limit)) }))
  expect(await env.DB.prepare('SELECT last_complete_at FROM metrics_control').first()).toEqual({ last_complete_at: now - 30000 })
})
it('does not recut a fresh, fully imported snapshot until 15 minutes have elapsed', async () => {
  await ready()
  await recoverScheduledMetrics(bindings)
  expect(backfill).not.toHaveBeenCalled()
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(Date, 'now').mockReturnValue(now + 15 * 60000)
  await recoverScheduledMetrics(bindings)
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'metrics_cut', complete: true }))
})
it('resumes an incomplete cut on the next minute', async () => {
  await ready()
  await env.DB.prepare('UPDATE metrics_control SET target_at=?,target_seq=0').bind(now - 30000).run()
  await recoverScheduledMetrics(bindings)
  expect(await env.DB.prepare('SELECT target_at FROM metrics_control').first()).toEqual({ target_at: null })
})
it('continues unfinished backfill despite a recent complete cut', async () => {
  await ready()
  await env.DB.prepare('UPDATE metrics_backfill SET completed_at=NULL').run()
  await recoverScheduledMetrics(bindings)
  expect(backfill).toHaveBeenCalled()
})
it('drains the final historical batch after backfill completes, then returns to the normal cadence', async () => {
  await ready()
  await env.DB.prepare('UPDATE metrics_backfill SET completed_at=?').bind(now - 10000).run()
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(Date, 'now').mockReturnValue(now + 60000)
  await recoverScheduledMetrics(bindings)
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'metrics_cut', complete: true }))
  log.mockClear()
  await recoverScheduledMetrics(bindings)
  expect(log).not.toHaveBeenCalled()
})
it('records disabled capture without running a cut', async () => {
  await recoverScheduledMetrics({ ...bindings, METRICS_CAPTURE_ENABLED: 'false' })
  expect(backfill).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT last_complete_at FROM metrics_control').first()).toEqual({ last_complete_at: null })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM metrics_capture_gap WHERE ended_at IS NULL').first()).toEqual({ n: 1 })
})
it('finishes operational cleanup before analytics and contains analytics errors', async () => {
  await env.DB.prepare('INSERT INTO rateLimit(id,key,count,lastRequest) VALUES(?,?,1,0)').bind('metrics-order', 'metrics-order').run()
  backfill.mockImplementation(async () => {
    expect(await env.DB.prepare("SELECT id FROM rateLimit WHERE id='metrics-order'").first()).toBeNull()
    throw new Error('analytics unavailable')
  })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(worker.scheduled(minute, bindings)).resolves.toBeUndefined()
  expect(backfill).toHaveBeenCalled()
  expect(error).toHaveBeenCalledWith({ event: 'metrics_cron_recovery_failed' })
  expect(await env.DB.prepare('SELECT last_complete_at FROM metrics_control').first()).toEqual({ last_complete_at: null })
})
it('ignores a late dedicated trigger while staging recovery owns scheduling', async () => {
  await worker.scheduled({ cron: '*/15 * * * *' } as ScheduledController, bindings)
  expect(backfill).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT last_complete_at FROM metrics_control').first()).toEqual({ last_complete_at: null })
})
