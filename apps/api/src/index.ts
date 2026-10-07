import { maintainServiceEntries } from './features/queue/service-expiry'
import { backfillDirectoryConfigs } from './features/discovery/configuration'
import { runCustomerCommand, expireArrivals } from './features/queue/customer'
import type { CustomerCommand } from '@noqueue/contracts/queue'
import { openingContext, runLifecycleCommand } from './features/staff/opening'
import type { QueueLifecycleCommand } from '@noqueue/contracts/staff'
import { recalculateQueue } from './features/queue/projection'
import { HTTPException } from 'hono/http-exception'
import type { QueueCommand } from '@noqueue/contracts/staff'
import { runQueueCommand, configureQueue } from './features/staff/commands'
import { DurableObject } from 'cloudflare:workers'
import type { JoinQueue } from '@noqueue/contracts/queue'
import { app } from './app'
import { confirmationExperimentEnabled } from './features/queue/confirmation'
import { changeExperiment } from './features/queue/experiment'
import { joinQueue, readEntrySnapshot, type JoinSource } from './features/queue/entries'
import {
  dispatchNotification,
  dispatchNotificationSerialized,
  jobSchema,
  processWebhook,
  reconcile,
} from './features/queue/notifications'

export class QueueCoordinator extends DurableObject<CloudflareBindings> {
  private tail: Promise<unknown> = Promise.resolve()
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => undefined)
    return result
  }
  private async withQueue<T>(queueId: string, work: () => Promise<T>) {
    await this.ctx.storage.put('queueId', queueId)
    await maintainServiceEntries(this.env, queueId)
    await expireArrivals(this.env, queueId)
    try {
      return await work()
    } finally {
      const next = await this.env.DB.prepare(
        "SELECT MIN(deadline) AS deadline FROM (SELECT arrival_deadline_at AS deadline FROM queue_entry WHERE queue_id=? AND status='called' UNION ALL SELECT service_ends_at AS deadline FROM queue_entry WHERE queue_id=? AND status='waiting')",
      )
        .bind(queueId, queueId)
        .first<{ deadline: number | null }>()
      if (next?.deadline != null)
        await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next.deadline))
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
      this.withQueue(queueId, () => this.staffResult(() => configureQueue(this.env, actor, queueId, input))),
    )
  }
  openingContext(queueId: string) {
    return this.serialize(() => this.withQueue(queueId, () => openingContext(this.env, queueId)))
  }
  lifecycle(
    actor: string,
    queueId: string,
    key: string,
    input: QueueLifecycleCommand,
  ) {
    return this.serialize(() =>
      this.withQueue(queueId, () => this.staffResult(() =>
        runLifecycleCommand(this.env, actor, queueId, key, input),
      )),
    )
  }
  read(queueId: string, token: string) {
    return this.serialize(() =>
      this.withQueue(queueId, async () => {
        await recalculateQueue(this.env, queueId)
        return readEntrySnapshot(this.env, token)
      }),
    )
  }
  refresh(queueId: string) {
    return this.serialize(() =>
      this.withQueue(queueId, async () => {
        await recalculateQueue(this.env, queueId)
        return { ok: true }
      }),
    )
  }
  experiment(action: 'seed' | 'advance', key: string) {
    return this.serialize(() => changeExperiment(this.env, action, key))
  }
  dispatch(id: string) {
    return this.serialize(async () => {
      const row = await this.env.DB.prepare('SELECT e.queue_id FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE n.id=?')
        .bind(id).first<{ queue_id: string }>()
      if (row) return this.withQueue(row.queue_id, () => dispatchNotificationSerialized(this.env, id))
      return dispatchNotificationSerialized(this.env, id)
    })
  }

  staffJoin(actor: string, queueId: string, key: string, input: JoinQueue) {
    return this.serialize(async () => {
      try {
        return await this.withQueue(queueId, () => joinQueue(this.env, queueId, key, input, false, actor))
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
  fetch: app.fetch,
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
  async scheduled(_controller, env) {
    await backfillDirectoryConfigs(env)
    const queues = await env.DB.prepare('SELECT id FROM queue').all<{
      id: string
    }>()
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
  },
} satisfies ExportedHandler<CloudflareBindings>
