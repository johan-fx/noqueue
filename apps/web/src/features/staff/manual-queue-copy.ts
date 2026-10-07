import type { ManualJoin } from '@noqueue/contracts/queue'
import { ApiError, errorMessage } from './api'

export type ManualLocale = ManualJoin['locale']

export const manualQueueCopy = {
  es: {
    language: 'Idioma del formulario',
    back: 'Volver',
    title: 'Datos del cliente',
    name: 'Nombre',
    namePlaceholder: 'Indica tu nombre',
    phone: 'Nº de teléfono',
    phonePlaceholder: 'Indica tu número de teléfono',
    prefix: 'Prefijo telefónico',
    international: 'Internacional',
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
    introduction:
      'De conformidad con la normativa vigente y aplicable en protección de datos de carácter personal, le informamos que sus datos serán incorporados al sistema de tratamiento titularidad de LUMOSA S.A. con CIF A07207848 y domicilio social sito en Avda Cas Saboners Nº8, 07181, Calviá - Illes Balears y que a continuación se relacionan sus respectivas finalidades, plazos de conservación y bases legitimadoras.',
    purposeLabel: 'Finalidad',
    purpose:
      'Captación, registro y tratamiento de los datos con la finalidad de remitir comunicaciones y documentación a través de la plataforma de WhatsApp con comunicación directa y bidireccional.',
    retentionLabel: 'Plazo de conservación',
    retention: 'Mientras se mantenga el consentimiento prestado.',
    basisLabel: 'Base legítima',
    basis: 'El consentimiento del interesado.',
    rights:
      'De acuerdo con los derechos que le confiere la normativa vigente y aplicable en protección de datos podrá ejercer los derechos de acceso, rectificación, limitación de tratamiento, supresión (“derecho al olvido”), portabilidad y oposición al tratamiento de sus datos de carácter personal así como la revocación del consentimiento prestado para el tratamiento de los mismos, dirigiendo su petición a la dirección postal indicada más arriba o al correo electrónico',
    authority:
      'Podrá dirigirse a la Autoridad de Control competente para presentar la reclamación que considere oportuna. LUMOSA S.A. informa que, al activar esta opción, otorga su consentimiento explícito para el tratamiento de sus datos con las finalidades mencionadas anteriormente.',
    countries: [
      'España',
      'Francia',
      'Portugal',
      'Reino Unido',
      'Alemania',
      'Italia',
      'Estados Unidos / Canadá',
      'Otro: introduce el número internacional completo',
    ],
  },
  en: {
    language: 'Form language',
    back: 'Back',
    title: 'Customer details',
    name: 'Name',
    namePlaceholder: 'Enter your name',
    phone: 'Phone number',
    phonePlaceholder: 'Enter your phone number',
    prefix: 'Phone country code',
    international: 'International',
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
    introduction:
      'In accordance with current applicable personal data protection legislation, we inform you that your data will be incorporated into the data processing system owned by LUMOSA S.A., with tax identification number A07207848 and registered office at Avda Cas Saboners Nº8, 07181, Calviá - Illes Balears. The corresponding purposes, retention periods and legal bases are set out below.',
    purposeLabel: 'Purpose',
    purpose:
      'Collection, recording and processing of data to send communications and documentation through the WhatsApp platform, enabling direct, two-way communication.',
    retentionLabel: 'Retention period',
    retention: 'For as long as your consent remains in effect.',
    basisLabel: 'Legal basis',
    basis: 'The data subject’s consent.',
    rights:
      'Under current applicable data protection legislation, you may exercise your rights of access, rectification, restriction of processing, erasure (“right to be forgotten”), data portability and objection to the processing of your personal data, as well as withdraw your consent to such processing, by sending your request to the postal address stated above or to',
    authority:
      'You may contact the competent supervisory authority to lodge any complaint you consider appropriate. LUMOSA S.A. informs you that, by enabling this option, you give your explicit consent to the processing of your data for the purposes stated above.',
    countries: [
      'Spain',
      'France',
      'Portugal',
      'United Kingdom',
      'Germany',
      'Italy',
      'United States / Canada',
      'Other: enter the complete international number',
    ],
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
