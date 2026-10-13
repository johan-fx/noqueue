import type { VenueLogoState } from '@noqueue/contracts/staff'
import { api } from './api'

const logoPath = (venueId: string) =>
  `/venues/${encodeURIComponent(venueId)}/logo`

export function getVenueLogo(venueId: string, signal?: AbortSignal) {
  return api<VenueLogoState>(logoPath(venueId), 'GET', undefined, undefined, signal)
}

export function putVenueLogo(
  venueId: string,
  file: File,
  version: number,
  requestKey: string,
) {
  const data = new FormData()
  data.append('file', file)
  data.append('version', String(version))
  return api<VenueLogoState>(logoPath(venueId), 'PUT', data, requestKey)
}

export function deleteVenueLogo(
  venueId: string,
  version: number,
  requestKey: string,
) {
  return api<VenueLogoState>(
    logoPath(venueId),
    'DELETE',
    { version },
    requestKey,
  )
}
