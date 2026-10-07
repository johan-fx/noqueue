import {
  allowedEntryActions,
  type ServiceInput,
  type EntryCommand,
} from '@noqueue/contracts/staff'
export const queueActionLabels = {
  assign_next: 'Asignar próximo turno',
  call: 'Asignar turno',
  complete: 'Confirmar llegada',
  release: 'Liberar recurso',
  cancel: 'Cancelar turno',
  no_show: 'No presentado',
  skip: 'Pasar al final',
  restore: 'Restaurar turno',
}
export const receptionLabels = {
  check_in: 'Check-in',
  check_out: 'Check-out',
  other: 'Otros',
}
export function entryActions(
  status: string,
  type: ServiceInput['type'] = 'restaurant',
): EntryCommand['action'][] {
  return allowedEntryActions(type, status)
}
