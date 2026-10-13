import type { QueueReadiness } from '@noqueue/contracts/staff'
export function readinessNotice(service: {
  config?: { type: string }
  open: number
  queueState?: 'active' | 'inactive' | 'paused'
  inventoryConfirmed?: boolean
  readiness?: QueueReadiness
}) {
  return {
    title:
      service.readiness?.state === 'disabled'
        ? 'Desactivada manualmente'
        : 'Gestión inteligente activa',
    messages: [] as string[],
  }
}
