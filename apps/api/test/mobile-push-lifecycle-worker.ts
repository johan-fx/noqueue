// NEVER deploy. This entrypoint alone may use the explicitly budgeted local guard.
import './http-only-platform'
import { env } from 'cloudflare:workers'
import { http, HttpResponse, passthrough } from 'msw'
import { setupNetwork } from './fake-network'
import { allowLifecycleRequest } from './local-push-lifecycle-policy'
setupNetwork().use(http.all('*', async ({ request }) => {
  try { if (await allowLifecycleRequest(request.clone(), env)) return passthrough() } catch { /* fail closed */ }
  return HttpResponse.error()
}))
export { default, QueueCoordinator } from '../src/index'
