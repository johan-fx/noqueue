import { hmac } from './crypto'

export type WhatsAppAction = 'yield' | 'cancel'
export type WhatsAppActionPhase = 'waiting' | 'called'
export type WhatsAppActionContext = {
  notificationId: string
  entryId: string
  action: WhatsAppAction
  phase: WhatsAppActionPhase
  callCycle: number
  expiresAt: number
}
export type TrustedWhatsAppAction = {
  notificationId: string
  entryId: string
  webhookEventId: string
  providerContextId: string
  phoneHash: string
  occurredAt: number
  action: WhatsAppAction
  phase: WhatsAppActionPhase
  callCycle: number
  expiresAt: number
  replyWithinServiceWindow: boolean
}

function prefix(action: WhatsAppAction) {
  return action === 'yield' ? 'y' : 'c'
}

export async function signWhatsAppAction(
  secret: string,
  context: WhatsAppActionContext,
) {
  const payload = JSON.stringify([
    'wa-action:v1',
    context.notificationId,
    context.entryId,
    context.action,
    context.phase,
    context.callCycle,
    context.expiresAt,
  ])
  return `wa1.${prefix(context.action)}.${await hmac(secret, payload)}`
}

export function parseWhatsAppAction(value: string): WhatsAppAction | null {
  const matched = /^wa1\.([yc])\.([a-f0-9]{64})$/.exec(value)
  return matched ? (matched[1] === 'y' ? 'yield' : 'cancel') : null
}

export function renderWhatsAppActionResult(
  locale: 'es' | 'en',
  action: WhatsAppAction,
  outcome: string,
) {
  if (locale === 'es') {
    if (action === 'cancel')
      return 'Has salido de la lista y se ha liberado tu turno.'
    if (outcome === 'called_handoff')
      return '*Has pasado el turno.* La plaza se ha ofrecido a la siguiente persona compatible.'
    if (outcome === 'returned_to_waiting')
      return '*Has pasado el turno* y has vuelto a esperar en tu *misma posición*.'
    return '*Has pasado el turno*; tu posición en la lista se ha actualizado.'
  }
  if (action === 'cancel')
    return 'You have left the waiting list and your place has been released.'
  if (outcome === 'called_handoff')
    return '*You passed your turn.* The place has been offered to the next compatible party.'
  if (outcome === 'returned_to_waiting')
    return '*You passed your turn* and are waiting again in your *same position*.'
  return '*You passed your turn*; your position in the list has been updated.'
}

export function renderWhatsAppActionError(locale: 'es' | 'en', error: string) {
  if (locale === 'es') {
    if (error === 'no_compatible_successor')
      return 'No hay otra persona compatible; tu turno no ha cambiado.'
    return 'Este botón ya no está disponible. Consulta tu enlace para ver el estado actual.'
  }
  if (error === 'no_compatible_successor')
    return 'There is no compatible party to take your turn; your place has not changed.'
  return 'This button is no longer available. Check your link for the current status.'
}

export function renderWhatsAppActionSelectorLabel(locale: 'es' | 'en') {
  return locale === 'es' ? 'Elegir lista' : 'Choose a list'
}
