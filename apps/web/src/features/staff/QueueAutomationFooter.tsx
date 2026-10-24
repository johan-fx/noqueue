import { CirclePause, MoveRight, RotateCw } from 'lucide-react'
import type {
  QueueAutomation,
  ServiceInput,
} from '@noqueue/contracts/staff'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function QueueAutomationFooter({
  type,
  configured,
  automation,
  canOperate = true,
  busy,
  canAssignNext,
  onAssignNext,
}: {
  type: ServiceInput['type']
  configured: boolean
  automation: QueueAutomation | null
  canOperate?: boolean
  busy: boolean
  canAssignNext: boolean
  onAssignNext: () => void
}) {
  const configuredNow = automation?.configured ?? configured
  const active =
    configuredNow &&
    automation?.effective === true &&
    automation.activeCycles > 0

  if (!configuredNow && (type === 'restaurant' || !canOperate)) return null

  return (
    <div className="w-full space-y-2">
      {configuredNow && (
        <>
          <Badge
            variant="secondary"
            className={
              active
                ? 'gap-1 rounded-md bg-zinc-900 px-2 text-white hover:bg-zinc-900'
                : 'gap-1 rounded-md bg-gray-200 px-2 text-gray-900 hover:bg-gray-200'
            }
          >
            {active ? (
              <RotateCw aria-hidden="true" />
            ) : (
              <CirclePause aria-hidden="true" />
            )}
            Gestión automática {active ? 'activa' : 'pausada'}
          </Badge>
          {active ? (
            <div className="text-xs leading-4 text-muted-foreground">
              <p className="font-semibold">
                {automation!.activeCycles}{' '}
                {automation!.activeCycles === 1
                  ? 'asignación activa.'
                  : 'asignaciones activas.'}
              </p>
              <p>
                Si alguien no llega a tiempo, avisaremos al siguiente
                disponible.
              </p>
            </div>
          ) : (
            <p className="text-xs leading-4 text-muted-foreground sm:whitespace-nowrap">
              {type === 'restaurant' && (
                <>
                  No hay asignaciones de referencia.{' '}
                  {/* Phone drawers are too narrow for both sentences. */}
                  <br className="sm:hidden" />
                </>
              )}
              {canOperate
                ? 'Asigna próximo turno de forma manual.'
                : 'El personal con permisos puede iniciar una asignación manual.'}
            </p>
          )}
        </>
      )}
      {type !== 'restaurant' && canOperate && (
        <Button
          className="h-12 w-full bg-zinc-900 text-white hover:bg-zinc-800"
          disabled={busy || !canAssignNext}
          onClick={onAssignNext}
        >
          Asignar próximo turno <MoveRight aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
