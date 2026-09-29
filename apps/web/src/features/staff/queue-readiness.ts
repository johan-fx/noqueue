import type { QueueReadiness } from '@noqueue/contracts/staff'
export const readinessMessages: Record<
  QueueReadiness['reasons'][number],
  string
> = {
  inventory_refresh_required:
    'La distribución ha cambiado. Confirma de nuevo la ocupación antes de llamar más turnos. Puedes seguir confirmando llegadas y liberando recursos.',
  configuration_missing:
    'Falta configurar los tipos de mesa o grupos de plazas.',
  inventory_required:
    'Confirma la ocupación para preparar la gestión inteligente.',
  legacy_occupancy:
    'Hay turnos anteriores sin recurso asignado. Resuélvelos para completar la preparación.',
}

export function readinessNotice(service: {
  open: number
  inventoryConfirmed?: boolean
  readiness?: QueueReadiness
}) {
  const reasons = service.readiness?.reasons ?? []
  const missing = reasons.includes('configuration_missing')
  const needsInventory = !service.inventoryConfirmed && !missing
  return {
    title:
      needsInventory && service.open
        ? 'Confirma la ocupación'
        : 'Gestión inteligente pendiente',
    messages: [
      ...(needsInventory && service.open
        ? [
            'La cola está abierta, pero todavía no sabemos cuántas mesas están ocupadas.',
          ]
        : []),
      ...reasons
        .filter(
          (reason) =>
            !(
              needsInventory &&
              service.open &&
              reason === 'inventory_required'
            ),
        )
        .map((reason) => readinessMessages[reason]),
    ],
  }
}

/** Retained holds remain correctable while closed; correction never confirms a fresh inventory. */
export function occupancyAction(service: {
  open: number
  inventoryConfirmed?: boolean
  readiness?: QueueReadiness
}) {
  if (
    service.inventoryConfirmed ||
    (!service.open &&
      service.readiness?.reasons.includes('inventory_refresh_required'))
  )
    return 'occupancy' as const
  if (
    service.open &&
    !service.readiness?.reasons.includes('configuration_missing')
  )
    return 'confirm_inventory' as const
  return null
}
