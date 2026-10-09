import type { OutboundWhatsAppMessage } from './360dialog'

export type LifecycleV4Variant =
  | 'queue_joined'
  | 'approaching'
  | 'delayed'
  | 'ready'
  | 'improved_wait_recommended'
  | 'improved_wait_neutral'
  | 'improved_ready'
  | 'expired'
  | 'cancelled_customer'
  | 'cancelled_staff'
  | 'cancelled_unknown'
  | 'service_ended'

export function actualCallCopyVariant(
  lastAcceptedForecastAt: number | null,
  calledAt: number,
  materialThresholdMinutes: number,
): 'ready' | 'improved_ready' {
  if (
    lastAcceptedForecastAt === null ||
    !Number.isFinite(lastAcceptedForecastAt) ||
    !Number.isFinite(calledAt) ||
    !Number.isFinite(materialThresholdMinutes)
  )
    return 'ready'
  return lastAcceptedForecastAt - calledAt >=
    Math.max(0, materialThresholdMinutes) * 60_000
    ? 'improved_ready'
    : 'ready'
}

type Locale = 'es' | 'en'
type Parameter =
  | 'venue'
  | 'reference'
  | 'wait'
  | 'resource'
  | 'recovery'

export type LifecycleV4Button =
  | {
      type: 'quick_reply'
      label: string
      action: 'yield' | 'cancel'
    }
  | {
      type: 'url'
      label: string
      destination: 'venue-selector'
    }

export type LifecycleV4Template = {
  kind: NonNullable<OutboundWhatsAppMessage['notice']>
  variant: LifecycleV4Variant
  locale: Locale
  name: string
  binding: string
  body: string
  footer: string
  parameters: Parameter[]
  examples: string[]
  buttons: LifecycleV4Button[]
}

export function v4TemplateReady(
  env: CloudflareBindings,
  spec: LifecycleV4Template,
) {
  const binding = (env as unknown as Record<string, unknown>)[spec.binding]
  return (
    env.STAGING_CONSENT_APPROVED === 'true' &&
    env.WHATSAPP_V4_TEMPLATES_APPROVED === 'true' &&
    binding === spec.name
  )
}

const sharedActions: Record<Locale, LifecycleV4Button[]> = {
  es: [
    { type: 'quick_reply', label: 'Pasar turno', action: 'yield' },
    { type: 'quick_reply', label: 'Abandonar la lista', action: 'cancel' },
  ],
  en: [
    { type: 'quick_reply', label: 'Pass my turn', action: 'yield' },
    { type: 'quick_reply', label: 'Leave the list', action: 'cancel' },
  ],
}

const selectorAction: Record<Locale, LifecycleV4Button[]> = {
  es: [
    {
      type: 'url',
      label: 'Elegir lista de espera',
      destination: 'venue-selector',
    },
  ],
  en: [
    {
      type: 'url',
      label: 'Choose a waiting list',
      destination: 'venue-selector',
    },
  ],
}

const footer: Record<Locale, string> = {
  es: 'Envía BAJA para dejar de recibir avisos.',
  en: 'Reply STOP to stop receiving updates.',
}

type Copy = {
  kind: LifecycleV4Template['kind']
  variant: LifecycleV4Variant
  parameters: Parameter[]
  body: Record<Locale, string>
  buttons?: Record<Locale, LifecycleV4Button[]>
}

const copy: Copy[] = [
  {
    kind: 'queue_joined',
    variant: 'queue_joined',
    parameters: ['venue', 'reference', 'wait', 'recovery'],
    body: {
      es: '¡Ya estás en la lista de espera de {{1}}!\n\n👤 Tu turno es: {{2}}\n\n{{3}}\n\nConsulta o gestiona tu turno aquí: {{4}}',
      en: 'You’re on the waiting list at {{1}}.\n\n👤 Your turn: {{2}}\n\n{{3}}\n\nView or manage your turn here: {{4}}',
    },
  },
  {
    kind: 'approaching',
    variant: 'approaching',
    parameters: ['venue', 'wait'],
    body: {
      es: '¡Casi es tu turno en {{1}}!\n\n{{2}} Es buen momento para ir acercándote con calma.\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: 'Your turn is getting closer at {{1}}.\n\n{{2}} This is a good time to start making your way over.\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: sharedActions,
  },
  {
    kind: 'delayed',
    variant: 'delayed',
    parameters: ['venue', 'wait'],
    body: {
      es: 'La espera está siendo algo mayor de lo previsto en {{1}}.\n\n{{2}} Sigues en la lista de espera. 🙏🏻 Sentimos las molestias.',
      en: 'The wait at {{1}} is a little longer than expected.\n\n{{2}} You are still on the waiting list. 🙏🏻 We’re sorry for the inconvenience.',
    },
  },
  {
    kind: 'ready',
    variant: 'ready',
    parameters: ['venue', 'resource', 'recovery'],
    body: {
      es: 'Ya es tu turno en {{1}}.\n\nDirígete a {{2}}. Consulta en tu enlace el plazo para mantener tu turno: {{3}}\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: 'It’s your turn at {{1}}.\n\nGo to {{2}}. Check your link for the deadline to keep your turn: {{3}}\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: sharedActions,
  },
  {
    kind: 'improved',
    variant: 'improved_wait_recommended',
    parameters: ['venue', 'wait'],
    body: {
      es: '¡Buenas noticias! Tu espera en {{1}} se ha reducido.\n\n{{2}} Es buen momento para ir acercándote con calma.\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: 'Good news! Your wait at {{1}} has shortened.\n\n{{2}} This is a good time to start making your way over.\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: sharedActions,
  },
  {
    kind: 'improved',
    variant: 'improved_wait_neutral',
    parameters: ['venue', 'wait'],
    body: {
      es: '¡Buenas noticias! Tu espera en {{1}} se ha reducido.\n\n{{2}} Te avisaremos cuando haya novedades importantes.\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: 'Good news! Your wait at {{1}} has shortened.\n\n{{2}} We’ll let you know when there is an important update.\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: sharedActions,
  },
  {
    kind: 'ready',
    variant: 'improved_ready',
    parameters: ['venue', 'resource', 'recovery'],
    body: {
      es: '¡Buenas noticias! Tu turno en {{1}} está disponible antes de lo previsto.\n\nAcércate a {{2}}. Consulta en tu enlace el plazo para mantener tu turno: {{3}}\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: 'Good news! Your turn at {{1}} is available earlier than expected.\n\nGo to {{2}}. Check your link for the deadline to keep your turn: {{3}}\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: sharedActions,
  },
  {
    kind: 'expired',
    variant: 'expired',
    parameters: ['venue'],
    body: {
      es: 'Lo sentimos, tu turno en {{1}} ha expirado.\n\nNo hemos confirmado tu llegada a tiempo y tu turno ya no está activo. Si aún quieres venir, puedes elegir otra lista de espera.',
      en: 'Sorry, your turn at {{1}} has expired.\n\nWe did not confirm your arrival in time, so your turn is no longer active. If you still want to visit, you can choose another waiting list.',
    },
    buttons: selectorAction,
  },
  {
    kind: 'cancelled',
    variant: 'cancelled_customer',
    parameters: ['venue'],
    body: {
      es: 'Has salido de la lista de espera de {{1}}.\n\nTu turno ya no está activo. Si cambias de idea, puedes elegir otra lista de espera.',
      en: 'You have left the waiting list at {{1}}.\n\nYour turn is no longer active. If you change your mind, you can choose another waiting list.',
    },
    buttons: selectorAction,
  },
  {
    kind: 'cancelled',
    variant: 'cancelled_staff',
    parameters: ['venue'],
    body: {
      es: 'El establecimiento ha cancelado tu turno en {{1}}.\n\nConsulta el enlace para ver el estado actualizado.',
      en: 'The venue has cancelled your turn at {{1}}.\n\nUse your link to view the updated status.',
    },
  },
  {
    kind: 'cancelled',
    variant: 'cancelled_unknown',
    parameters: ['venue'],
    body: {
      es: 'Tu turno en {{1}} ya no está activo.\n\nConsulta el enlace para ver el estado actualizado.',
      en: 'Your turn at {{1}} is no longer active.\n\nUse your link to view the updated status.',
    },
  },
  {
    kind: 'service_ended',
    variant: 'service_ended',
    parameters: ['venue'],
    body: {
      es: 'El servicio de {{1}} ha finalizado y tu turno ya no está activo.\n\nPuedes volver a unirte cuando el servicio esté disponible.',
      en: 'Service at {{1}} has ended and your turn is no longer active.\n\nYou can join again when the service is available.',
    },
  },
]

const examples: Record<Parameter, Record<Locale, string>> = {
  venue: { es: 'Example venue', en: 'Example venue' },
  reference: { es: 'ABCD23', en: 'ABCD23' },
  wait: {
    es: 'Hay 2 turnos por delante. La espera estimada es de unos 12 minutos.',
    en: 'There are 2 turns ahead. The estimated wait is around 12 minutes.',
  },
  resource: { es: 'Example terrace', en: 'Example terrace' },
  recovery: {
    es: 'https://example.test/t/example-token?lang=es&source=whatsapp',
    en: 'https://example.test/t/example-token?lang=en&source=whatsapp',
  },
}

export const whatsappV4Catalog: LifecycleV4Template[] = copy.flatMap((item) =>
  (['es', 'en'] as const).map((locale) => {
    const suffix = item.variant.replaceAll('-', '_').toUpperCase()
    return {
      kind: item.kind,
      variant: item.variant,
      locale,
      name: `noqueue_v4_${item.variant}_${locale}`,
      binding: `WHATSAPP_QUEUE_V4_${suffix}_TEMPLATE_${locale.toUpperCase()}`,
      body: item.body[locale],
      footer: footer[locale],
      parameters: item.parameters,
      examples: item.parameters.map((parameter) => examples[parameter][locale]),
      buttons: item.buttons?.[locale] ?? [],
    }
  }),
)

type Message = OutboundWhatsAppMessage & {
  venueId?: string
  recoveryUrl?: string
  copyVariant?: LifecycleV4Variant
}

function inferVariant(message: Message): LifecycleV4Variant {
  if (message.copyVariant) return message.copyVariant
  if (message.notice === 'cancelled')
    return message.cancellationReason === 'customer_cancel'
      ? 'cancelled_customer'
      : message.cancellationReason === 'staff_cancel'
      ? 'cancelled_staff'
      : 'cancelled_unknown'
  if (message.notice === 'improved') return 'improved_wait_neutral'
  if (message.notice === 'queue_joined') return 'queue_joined'
  if (message.notice === 'service_ended') return 'service_ended'
  if (message.notice === 'ready') return 'ready'
  if (message.notice === 'approaching') return 'approaching'
  if (message.notice === 'delayed') return 'delayed'
  if (message.notice === 'expired') return 'expired'
  throw new Error('Invalid v4 lifecycle kind')
}

function waitDescription(message: Message): string {
  const es = message.locale === 'es'
  const ahead = message.ahead
  const position =
    ahead == null || !Number.isInteger(ahead) || ahead < 0
      ? ''
      : ahead === 0
      ? es
        ? 'No tienes turnos por delante.'
        : 'There are no turns ahead.'
      : es
      ? ahead === 1
        ? 'Hay 1 turno por delante.'
        : `Hay ${ahead} turnos por delante.`
      : ahead === 1
      ? 'There is 1 turn ahead.'
      : `There are ${ahead} turns ahead.`
  const known =
    message.estimateQuality !== 'unknown' &&
    message.etaMinutes != null &&
    Number.isFinite(message.etaMinutes) &&
    message.etaMinutes >= 0
  const eta = !known
    ? es
      ? 'Aún no podemos estimar la espera.'
      : 'We cannot estimate the wait yet.'
    : es
    ? `La espera estimada es de unos ${message.etaMinutes} ${message.etaMinutes === 1 ? 'minuto' : 'minutos'}.`
    : `The estimated wait is around ${message.etaMinutes} ${message.etaMinutes === 1 ? 'minute' : 'minutes'}.`
  return [position, eta].filter(Boolean).join(' ')
}

function values(message: Message): Record<Parameter, string> {
  return {
    venue: message.venue,
    reference: message.code,
    wait: waitDescription(message),
    resource: message.resourceName ?? message.serviceName ?? message.venue,
    recovery: message.recoveryUrl ?? '',
  }
}

export function lifecycleV4(message: OutboundWhatsAppMessage) {
  const v4 = message as Message
  const variant = inferVariant(v4)
  const template = whatsappV4Catalog.find(
    (item) => item.variant === variant && item.locale === message.locale,
  )
  if (!template) throw new Error('Invalid v4 lifecycle kind or locale')
  const context = values(v4)
  return { template, parameters: template.parameters.map((parameter) => context[parameter]) }
}

export function renderLifecycleV4(
  message: OutboundWhatsAppMessage,
  _options: { now?: number } = {},
) {
  const v4 = message as Message
  const variant = inferVariant(v4)
  const spec = whatsappV4Catalog.find(
    (item) => item.variant === variant && item.locale === message.locale,
  )
  if (!spec) throw new Error('Invalid v4 lifecycle kind or locale')
  const context = values(v4)
  const body = spec.body.replace(/\{\{(\d+)\}\}/g, (_, number: string) => {
    const parameter = spec.parameters[Number(number) - 1]
    return parameter ? context[parameter] : ''
  })
  return `${body}\n\n${spec.footer}`
}
