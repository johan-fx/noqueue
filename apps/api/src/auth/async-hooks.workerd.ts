// Worker-only alias for @better-auth/core/async_hooks (Better Auth 1.7.5).
// A cached dynamic import can remain pending when its first request is canceled.
// Keep this static and assert the generated bundle: better-auth/better-auth#10315.
import { AsyncLocalStorage } from 'node:async_hooks'

export async function getAsyncLocalStorage() {
  return AsyncLocalStorage
}
