// NEVER deploy. Separate opt-in entrypoint; every non-authorized outbound is blocked.
import './http-only-platform'
import { env } from 'cloudflare:workers'
import { http, HttpResponse, passthrough } from 'msw'
import { setupNetwork } from './fake-network'
import { allowSmokeRequest } from './local-push-policy'
setupNetwork().use(http.all('*', async ({ request }) => {
  try { if (await allowSmokeRequest(request.clone(), env)) return passthrough() } catch { /* fail closed */ }
  return HttpResponse.error()
}))
export { default, QueueCoordinator } from '../src/index'
