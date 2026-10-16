import { cleanupPrivacyConsents, cleanupPrivacyLimits } from './features/privacy/routes'
import { configurationContext } from './features/staff/configuration-context'
import { recoverScheduledMetrics, runScheduledMetrics, stagingMetricsRecoveryEnabled } from './features/metrics/scheduled'
import { backfillMetricsQueue } from './features/metrics/backfill'
import { backfillDirectoryConfigs } from './features/discovery/configuration'
import { cleanupVenueLogos } from './features/staff/logo'
import {
  runCustomerCommand,
  runWhatsAppAction,
} from './features/queue/customer'
import type { CustomerCommand } from '@noqueue/contracts/queue'
import { openingContext, runLifecycleCommand } from './features/staff/opening'
import type { QueueLifecycleCommand } from '@noqueue/contracts/staff'
import {
  recalculateQueue,
  maintainQueue,
  refreshQueue,
} from './features/queue/projection'
import { HTTPException } from 'hono/http-exception'
import type { QueueCommand } from '@noqueue/contracts/staff'
import { runQueueCommand, configureQueue } from './features/staff/commands'
import { DurableObject } from 'cloudflare:workers'
import type { JoinQueue, ManualJoin } from '@noqueue/contracts/queue'
import { app } from './app'
import { confirmationExperimentEnabled } from './features/queue/confirmation'
import { changeExperiment } from './features/queue/experiment'
import {
  joinQueue,
  readEntrySnapshot,
  type JoinSource,
} from './features/queue/entries'
import {
  dispatchNotification,
  dispatchNotificationSerialized,
  jobSchema,
  processWebhook,
  reconcile,
} from './features/queue/notifications'
import { handleWorkerRequest } from './static-assets'

export class QueueCoordinator extends DurableObject<CloudflareBindings> {
  private tail: Promise<unknown> = Promise.resolve()
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => undefined)
    return result
  }
  private async withQueue<T>(queueId: string, work: () => Promise<T>) {
    await this.ctx.storage.put('queueId', queueId)
    await maintainQueue(this.env, queueId)
    try {
      return await work()
    } finally {
      const now = Date.now()
      const next = await this.env.DB.prepare(
        `WITH adaptive AS (
          SELECT MIN(deadline) AS deadline FROM (
            SELECT a.safety_review_at AS deadline
              FROM queue_entry e
              JOIN queue_projection p ON p.entry_id=e.id AND p.estimator_version=2
              JOIN queue_adaptive_projection a ON a.entry_id=e.id AND a.safety_review_at IS NOT NULL
              JOIN queue_cadence_state c ON c.queue_id=e.queue_id AND c.estimator_version=2 AND c.episode_id IS NOT NULL
              WHERE e.queue_id=? AND e.status='waiting'
            UNION ALL SELECT a.predicted_at - CAST(COALESCE(json_extract(CASE WHEN json_valid(q.config) THEN q.config ELSE '{}' END,'$.approachMinutes'),10)*60000 AS INTEGER) AS deadline
              FROM queue_entry e
              JOIN queue q ON q.id=e.queue_id
              JOIN queue_projection p ON p.entry_id=e.id AND p.estimator_version=2
              JOIN queue_adaptive_projection a ON a.entry_id=e.id AND a.approach_armed=1
              JOIN queue_cadence_state c ON c.queue_id=e.queue_id AND c.estimator_version=2 AND c.episode_id IS NOT NULL
              WHERE e.queue_id=? AND e.status='waiting'
                AND a.predicted_at - CAST(COALESCE(json_extract(CASE WHEN json_valid(q.config) THEN q.config ELSE '{}' END,'$.approachMinutes'),10)*60000 AS INTEGER)>?
            UNION ALL SELECT n.last_correction_accepted_at + CAST(COALESCE(json_extract(CASE WHEN json_valid(q.config) THEN q.config ELSE '{}' END,'$.notificationCooldownMinutes'),10)*60000 AS INTEGER) AS deadline
              FROM queue_entry e
              JOIN queue q ON q.id=e.queue_id
              JOIN queue_projection p ON p.entry_id=e.id AND p.estimator_version=2
              JOIN queue_adaptive_projection a ON a.entry_id=e.id AND a.correction_reason IS NOT NULL
              JOIN queue_cadence_state c ON c.queue_id=e.queue_id AND c.estimator_version=2 AND c.episode_id IS NOT NULL
              JOIN queue_notification_state n ON n.entry_id=e.id AND n.last_correction_accepted_at IS NOT NULL
              WHERE e.queue_id=? AND e.status='waiting'
                AND n.last_correction_accepted_at + CAST(COALESCE(json_extract(CASE WHEN json_valid(q.config) THEN q.config ELSE '{}' END,'$.notificationCooldownMinutes'),10)*60000 AS INTEGER)>?
          )
        )
        SELECT MIN(deadline) AS deadline FROM (
          SELECT arrival_deadline_at AS deadline FROM queue_entry WHERE queue_id=? AND status='called'
          UNION ALL SELECT service_ends_at AS deadline FROM queue_entry WHERE queue_id=? AND status='waiting'
          UNION ALL SELECT deadline FROM adaptive
        )`,
      )
        .bind(queueId, queueId, now, queueId, now, queueId, queueId)
        .first<{ deadline: number | null }>()
      if (next?.deadline != null)
        await this.ctx.storage.setAlarm(Math.max(now + 1, next.deadline))
      else await this.ctx.storage.deleteAlarm()
    }
  }
  async alarm() {
    const queueId = await this.ctx.storage.get<string>('queueId')
    if (queueId)
      await this.serialize(() =>
        this.withQueue(queueId, () => recalculateQueue(this.env, queueId)),
      )
  }
  customerCommand(
    queueId: string,
    token: string,
    key: string,
    input: CustomerCommand,
  ) {
    return this.serialize(() =>
      this.withQueue(queueId, () =>
        this.staffResult(() =>
          runCustomerCommand(this.env, queueId, token, key, input),
        ),
      ),
    )
  }
  whatsappAction(queueId: string, webhookEventId: string) {
    return this.serialize(() =>
      this.withQueue(queueId, () =>
        runWhatsAppAction(this.env, queueId, webhookEventId),
      ),
    )
  }
  private async staffResult(work: () => Promise<{ ok: boolean }>) {
    try {
      return { status: 200, body: await work() }
    } catch (error) {
      if (error instanceof HTTPException)
        return { status: error.status, body: { error: error.message } }
      console.error('staff_command_failed')
      return { status: 503, body: { error: 'temporarily_unavailable' } }
    }
  }
  staffCommand(
    actor: string,
    queueId: string,
    key: string,
    input: QueueCommand,
  ) {
    return this.serialize(() =>
      this.withQueue(queueId, () =>
        this.staffResult(() =>
          runQueueCommand(this.env, actor, queueId, key, input),
        ),
      ),
    )
  }
  staffConfigure(actor: string, queueId: string, input: unknown) {
    return this.serialize(() =>
      this.withQueue(queueId, () =>
        this.staffResult(() => configureQueue(this.env, actor, queueId, input)),
      ),
    )
  }
  configurationContext(actor: string, queueId: string) {
    return this.serialize(() =>
      this.withQueue(queueId, () => configurationContext(this.env, actor, queueId)),
    )
  }
  openingContext(queueId: string) {
    return this.serialize(() =>
      this.withQueue(queueId, async () => {
        // Finish lazy activation before exposing the versioned intent. Otherwise
        // the first dashboard poll can invalidate it without any staff change.
        // Do not coalesce here; stale intents must still fail in lifecycle().
        await recalculateQueue(this.env, queueId)
        return openingContext(this.env, queueId)
      }),
    )
  }
  lifecycle(
    actor: string,
    queueId: string,
    key: string,
    input: QueueLifecycleCommand,
  ) {
    return this.serialize(() =>
      this.withQueue(queueId, () =>
        this.staffResult(() =>
          runLifecycleCommand(this.env, actor, queueId, key, input),
        ),
      ),
    )
  }
  read(queueId: string, token: string) {
    return this.serialize(() =>
      this.withQueue(queueId, async () => {
        await refreshQueue(this.env, queueId)
        return readEntrySnapshot(this.env, token)
      }),
    )
  }
  refresh(queueId: string) {
    return this.serialize(() =>
      this.withQueue(queueId, async () => {
        await refreshQueue(this.env, queueId)
        return { ok: true }
      }),
    )
  }
  metricsBackfill(queueId: string) {
    return this.serialize(() => backfillMetricsQueue(this.env, queueId))
  }
  experiment(action: 'seed' | 'advance', key: string) {
    return this.serialize(() => changeExperiment(this.env, action, key))
  }
  dispatch(id: string) {
    return this.serialize(async () => {
      const row = await this.env.DB.prepare(
        'SELECT e.queue_id FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE n.id=?',
      )
        .bind(id)
        .first<{ queue_id: string }>()
      if (row)
        return this.withQueue(row.queue_id, () =>
          dispatchNotificationSerialized(this.env, id),
        )
      return dispatchNotificationSerialized(this.env, id)
    })
  }

  staffJoin(actor: string, queueId: string, key: string, input: ManualJoin) {
    return this.serialize(async () => {
      try {
        return await this.withQueue(queueId, () =>
          joinQueue(this.env, queueId, key, input, false, actor),
        )
      } catch (error) {
        if (error instanceof HTTPException)
          return { status: error.status, body: { error: error.message } }
        console.error('staff_join_failed')
        return { status: 503, body: { error: 'temporarily_unavailable' } }
      }
    })
  }
  join(
    queueId: string,
    key: string,
    input: JoinQueue,
    experiment = false,
    source: JoinSource = 'legacy',
  ) {
    if (experiment && !confirmationExperimentEnabled(this.env))
      return Promise.resolve({ status: 404, body: { error: 'not_found' } })
    // D1 awaits permit interleaving. Chain entire joins, not individual database calls.
    return this.serialize(() =>
      this.withQueue(queueId, () =>
        joinQueue(this.env, queueId, key, input, experiment, undefined, source),
      ),
    )
  }
}
export default {
  fetch(
    request: Request,
    env: CloudflareBindings,
    executionCtx: ExecutionContext,
  ) {
    return handleWorkerRequest(
      request,
      (assetRequest) => env.ASSETS.fetch(assetRequest),
      (applicationRequest) => app.fetch(applicationRequest, env, executionCtx),
    )
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      const job = jobSchema.safeParse(message.body)
      if (!job.success) {
        message.ack()
        continue
      }
      try {
        if (job.data.kind === 'dispatch-notification')
          await dispatchNotification(env, job.data.notificationId)
        else await processWebhook(env, job.data.webhookEventId)
        message.ack()
      } catch {
        console.error('queue_job_failed')
        message.retry({ delaySeconds: 60 })
      }
    }
  },
  async scheduled(controller, env) {
    if (controller.cron === '*/15 * * * *') {
      try { await cleanupPrivacyLimits(env, controller.scheduledTime) } catch { console.error('privacy_rate_cleanup_failed') }
      // Once daily; bounded indexed maintenance, never in the queue hot path.
      const time = new Date(controller.scheduledTime)
      if (time.getUTCHours() === 3 && time.getUTCMinutes() === 0) {
        try { await cleanupPrivacyConsents(env, controller.scheduledTime) } catch { console.error('privacy_cleanup_failed') }
      }
      if (!stagingMetricsRecoveryEnabled(env)) await runScheduledMetrics(env)
      return
    }
    await backfillDirectoryConfigs(env)
    const queues = await env.DB.prepare(
      `SELECT q.id FROM queue q
       WHERE EXISTS(SELECT 1 FROM queue_entry e WHERE e.queue_id=q.id AND e.status IN ('waiting','called'))
       `,
    ).all<{ id: string }>()
    for (const queue of queues.results) {
      try {
        await (env.APP_ENV === 'local'
          ? env.QUEUE_COORDINATOR
          : env.QUEUE_COORDINATOR.jurisdiction('eu')
        )
          .getByName(queue.id)
          .refresh(queue.id)
      } catch {
        console.error({ event: 'service_expiry_refresh_failed', count: 1 })
      }
    }
    await reconcile(env)
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM staff_rate WHERE key IN (SELECT key FROM (SELECT key,CASE WHEN substr(key,1,8)='geocode:' THEN substr(key,9) ELSE key END AS normalized FROM staff_rate) WHERE CAST(substr(normalized,instr(normalized,':')+1) AS INTEGER) < ?)",
      ).bind(Math.floor(Date.now() / 60000) - 5),
      env.DB.prepare('DELETE FROM rateLimit WHERE lastRequest < ?').bind(
        Date.now() - 86400000,
      ),
      env.DB.prepare('DELETE FROM verification WHERE expiresAt < ?').bind(
        new Date(Date.now() - 86400000).toISOString(),
      ),
      env.DB.prepare('DELETE FROM session WHERE expiresAt < ?').bind(
        new Date().toISOString(),
      ),
    ])
    // Low-priority asset maintenance must not delay queue expiry/notifications.
    try { await cleanupVenueLogos(env) } catch { console.error('venue_logo_cleanup_failed') }
    if (controller.cron === '* * * * *') await recoverScheduledMetrics(env)
  },
} satisfies ExportedHandler<CloudflareBindings>
