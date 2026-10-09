import type { ManualJoin } from '@noqueue/contracts/queue'
import { ApiError, errorMessage } from './api'
import { whatsappConsentNotice } from '../consent/whatsapp-consent-copy'

export type ManualLocale = ManualJoin['locale']

export const manualQueueCopy = {
  es: {
    language: 'Idioma del formulario',
    back: 'Volver',
    title: 'Datos del cliente',
    name: 'Nombre',
    namePlaceholder: 'Indica tu nombre',
    phone: 'Nº de teléfono',
    phonePlaceholder: 'Indica el número nacional',
    phoneInvalid: 'Introduce un número de teléfono válido.',
    diners: '¿Cuántos comensales?',
    dinerCount: 'Número de comensales',
    fewer: 'Menos comensales',
    more: 'Más comensales',
    table: '¿Dónde quieres tu mesa?',
    space: 'Espacio',
    fastest: 'Opción más rápida',
    capacity: 'Selecciona un espacio con capacidad para el grupo.',
    task: '¿Qué tienes que hacer?',
    taskType: 'Tipo de gestión',
    other: 'Otros temas',
    local:
      'Modo local: puedes crear un turno de prueba sin teléfono ni avisos.',
    saving: 'Guardando…',
    add: 'Añadir turno',
    addDescription: 'Añadir a la lista',
    invalid: 'Revisa los datos del cliente.',
    added: 'Turno añadido',
    code: 'Turno',
    link: 'Enlace del turno',
    copy: 'Copiar enlace',
    copied: 'Enlace copiado.',
    copyFailed: 'No se pudo copiar. Selecciona y copia el enlace.',
    open: 'Abrir turno',
    close: 'Cerrar',
    created: 'El turno está creado.',
    consent: 'Consentir notificaciones en WhatsApp sobre novedades de tu turno',
    introduction: whatsappConsentNotice.es.introduction,
    purposeLabel: whatsappConsentNotice.es.purposeLabel,
    purpose: whatsappConsentNotice.es.purpose,
    retentionLabel: whatsappConsentNotice.es.retentionLabel,
    retention: whatsappConsentNotice.es.retention,
    basisLabel: whatsappConsentNotice.es.basisLabel,
    basis: whatsappConsentNotice.es.basis,
    rights: whatsappConsentNotice.es.rights,
    authority: whatsappConsentNotice.es.authority,
  },
  en: {
    language: 'Form language',
    back: 'Back',
    title: 'Customer details',
    name: 'Name',
    namePlaceholder: 'Enter your name',
    phone: 'Phone number',
    phonePlaceholder: 'Enter the national number',
    phoneInvalid: 'Enter a valid phone number.',
    diners: 'How many diners?',
    dinerCount: 'Number of diners',
    fewer: 'Fewer diners',
    more: 'More diners',
    table: 'Where would you like your table?',
    space: 'Space',
    fastest: 'Fastest option',
    capacity: 'Select a space with capacity for the group.',
    task: 'What do you need to do?',
    taskType: 'Service type',
    other: 'Other matters',
    local:
      'Local mode: you can create a test queue entry without a phone or notifications.',
    saving: 'Saving…',
    add: 'Add queue entry',
    addDescription: 'Add to the queue',
    invalid: 'Check the customer details.',
    added: 'Queue entry added',
    code: 'Queue entry',
    link: 'Queue entry link',
    copy: 'Copy link',
    copied: 'Link copied.',
    copyFailed: 'Could not copy. Select and copy the link.',
    open: 'Open queue entry',
    close: 'Close',
    created: 'The queue entry has been created.',
    consent:
      'Consent to WhatsApp notifications about updates to your queue entry',
    introduction: whatsappConsentNotice.en.introduction,
    purposeLabel: whatsappConsentNotice.en.purposeLabel,
    purpose: whatsappConsentNotice.en.purpose,
    retentionLabel: whatsappConsentNotice.en.retentionLabel,
    retention: whatsappConsentNotice.en.retention,
    basisLabel: whatsappConsentNotice.en.basisLabel,
    basis: whatsappConsentNotice.en.basis,
    rights: whatsappConsentNotice.en.rights,
    authority: whatsappConsentNotice.en.authority,
  },
} as const

const englishErrors: Record<string, string> = {
  whatsapp_consent_required:
    'The customer must provide a phone number and consent to WhatsApp notifications.',
  whatsapp_unavailable:
    'WhatsApp notifications are unavailable. Contact the administrator.',
  invalid_join: 'Check the queue entry details.',
  invalid_party_size: 'Check the number of diners.',
  name_required: 'Enter the customer’s name.',
  queue_not_found: 'The queue could not be found.',
  invalid_reception_service: 'This service type is not available.',
  invalid_space_preference:
    'The space does not exist or cannot accommodate this group.',
  queue_unavailable: 'The queue is closed, full or outside opening hours.',
  unauthorized: 'Your session has expired. Sign in again.',
  forbidden: 'You do not have permission for this action.',
  not_found: 'The resource could not be found.',
  rate_limited: 'Too many attempts. Wait a minute.',
  idempotency_conflict: 'This request has changed. Try again.',
  temporarily_unavailable: 'The service is temporarily unavailable. Try again.',
}
export function manualQueueError(error: unknown, locale: ManualLocale) {
  if (locale === 'es') return errorMessage(error)
  if (error instanceof ApiError)
    return (
      englishErrors[error.code ?? ''] ??
      'Could not complete the operation. Try again.'
    )
  if (error instanceof TypeError || !(error instanceof Error))
    return 'Could not complete the operation. Try again.'
  return error.message
}
