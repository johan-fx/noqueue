import { MoveRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/** Service-level opt-in indicator; distinct from the live cycle state. */
export function AutomaticAssignmentBadge({
  variant,
}: {
  variant: 'card' | 'summary'
}) {
  return (
    <Badge className="gap-1 rounded-full bg-zinc-900 px-2 text-white hover:bg-zinc-900">
      <MoveRight aria-hidden="true" />
      {variant === 'card' ? 'Gestión automática' : 'Gestión automática activa'}
    </Badge>
  )
}
