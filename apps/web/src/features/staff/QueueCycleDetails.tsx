import type { StaffEntry } from '@noqueue/contracts/staff'

/** Historical context belongs in the detail, never in every row of the list. */
export function QueueCycleDetails({ entry, canOperate = true }: {
  entry: StaffEntry
  canOperate?: boolean
}) {
  const cycle = entry.automationCycle
  if (cycle?.state !== 'stopped') return null
  const reason = {
    arrived: entry.status === 'waiting'
      ? 'Se confirmó una llegada en el ciclo anterior. Este turno sigue en espera.'
      : ['completed', 'served'].includes(entry.status)
        ? 'Se confirmó la llegada de este turno.'
        : 'Se confirmó una llegada en el ciclo anterior.',
    cancelled: 'El personal canceló una asignación de este ciclo.',
    no_show: 'No se encontró una alternativa compatible.',
    no_candidate: 'No se encontraron candidatos compatibles.',
    missing_context: 'Falta información para encontrar una alternativa compatible.',
    context_changed: 'Cambió el contexto de compatibilidad de la asignación.',
    service_ended: 'Se cerró el servicio.',
    disabled: 'Se desactivó la gestión automática.',
    legacy: 'Este turno no tiene un ciclo automático activo.',
  }[cycle.reason ?? ''] ?? 'Este ciclo ya no tiene una asignación automática activa.'
  const nextStep = cycle.reason === 'disabled'
    ? 'Para reanudar la gestión automática, debe estar activada y realizarse una nueva asignación manual.'
    : cycle.reason === 'service_ended'
      ? 'Para reanudar la gestión automática, el servicio debe estar abierto y realizarse una nueva asignación manual.'
      : cycle.reason === 'missing_context' || cycle.reason === 'context_changed'
        ? 'Es necesario revisar los datos de asignación antes de iniciar un nuevo ciclo con una asignación manual.'
        : canOperate
          ? 'Para iniciar un nuevo ciclo, realiza una nueva asignación manual.'
          : 'El personal con permisos puede iniciar un nuevo ciclo con una asignación manual.'
  return (
    <section aria-label="Detalle del ciclo pausado" className="space-y-2 rounded-md bg-muted p-3 text-xs leading-4 text-muted-foreground">
      <p className="font-semibold text-foreground">Ciclo pausado</p>
      <p>{reason}</p>
      <p>{nextStep}</p>
      <p>Consulta el estado global de la gestión automática en el pie de la pestaña Lista.</p>
    </section>
  )
}
