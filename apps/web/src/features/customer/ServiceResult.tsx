import { availabilityText } from './availability'
import { Link } from 'react-router'
import { ConciergeBell, Utensils, Martini, Clock, MapPin } from 'lucide-react'
import type { PublicSearchResult } from '@noqueue/contracts/discovery'
import type { Locale } from './shared'
import { visitService } from './discovery-state'
export function ServiceResult({
  service,
  locale,
  returnTo,
}: {
  service: PublicSearchResult
  locale: Locale
  returnTo: string
}) {
  const Icon =
    service.type === 'restaurant'
      ? Utensils
      : service.type === 'reception'
      ? ConciergeBell
      : Martini
  const wait = availabilityText(service, locale, service.waitMinutes)
  const distance =
    service.distanceMeters === null
      ? null
      : service.distanceMeters < 1000
      ? `${Math.round(service.distanceMeters)}m`
      : `${(service.distanceMeters / 1000).toLocaleString(locale, {
          maximumFractionDigits: 1,
        })}km`
  return (
    <Link
      to={`/q/${service.id}?lang=${locale}`}
      state={{ discoveryReturn: returnTo }}
      onClick={() => visitService(service.id)}
      className="flex w-full items-center gap-4 border-b border-gray-200 pb-3 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gray-100">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-start justify-between gap-2">
          <span
            className="min-w-0 truncate text-sm font-semibold text-gray-900"
            title={service.name}
          >
            {service.name}
          </span>
          <span className="flex max-w-[55%] flex-wrap items-center justify-end gap-2 text-right text-xs">
            <span className="flex items-center gap-1 text-black">
              <Clock aria-hidden="true" className="size-3" />
              {wait}
            </span>
            {distance && (
              <span className="flex items-center gap-1 text-slate-500">
                <MapPin aria-hidden="true" className="size-3" />
                {distance}
              </span>
            )}
          </span>
        </span>
        <span className="block text-xs text-gray-600">{service.address}</span>
      </span>
    </Link>
  )
}
