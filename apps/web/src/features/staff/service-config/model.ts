import type { ServiceInput } from '@noqueue/contracts/staff'

export type StepId = 'general' | 'capacity' | 'queue' | 'preference' | 'summary'

export const serviceTitles: Record<ServiceInput['type'], string> = {
  restaurant: 'Configuración restaurante',
  reception: 'Configuración recepción',
  pool: 'Configuración piscina / bar',
}

export const stepLabels: Record<StepId, string> = {
  general: 'Datos generales',
  capacity: 'Capacidad',
  queue: 'Gestión de cola',
  preference: 'Preferencias',
  summary: 'Resumen',
}

/** Reception has no spaces, so it skips the assignment step. */
export function stepsFor(type: ServiceInput['type']): StepId[] {
  if (type === 'reception') return ['general', 'capacity', 'queue', 'summary']
  return ['general', 'capacity', 'queue', 'preference', 'summary']
}

export const spacePresets: Record<'restaurant' | 'pool', string[]> = {
  restaurant: ['Terraza', 'Interior', 'Barra'],
  pool: ['Piscina', 'Bar', 'Tumbonas'],
}

export const cutoffOptions = [0, 15, 30, 45, 60, 90, 120]

export const emptyService: ServiceInput = {
  name: '',
  type: 'restaurant',
  capacity: 20,
  averageMinutes: 60,
  graceMinutes: 5,
  cutoffMinutes: 30,
  twentyFourHours: false,
  schedules: [{ day: 1, from: '12:00', to: '23:00' }],
  spaces: [{ name: 'Interior', tables: 10 }],
  receptionServices: ['check_in'],
  assignmentPreference: 'fastest',
}

export function seatLabel(type: ServiceInput['type']) {
  return type === 'pool' ? 'plazas' : 'mesas'
}
