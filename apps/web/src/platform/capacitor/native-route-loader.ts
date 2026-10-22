import { replace, type LoaderFunctionArgs, type ShouldRevalidateFunction } from 'react-router'
import { entrySchema, publicServiceSchema, publicVenueSchema } from '@noqueue/contracts/queue'
import { publicSearchResponseSchema } from '@noqueue/contracts/discovery'
import { customerFetch } from '@/data/api/customer'
import { setNativeTransitionIntent, transitionIntentForPathChange } from '@/app/navigation/native-transitions'
import { getDiscoveryCoordinates, recentServiceIds } from '@/features/customer/discovery-state'
import { discoveryRequest, discoveryResourceKey } from '@/features/customer/discovery-request'
import { abortable, abortScope, type NativeOwnership, type NativeOwnershipCoordinator } from './native-ownership'
import type { NativeResourceSeed } from './native-route-data'

export type NativeRouteData = {
  path: string
  ownership: NativeOwnership
  allowed: boolean
  seed: NativeResourceSeed | null
}

export const nativeShouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate, formMethod }) => {
  if (currentUrl.pathname !== nextUrl.pathname) return true
  if (!formMethod && currentUrl.search !== nextUrl.search) return false
  return defaultShouldRevalidate
}

async function resource(url: URL, signal: AbortSignal): Promise<NativeResourceSeed | null> {
  let key: string, endpoint: string, init: RequestInit = {}
  let parse: (value: unknown) => unknown
  const match = /^\/(q|v|t)\/([^/]+)$/.exec(url.pathname)
  if (url.pathname === '/' || url.pathname === '/search') {
    const { body, shouldSearch } = discoveryRequest(url.searchParams, url.pathname === '/search', getDiscoveryCoordinates(), recentServiceIds())
    if (!shouldSearch) return null
    const bodyKey = JSON.stringify(body)
    key = discoveryResourceKey(bodyKey)
    endpoint = '/api/v1/public/search'
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyKey }
    parse = value => publicSearchResponseSchema.parse(value)
  } else if (match) {
    endpoint = match[1] === 'q' ? `/api/v1/public/services/${match[2]}`
      : match[1] === 'v' ? `/api/v1/public/venues/${match[2]}/services` : `/api/v1/public/entries/${match[2]}`
    key = endpoint
    parse = value => (match[1] === 'q' ? publicServiceSchema : match[1] === 'v' ? publicVenueSchema : entrySchema).parse(value)
  } else return null
  try {
    const response = await abortable(customerFetch(endpoint, { ...init, signal }), signal)
    if (!response.ok) throw new Error('unavailable')
    const data = parse(await abortable(response.json(), signal))
    return { key, data, error: false, updatedAt: Date.now() }
  } catch {
    return { key, data: null, error: true, updatedAt: Date.now() }
  }
}

/** Only this loader prepares native destinations: ownership always precedes resource access. */
export function createNativeRouteLoader(coordinator: NativeOwnershipCoordinator) {
  return async ({ request }: LoaderFunctionArgs): Promise<NativeRouteData | Response> => {
    const url = new URL(request.url)
    const finish = coordinator.begin()
    const deadline = abortScope([request.signal])
    try {
      while (!deadline.signal.aborted) {
        const generation = coordinator.signal
        const scope = abortScope([deadline.signal, generation])
        try {
          const ownership = await coordinator.check(scope.signal)
          const retained = coordinator.retained(url.pathname)
          if (ownership.error) return { path: url.pathname, ownership, allowed: !!retained, seed: retained?.seed ?? null }
          const turnPath = ownership.entry ? `/t/${ownership.entry.recoveryToken}` : null
          const target = turnPath && turnPath !== url.pathname ? turnPath : url.pathname === '/turns' ? '/' : null
          if (target) {
            // Direction describes the final navigation, never the intermediate requested form.
            if (typeof document !== 'undefined') setNativeTransitionIntent(transitionIntentForPathChange(url.pathname, target, 'replace'))
            return replace(`${target}?lang=${url.searchParams.get('lang') === 'en' ? 'en' : 'es'}`)
          }
          const seed = await resource(url, scope.signal)
          if (request.signal.aborted) throw request.signal.reason
          if (generation !== coordinator.signal) continue
          return { path: url.pathname, ownership, allowed: true, seed }
        } catch (error) {
          if (request.signal.aborted) throw error
          if (generation !== coordinator.signal) continue
          break
        } finally { scope.dispose() }
      }
      const ownership = { ...coordinator.getSnapshot(), error: true }
      const retained = coordinator.retained(url.pathname)
      return { path: url.pathname, ownership, allowed: !!retained, seed: retained?.seed ?? null }
    } finally { deadline.dispose(); finish() }
  }
}
