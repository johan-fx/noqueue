import { DurableObject } from 'cloudflare:workers'
import { app } from './app'

export class QueueCoordinator extends DurableObject<CloudflareBindings> {
  override fetch(): Response {
    return new Response('Queue coordinator is not implemented yet.', { status: 501 })
  }
}

export default app
