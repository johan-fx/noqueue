import { visibleWaitingCount } from '@noqueue/contracts/queue'
import type { PushSnapshot } from './lifecycle'

/** Mobile adaptation of V4, not a rendered WhatsApp template with its footer removed. */
export function renderPushCopy(s: PushSnapshot): string {
  const es = s.locale === 'es', venue = s.venue
  const ahead = s.ahead != null && Number.isInteger(s.ahead) && s.ahead >= 0 ? visibleWaitingCount(s.ahead) : null
  const eta = s.estimateQuality !== 'unknown' && s.etaMinutes != null && Number.isFinite(s.etaMinutes) && s.etaMinutes >= 0 ? s.etaMinutes : null
  const wait = [
    ahead === null ? '' : es ? `Hay ${ahead} ${ahead === 1 ? 'turno' : 'turnos'} por delante.` : `There ${ahead === 1 ? 'is 1 turn' : `are ${ahead} turns`} ahead of you.`,
    eta === null ? es ? 'Aún no podemos estimar la espera.' : 'We cannot estimate the wait yet.'
      : es ? `La espera estimada es de unos ${eta} ${eta === 1 ? 'minuto' : 'minutos'}.` : `The estimated wait is around ${eta} ${eta === 1 ? 'minute' : 'minutes'}.`,
  ].filter(Boolean).join(' ')
  const approach = es ? 'Es buen momento para ir acercándote con calma.' : 'This is a good time to start making your way over.'
  const actions = es ? 'Si crees que vas a llegar tarde, abre NoQueue para pasar turno o abandonar la lista de espera.' : 'If you may arrive late, open NoQueue to pass your turn or leave the list.'
  const destination = s.resourceName ?? s.serviceName ?? venue
  switch (s.copyVariant) {
    case 'approaching': return es ? `¡Casi es tu turno en ${venue}!\n\n${wait} ${approach}\n\n${actions}` : `Your turn is getting closer at ${venue}.\n\n${wait} ${approach}\n\n${actions}`
    case 'delayed': return es ? `La espera está siendo algo mayor de lo previsto en ${venue}.\n\n${wait} Sigues en la lista de espera. 🙏🏻 Sentimos las molestias.` : `The wait at ${venue} is a little longer than expected.\n\n${wait} You are still on the waiting list. 🙏🏻 We’re sorry for the inconvenience.`
    case 'improved_wait_recommended':
    case 'improved_wait_neutral': {
      const next = s.copyVariant === 'improved_wait_recommended' ? approach : es ? 'Te avisaremos cuando haya novedades importantes.' : 'We’ll let you know when there is an important update.'
      return es ? `¡Buenas noticias! Tu espera en ${venue} se ha reducido.\n\n${wait} ${next}\n\n${actions}` : `Good news! Your wait at ${venue} has shortened.\n\n${wait} ${next}\n\n${actions}`
    }
    case 'ready':
    case 'improved_ready': {
      const first = s.copyVariant === 'improved_ready'
        ? es ? `¡Buenas noticias! Tu turno en ${venue} está disponible antes de lo previsto.` : `Good news! Your turn at ${venue} is available earlier than expected.`
        : es ? `Ya es tu turno en ${venue}.` : `It’s your turn at ${venue}.`
      return es ? `${first}\n\nDirígete a ${destination}. Abre NoQueue para consultar el plazo de llegada.\n\n${actions}` : `${first}\n\nGo to ${destination}. Open NoQueue to check your arrival deadline.\n\n${actions}`
    }
    case 'expired': return es ? `Lo sentimos, tu turno en ${venue} ha expirado.\n\nNo hemos confirmado tu llegada a tiempo y tu turno ya no está activo. Si aún quieres venir, abre NoQueue para elegir otra lista de espera.` : `Sorry, your turn at ${venue} has expired.\n\nWe did not confirm your arrival in time, so your turn is no longer active. If you still want to visit, open NoQueue to choose another waiting list.`
    case 'cancelled_staff': return es ? `El establecimiento ha cancelado tu turno en ${venue}.\n\nAbre NoQueue para ver el estado actualizado.` : `The venue has cancelled your turn at ${venue}.\n\nOpen NoQueue to view the updated status.`
    case 'cancelled_unknown': return es ? `Tu turno en ${venue} ya no está activo.\n\nAbre NoQueue para ver el estado actualizado.` : `Your turn at ${venue} is no longer active.\n\nOpen NoQueue to view the updated status.`
    case 'service_ended': return es ? `El servicio de ${venue} ha finalizado y tu turno ya no está activo.\n\nPuedes volver a unirte cuando el servicio esté disponible.` : `Service at ${venue} has ended and your turn is no longer active.\n\nYou can join again when service is available.`
  }
}
