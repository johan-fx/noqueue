import { useEffect, useState } from 'react'
import { CircleHelp, CirclePause, RotateCw } from 'lucide-react'
import type {
  QueueAutomation,
  ServiceInput,
} from '@noqueue/contracts/staff'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import pausedIcon from '@/assets/queue-card/paused.svg'
import assignNextIcon from '@/assets/queue-card/assign-next.svg'

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
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  const configuredNow = automation?.configured ?? configured
  // Only the authoritative queue snapshot determines the global state.
  // A stopped cycle on one entry says nothing about other active cycles.
  const state = !online || !automation || !Number.isInteger(automation.activeCycles) || automation.activeCycles < 0
      ? 'unknown'
      : !automation.effective
        ? 'unavailable'
        : automation.activeCycles > 0
          ? 'active'
          : 'paused'
  const active = state === 'active'
  const needsAttention = (automation?.attention?.length ?? 0) > 0
  const label = {
    unknown: 'Estado automático sin confirmar',
    unavailable: 'Gestión automática no disponible',
    active: 'Gestión automática activa',
    paused: needsAttention ? 'Asignación manual pendiente' : 'Gestión automática pausada',
  }[state]

  if (!configuredNow && (type === 'restaurant' || !canOperate)) return null

  return (
    <div className="w-full space-y-2">
      {configuredNow && <div role="status" className="space-y-2">
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
            ) : state === 'paused' ? (
              <img src={pausedIcon} alt="" aria-hidden="true" className="shrink-0" />
            ) : state === 'unknown' ? (
              <CircleHelp aria-hidden="true" />
            ) : (
              <CirclePause aria-hidden="true" />
            )}
            {label}
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
          ) : state !== 'paused' ? (
            <p className="text-xs leading-4 text-muted-foreground">
              {state === 'unknown'
                ? 'No se ha podido confirmar el estado de la gestión automática. Espera a la próxima actualización.'
                : 'La automatización no está disponible para este servicio. Una asignación manual no la reactivará mientras siga deshabilitada.'}
            </p>
          ) : needsAttention ? (
            <p className="text-xs leading-4 text-muted-foreground">Un ciclo ha finalizado sin sustituto compatible. Revisa el aviso para iniciar una nueva asignación manual.</p>
          ) : (
            <p className="text-xs leading-4 text-muted-foreground">
              {type === 'restaurant' && (
                <>
                  No hay asignaciones de referencia.{' '}
                  <br />
                </>
              )}
              {canOperate
                ? 'Asigna próximo turno de forma manual.'
                : 'El personal con permisos puede iniciar una asignación manual.'}
            </p>
          )}
      </div>}
      {type !== 'restaurant' && canOperate && (
        <Button
          className="h-12 w-full gap-2 rounded-lg bg-[#171717] px-8 text-base font-medium leading-5 text-[#fafafa] shadow-xs hover:bg-zinc-800"
          disabled={busy || !canAssignNext}
          onClick={onAssignNext}
        >
          Asignar próximo turno <img src={assignNextIcon} alt="" aria-hidden="true" className="shrink-0" />
        </Button>
      )}
    </div>
  )
}
