import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { serviceWindow } from '../staff/availability'
import { topology } from './opening-state'

const service: ServiceInput = {
  name: 'Adaptive queue',
  type: 'restaurant',
  capacity: 20,
  averageMinutes: 4,
  graceMinutes: 5,
  cutoffMinutes: 0,
  twentyFourHours: true,
  schedules: [],
  receptionServices: [],
  spaces: [{ id: 'room', name: 'Room', tables: 1, tableTypes: [{ seats: 2, count: 1 }] }],
  approachMinutes: 4,
  notificationCooldownMinutes: 10,
}

it('schedules adaptive safety, approach and cooldown wakeups only for active waiting episodes', async () => {
  const { runInDurableObject } = await import('cloudflare:test')
  const now = Date.now()
  const queueId = crypto.randomUUID()
  const entryId = crypto.randomUUID()
  const actorId = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO queue(id,venue_id,capacity,average_minutes,name,config,open) VALUES (?,'demo-venue',20,4,?,?,1)",
    ).bind(queueId, service.name, JSON.stringify({ ...service, estimatorVersion: 2 })).run()
    const windowId = serviceWindow({ ...service, estimatorVersion: 2 }, 'Europe/Madrid', new Date(now)).windowId
    await env.DB.prepare(
      "INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)",
    ).bind(queueId, windowId, now).run()
    await env.DB.prepare(
      'INSERT INTO queue_opening(queue_id,topology,complete,opened_at,actor_id) VALUES (?,?,1,?,?)',
    ).bind(queueId, topology({ ...service, estimatorVersion: 2 }), now, actorId).run()
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,service_window_id) VALUES (?,?,?,?,?,?,2,'en',?,1,?)",
    ).bind(entryId, queueId, entryId, entryId, entryId, entryId, now, windowId).run()
    await env.DB.prepare(
      'INSERT INTO queue_projection(entry_id,position,eta_minutes,predicted_at,quality,revision,updated_at,estimator_version) VALUES (?,1,12,?,?,1,?,2)',
    ).bind(entryId, now + 12 * 60_000, 'provisional', now).run()
    await env.DB.prepare(
      'INSERT INTO queue_adaptive_projection(entry_id,predicted_at,cadence_ms,safety_review_at,approach_episode,approach_armed,correction_reason,safety_revision,notice_baseline_at) VALUES (?,?,120000,?,1,1,\'cadence\',0,?)',
    ).bind(entryId, now + 12 * 60_000, now + 60_000, now + 12 * 60_000).run()
    await env.DB.prepare(
      'INSERT INTO queue_cadence_state(queue_id,estimator_version,episode_id,episode_started_at,last_assignment_at,updated_at) VALUES (?,2,?,?,?,?)',
    ).bind(queueId, crypto.randomUUID(), now - 60_000, now - 60_000, now).run()
    await env.DB.prepare(
      'INSERT INTO queue_notification_state(entry_id,last_correction_accepted_at,updated_at) VALUES (?,?,?)',
    ).bind(entryId, now - 9 * 60_000, now).run()

  const stub = env.QUEUE_COORDINATOR.getByName(queueId)
  const runCoordinator = () =>
    runInDurableObject(stub, async (instance, state) => {
      const coordinator = instance as unknown as {
        withQueue: (id: string, work: () => Promise<void>) => Promise<void>
      }
      await coordinator.withQueue(queueId, async () => {
        // This test isolates estimator wakeups from the independent service-close alarm.
        await env.DB.prepare(
          'UPDATE queue_entry SET service_ends_at=NULL WHERE id=?',
        ).bind(entryId).run()
      })
      const alarm = await state.storage.getAlarm()
      // Test scheduling, not wall-clock execution while later assertions run.
      await state.storage.deleteAlarm()
      return alarm
    })

  // The safety review wins over the later approach boundary and cooldown.
  expect(await runCoordinator()).toBe(now + 60_000)

  await env.DB.prepare(
    'UPDATE queue_adaptive_projection SET safety_review_at=NULL,correction_reason=NULL WHERE entry_id=?',
  ).bind(entryId).run()
  expect(await runCoordinator()).toBe(now + 8 * 60_000)

  await env.DB.prepare(
    "UPDATE queue_adaptive_projection SET approach_armed=0,correction_reason='cadence' WHERE entry_id=?",
  ).bind(entryId).run()
  const cooldownAlarm = await runCoordinator()
  expect(cooldownAlarm).toBe(now + 60_000)

  // Pausing/closing the demand episode invalidates all estimator wakeups.
  await env.DB.prepare(
    'UPDATE queue_cadence_state SET episode_id=NULL WHERE queue_id=?',
  ).bind(queueId).run()
  expect(await runCoordinator()).toBeNull()

  // A delayed coordinator/restart must retry overdue safety work promptly,
  // rather than dropping the review deadline and leaving the timer at zero.
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE queue_cadence_state SET episode_id=? WHERE queue_id=?',
    ).bind(crypto.randomUUID(), queueId),
    env.DB.prepare(
      'UPDATE queue_adaptive_projection SET safety_review_at=? WHERE entry_id=?',
    ).bind(Date.now() - 10_000, entryId),
  ])
  const scheduledFrom = Date.now()
  const overdueRetry = await runCoordinator()
  expect(overdueRetry).not.toBeNull()
  expect(overdueRetry!).toBeGreaterThanOrEqual(scheduledFrom)
  expect(overdueRetry!).toBeLessThan(Date.now() + 1_000)
})
