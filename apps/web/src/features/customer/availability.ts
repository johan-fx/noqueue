import type { AdmissionStatus } from '@noqueue/contracts/queue'
import type { Locale } from './shared'

type PresentationStatus = {
  [K in keyof AdmissionStatus]?: AdmissionStatus[K] | undefined
}
export function visualWaitingPeople(service: PresentationStatus) {
  const real = service.waitingPeople ?? 0
  return real > 0
    ? real
    : service.serviceOpen && service.queueState === 'active'
    ? 1
    : 0
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
      : `${estimate} min`
  }`
}
