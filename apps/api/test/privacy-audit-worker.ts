// Local audit only. No deployable configuration references this entrypoint.
import './http-only-platform'
import './fake-network'
import worker, { QueueCoordinator as ProductionCoordinator } from '../src/index'

function localBindings(env: CloudflareBindings): CloudflareBindings {
  const namespace = env.QUEUE_COORDINATOR
  // workerd cannot simulate jurisdiction restrictions. Keep production policy,
  // but map the requested EU namespace to the same ephemeral local namespace.
  const coordinator = new Proxy(namespace, {
    get(target, key) {
      if (key === 'jurisdiction') return (value: string) => {
        if (value !== 'eu') throw new Error('Unexpected audit jurisdiction')
        return namespace
      }
      const value = Reflect.get(target, key, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { ...env, QUEUE_COORDINATOR: coordinator }
}
export class QueueCoordinator extends ProductionCoordinator {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, localBindings(env))
  }
}
export default {
  queue(batch: MessageBatch, env: CloudflareBindings) {
    return worker.queue(batch, localBindings(env))
  },
  fetch(request: Request, env: CloudflareBindings, ctx: ExecutionContext) {
    return worker.fetch(request, localBindings(env), ctx)
  },
} satisfies ExportedHandler<CloudflareBindings>
