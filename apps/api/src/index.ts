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
  },
} satisfies ExportedHandler<CloudflareBindings>
