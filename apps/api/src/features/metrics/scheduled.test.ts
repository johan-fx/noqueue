import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import worker from '../../index'
import { backfillMetricsQueue } from './backfill'

const controller = { cron: '*/15 * * * *' } as ScheduledController

it('runs the analytical trigger through backfill and a real cut without operational work', async () => {
  const enabled = { ...env, METRICS_CAPTURE_ENABLED: 'true' }
  const backfill = vi.fn((id: string) => backfillMetricsQueue(enabled, id))
  // Deliberately no refresh(): analytics must not enter queue maintenance.
  const jurisdiction = vi.fn()
  const coordinator = {
    jurisdiction,
    getByName: () => ({ metricsBackfill: backfill }),
  } as unknown as CloudflareBindings['QUEUE_COORDINATOR']
  jurisdiction.mockReturnValue(coordinator)
  const before = await env.DB.prepare('SELECT * FROM queue_entry ORDER BY id').all()
  await worker.scheduled(controller, { ...enabled, APP_ENV: 'staging', QUEUE_COORDINATOR: coordinator })
  expect(jurisdiction).toHaveBeenCalledWith('eu')
  expect(backfill).toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT last_complete_at,target_at FROM metrics_control').first())
    .toEqual({ last_complete_at: expect.any(Number), target_at: null })
  expect(await env.DB.prepare('SELECT * FROM queue_entry ORDER BY id').all())
    .toMatchObject({ results: before.results })
})

it('keeps the minute trigger operational without running an analytical cut', async () => {
  const before = await env.DB.prepare('SELECT cursor,last_complete_at FROM metrics_control').first()
  const backfill = vi.fn(() => { throw new Error('unexpected analytical backfill') })
  const coordinator = {
    getByName: () => ({ refresh: vi.fn(), metricsBackfill: backfill }),
  } as unknown as CloudflareBindings['QUEUE_COORDINATOR']
  await worker.scheduled({ cron: '* * * * *' } as ScheduledController, {
    ...env, METRICS_CAPTURE_ENABLED: 'true', QUEUE_COORDINATOR: coordinator,
  })
  expect(backfill).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT cursor,last_complete_at FROM metrics_control').first()).toEqual(before)
})

it('records a capture gap but does not backfill or cut when capture is disabled', async () => {
  const previous = await env.DB.prepare('SELECT cursor,last_complete_at FROM metrics_control').first()
  const getByName = vi.fn(() => { throw new Error('unexpected coordinator call') })
  await worker.scheduled(controller, {
    ...env,
    METRICS_CAPTURE_ENABLED: 'false',
    QUEUE_COORDINATOR: { getByName } as unknown as CloudflareBindings['QUEUE_COORDINATOR'],
  })
  expect(getByName).not.toHaveBeenCalled()
  expect(await env.DB.prepare('SELECT cursor,last_complete_at FROM metrics_control').first()).toEqual(previous)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM metrics_capture_gap WHERE ended_at IS NULL').first())
    .toEqual({ n: 1 })
})
