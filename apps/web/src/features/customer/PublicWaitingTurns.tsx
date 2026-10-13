import { Users } from 'lucide-react'
import { waitingTurnsText, type PresentationStatus } from './availability'
import type { Locale } from './shared'

/** Owns the complete row so hidden counts leave neither an icon nor a gap. */
export function PublicWaitingTurns({
  service,
  locale,
  className = 'block',
  showIcon = false,
}: {
  service: PresentationStatus
  locale: Locale
  className?: string
  showIcon?: boolean
}) {
  const text = waitingTurnsText(service, locale)
  if (text === null) return null
  return (
    <span className={className} data-testid="public-waiting-turns">
      {showIcon && <Users aria-hidden="true" className="size-4 shrink-0" />}
      {text}
    </span>
  )
}
