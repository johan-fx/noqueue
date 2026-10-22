import type { PublicSearchInput } from '@noqueue/contracts/discovery'

/** Shared normalization for the native preload and the existing reactive search. */
export function discoveryRequest(params: URLSearchParams, search: boolean,
  coordinates: PublicSearchInput['coordinates'], recent: string[]) {
  const value = params.get('type')
  const type = value === 'restaurant' || value === 'reception' || value === 'pool' ? value : undefined
  const scope = coordinates && (!search || params.get('scope') === 'nearby') ? 'nearby' : 'global'
  const sort = coordinates && (params.get('sort') === 'distance' || (!params.has('sort') && scope === 'nearby')) ? 'distance' : 'wait'
  const body: PublicSearchInput = {
    text: search ? params.get('text') ?? '' : '', type, scope, coordinates, sort,
    page: Math.max(1, Math.min(1000, Number(params.get('page')) || 1)),
    pageSize: search ? 24 : 3,
    ...(!search && !coordinates ? { recentIds: recent } : {}),
  }
  return { body, shouldSearch: search || !!coordinates || recent.length > 0 }
}

export const discoveryResourceKey = (bodyKey: string) => `/api/v1/public/search:${bodyKey}`
