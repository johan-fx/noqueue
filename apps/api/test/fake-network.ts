import { setupNetwork as setupCloudflareNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'

/** Local harness only: unknown traffic is an error, never a real network fallback. */
const network = setupCloudflareNetwork()
function configureNetwork() {
  network.configure({
    onUnhandledFrame: 'error',
    handlers: [
      http.post(
        /^https:\/\/(?:waba-sandbox|waba-v2|waba)\.360dialog\.io\/(?:v1\/)?messages$/,
        () =>
          HttpResponse.json(
            { messages: [{ id: `wamid.fake.${crypto.randomUUID()}` }] },
            { status: 201 },
          ),
      ),
    ],
  })
  network.enable()
}
configureNetwork()
// Keep the fail-closed guard active for the whole worker, including test teardown.
export function setupNetwork() {
  return {
    ...network,
    enable: () => Promise.resolve(),
    disable: () => Promise.resolve(),
  }
}
