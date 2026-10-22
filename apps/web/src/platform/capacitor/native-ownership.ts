import { z } from 'zod'
import { mobileActiveEntrySchema } from '@noqueue/contracts/queue'
import { customerFetch } from '@/data/api/customer'
import type { NativeResourceSeed } from './native-route-data'

const schema = z.object({ entries: z.array(mobileActiveEntrySchema).max(1) })
export type NativeOwnership = { entry: z.infer<typeof mobileActiveEntrySchema> | null; error: boolean; revision: number }
export const abortError = () => new DOMException('Aborted', 'AbortError')

export function abortScope(signals: AbortSignal[], timeout = 15000) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const signal of signals) {
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  const timer = setTimeout(abort, timeout)
  return { signal: controller.signal, dispose: () => {
    clearTimeout(timer)
    for (const signal of signals) signal.removeEventListener('abort', abort)
  } }
}

/** Race even non-cooperative transports against cancellation, and release listeners. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const abort = () => reject(abortError())
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function createNativeOwnership() {
  let state: NativeOwnership = { entry: null, error: false, revision: 0 }
  let generation = new AbortController()
  let pending: { controller: AbortController; promise: Promise<NativeOwnership>; consumers: number } | null = null
  let preparing = 0
  let committed: { path: string; seed: NativeResourceSeed | null } | null = null
  const listeners = new Set<() => void>()
  const publish = (next: NativeOwnership) => {
    state = next
    listeners.forEach(listener => listener())
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    get signal() { return generation.signal },
    get preparing() { return preparing > 0 },
    begin() { preparing++; return () => { preparing-- } },
    commit(path: string, seed: NativeResourceSeed | null) { committed = { path, seed } },
    retained(path: string) {
      return state.entry && path === `/t/${state.entry.recoveryToken}` && committed?.path === path ? committed : null
    },
    invalidate() {
      generation.abort()
      generation = new AbortController()
      pending?.controller.abort()
      pending = null
    },
    async check(signal: AbortSignal): Promise<NativeOwnership> {
      if (signal.aborted) throw abortError()
      if (!pending) {
        const controller = new AbortController()
        const scopeGeneration = generation.signal
        const scope = abortScope([controller.signal, scopeGeneration])
        const operation = { controller, consumers: 0, promise: null as unknown as Promise<NativeOwnership> }
        pending = operation
        operation.promise = (async () => {
          try {
            const response = await abortable(customerFetch('/api/v1/public/entries', { signal: scope.signal }), scope.signal)
            if (!response.ok) throw new Error('recovery_unavailable')
            const data = schema.parse(await abortable(response.json(), scope.signal))
            if (scope.signal.aborted) throw abortError()
            publish({ entry: data.entries[0] ?? null, error: false, revision: state.revision + 1 })
          } catch (error) {
            if (controller.signal.aborted || generation.signal !== scopeGeneration) throw error
            publish({ ...state, error: true, revision: state.revision + 1 })
          } finally {
            scope.dispose()
            if (pending === operation) pending = null
          }
          return state
        })()
      }
      const operation = pending!
      operation.consumers++
      try { return await abortable(operation.promise, signal) }
      finally {
        operation.consumers--
        if (!operation.consumers && pending === operation) {
          pending = null
          operation.controller.abort()
        }
      }
    },
  }
}

export type NativeOwnershipCoordinator = ReturnType<typeof createNativeOwnership>
