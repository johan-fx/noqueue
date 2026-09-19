import { HTTPException } from 'hono/http-exception'
import type { QueueCommand } from '@noqueue/contracts/staff'
import { runQueueCommand, configureQueue } from './features/staff/commands'
import { DurableObject } from 'cloudflare:workers'
import type { JoinQueue } from '@noqueue/contracts/queue'
import { app } from './app'
import { confirmationExperimentEnabled } from './features/queue/confirmation'
import { changeExperiment } from './features/queue/experiment'
import { joinQueue } from './features/queue/entries'
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
      this.staffResult(() =>
        runQueueCommand(this.env, actor, queueId, key, input),
      ),
    )
  }
  staffConfigure(actor: string, queueId: string, input: unknown) {
    return this.serialize(() =>
      this.staffResult(() => configureQueue(this.env, actor, queueId, input)),
    )
  }
  experiment(action: 'seed' | 'advance', key: string) {
    return this.serialize(() => changeExperiment(this.env, action, key))
  }
  dispatch(id: string) {
    return this.serialize(() => dispatchNotificationSerialized(this.env, id))
  }

  join(queueId: string, key: string, input: JoinQueue, experiment = false) {
    if (experiment && !confirmationExperimentEnabled(this.env))
      return Promise.resolve({ status: 404, body: { error: 'not_found' } })
    // D1 awaits permit interleaving. Chain entire joins, not individual database calls.
    return this.serialize(() =>
      joinQueue(this.env, queueId, key, input, experiment),
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
    await reconcile(env)
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM staff_rate WHERE CAST(substr(key,instr(key,':')+1) AS INTEGER) < ?",
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
