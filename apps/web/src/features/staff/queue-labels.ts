import type { QueueCommand } from '@noqueue/contracts/staff'
export const queueActionLabels = {
  call: 'Llamar',
  complete: 'Confirmar llegada',
  release: 'Liberar recurso',
  cancel: 'Cancelar turno',
  no_show: 'No presentado',
  skip: 'Pasar al final',
}
export const receptionLabels = {
  check_in: 'Check-in',
  check_out: 'Check-out',
  other: 'Otros',
}
export function entryActions(status: string): QueueCommand['action'][] {
  return status === 'waiting'
    ? ['call', 'skip', 'cancel']
    : status === 'called'
    ? ['complete', 'no_show', 'cancel']
    : status === 'completed'
    ? ['release']
    : []
}
