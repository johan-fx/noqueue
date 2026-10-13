import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import type { PublicService } from '@noqueue/contracts/queue'
import { Badge } from '@/components/ui/badge'

export function ClosedServiceCard({
  name,
  opening,
  receivedAt,
  locale,
}: {
  name: string
  opening: NonNullable<PublicService['nextOpening']>
  receivedAt: number
  locale: 'es' | 'en'
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const es = locale === 'es'
  const remaining = Math.max(
    0,
    opening.at - opening.serverNow - Math.max(0, now - receivedAt),
  )
  const totalSeconds = Math.ceil(remaining / 1000)
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
    2,
    '0',
  )
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const countdown = `${hours}:${minutes}:${seconds}`
  // The existing resource polling confirms opening/admission. A local timer
  // must never turn this informational card into an enabled join link.
  return (
    <article
      aria-label={name}
      aria-disabled="true"
      data-testid="closed-service-card"
      className="flex min-h-[108px] flex-col justify-between gap-2 rounded-lg border border-gray-200 bg-gray-100 p-[15px] text-gray-500"
    >
      <div className="flex items-center justify-between gap-3">
        <h3
          className="min-w-0 truncate text-lg leading-7 font-semibold"
          title={name}
        >
          {name}
        </h3>
        <Badge className="rounded-lg bg-gray-600 font-semibold text-gray-50">
          {es ? 'Abre a las' : 'Opens at'} {opening.localTime}
          {es ? 'h' : ''}
        </Badge>
      </div>
      <p className="flex items-center gap-2 text-xs leading-none font-medium tabular-nums">
        <Clock aria-hidden="true" className="size-4 shrink-0" />
        {remaining > 0
          ? es
            ? `Podrás apuntarte en ${countdown}`
            : `You can join in ${countdown}`
          : es
          ? 'Comprobando disponibilidad…'
          : 'Checking availability…'}
      </p>
    </article>
  )
}
