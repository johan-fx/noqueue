import { visibleWaitingCount, type AdmissionStatus } from '@noqueue/contracts/queue'
import type { Locale } from './shared'

export type PresentationStatus = {
  averageWaitQuality?: 'estimated' | 'provisional' | 'unknown' | undefined
} & {
  [K in keyof AdmissionStatus]?: AdmissionStatus[K] | undefined
}
export function visualWaitingTurns(service: PresentationStatus): number | null {
  const real = service.waitingTurns
  // An older response has no turn count: people are not a substitute for turns.
  if (real === undefined) return null
  if (real > 0) return real
  return service.serviceOpen &&
    service.queueState === 'active' &&
    service.canJoin === true &&
    service.blockReason === null
    ? visibleWaitingCount(real)
    : null
}

export function waitingTurnsText(
  service: PresentationStatus,
  locale: Locale,
): string | null {
  const count = visualWaitingTurns(service)
  if (count === null) return null
  return locale === 'es'
    ? `${count} ${count === 1 ? 'turno' : 'turnos'} en lista de espera`
    : `${count} ${count === 1 ? 'turn' : 'turns'} waiting`
}

/** Navigation copy stays compact; detailed state/quality can label the estimate. */
export function publicWaitText(estimate: number | null, locale: Locale, compact = false) {
  if (estimate === null) return compact ? '—' : locale === 'es' ? 'Sin estimación disponible' : 'No estimate available'
  if (compact) return `${estimate}min`
  return locale === 'es'
    ? `Ahora, media de espera ${estimate} ${estimate === 1 ? 'minuto' : 'minutos'}`
    : `Current average wait ${estimate} ${estimate === 1 ? 'minute' : 'minutes'}`
}
export function availabilityText(
  service: PresentationStatus,
  locale: Locale,
  estimate: number | null = null,
) {
  const es = locale === 'es'
  if (!service.serviceOpen) return es ? 'Servicio cerrado' : 'Service closed'
  if (service.queueState === 'paused')
    return es ? 'Lista pausada' : 'Waiting list paused'
  if (service.blockReason === 'cutoff')
    return es ? 'Inscripciones finalizadas' : 'Admissions ended'
  if (service.blockReason === 'capacity')
    return es ? 'Lista completa' : 'Waiting list at capacity'
  if (service.queueState === 'inactive')
    return (service.waitingPeople ?? 0) > 0
      ? es
        ? 'Turnos pendientes · Sin nuevas inscripciones'
        : 'Pending turns · No new admissions'
      : es
      ? 'Acceso directo · Sin inscripción'
      : 'Walk in · No registration'
  return `${es ? 'Lista activa' : 'Waiting list active'} · ${
    estimate === null
      ? es
        ? 'Sin estimación'
        : 'No estimate'
    : `${estimate} min${service.averageWaitQuality === 'provisional' ? es ? ' · Estimación provisional' : ' · Provisional estimate' : ''}`
  }`
}
