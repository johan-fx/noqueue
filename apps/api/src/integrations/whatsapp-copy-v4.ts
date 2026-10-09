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

export type LifecycleV4TemplateVariant = LifecycleV4Variant

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

export type LifecycleV4Environment = 'staging' | 'production'

const environmentOrigins: Record<LifecycleV4Environment, string> = {
  staging: 'https://staging.noqueue-app.com',
  production: 'https://noqueue-app.com',
}

export function v4EnvironmentForOrigin(
  origin: string | undefined,
): LifecycleV4Environment | null {
  if (!origin) return null
  try {
    const parsed = new URL(origin)
    if (
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.username !== '' ||
      parsed.password !== ''
    )
      return null
    if (parsed.origin === environmentOrigins.staging) return 'staging'
    if (parsed.origin === environmentOrigins.production) return 'production'
  } catch {
    return null
  }
  return null
}

type LifecycleV4ButtonDraft =
  | {
      type: 'quick_reply'
      label: string
      action: 'yield' | 'cancel'
    }
  | {
      type: 'url'
      label: string
      destination: 'turn' | 'venue-selector'
    }

export type LifecycleV4Button =
  | {
      type: 'quick_reply'
      label: string
      action: 'yield' | 'cancel'
    }
  | {
      type: 'url'
      label: string
      destination: 'turn' | 'venue-selector'
      urlPattern: string
    }

export type LifecycleV4Template = {
  kind: NonNullable<OutboundWhatsAppMessage['notice']>
  variant: LifecycleV4TemplateVariant
  locale: Locale
  environment?: LifecycleV4Environment
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
  if (
    spec.environment &&
    v4EnvironmentForOrigin(env.PUBLIC_APP_ORIGIN) !== spec.environment
  )
    return false
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

const turnAction: Record<Locale, LifecycleV4ButtonDraft[]> = {
  es: [{ type: 'url', label: 'Consultar turno', destination: 'turn' }],
  en: [{ type: 'url', label: 'View my turn', destination: 'turn' }],
}

const selectorAction: Record<Locale, LifecycleV4ButtonDraft[]> = {
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
  variant: LifecycleV4TemplateVariant
  parameters: Parameter[]
  body: Record<Locale, string>
  buttons?: Record<Locale, LifecycleV4ButtonDraft[]>
}

const copy: Copy[] = [
  {
    kind: 'queue_joined',
    variant: 'queue_joined',
    parameters: ['venue', 'reference', 'wait'],
    body: {
      es: '¡Ya estás en la lista de espera de {{1}}!\n\n👤 Tu turno es: {{2}}\n\nPor ahora, *{{3}}*\n\nConsulta el botón para ver o gestionar tu turno.',
      en: 'You’re on the waiting list at {{1}}.\n\n👤 Your turn: {{2}}\n\nFor now, *{{3}}*\n\nUse the button to view or manage your turn.',
    },
    buttons: turnAction,
  },
  {
    kind: 'approaching',
    variant: 'approaching',
    parameters: ['venue', 'wait'],
    body: {
      es: '¡Casi es tu turno en {{1}}!\n\nPor ahora, *{{2}}* Es buen momento para ir acercándote con calma.\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: 'Your turn is getting closer at {{1}}.\n\nFor now, *{{2}}* This is a good time to start making your way over.\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: sharedActions,
  },
  {
    kind: 'delayed',
    variant: 'delayed',
    parameters: ['venue', 'wait'],
    body: {
      es: 'La espera está siendo algo mayor de lo previsto en {{1}}.\n\n*{{2}}* Sigues en la lista de espera. 🙏🏻 Sentimos las molestias.',
      en: 'The wait at {{1}} is a little longer than expected.\n\n*{{2}}* You are still on the waiting list. 🙏🏻 We’re sorry for the inconvenience.',
    },
  },
  {
    kind: 'ready',
    variant: 'ready',
    parameters: ['venue', 'resource'],
    body: {
      es: 'Ya es tu turno en {{1}}.\n\n*Dirígete a {{2}}. Consulta el botón para conocer el plazo de llegada.*\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: 'It’s your turn at {{1}}.\n\n*Go to {{2}}. Check the button for your arrival deadline.*\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: {
      es: [...sharedActions.es, ...turnAction.es],
      en: [...sharedActions.en, ...turnAction.en],
    },
  },
  {
    kind: 'improved',
    variant: 'improved_wait_recommended',
    parameters: ['venue', 'wait'],
    body: {
      es: '*¡Buenas noticias! Tu espera en {{1}} se ha reducido.*\n\n*{{2}}* Es buen momento para ir acercándote con calma.\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: '*Good news! Your wait at {{1}} has shortened.*\n\n*{{2}}* This is a good time to start making your way over.\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: sharedActions,
  },
  {
    kind: 'improved',
    variant: 'improved_wait_neutral',
    parameters: ['venue', 'wait'],
    body: {
      es: '*¡Buenas noticias! Tu espera en {{1}} se ha reducido.*\n\n*{{2}}* Te avisaremos cuando haya novedades importantes.\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: '*Good news! Your wait at {{1}} has shortened.*\n\n*{{2}}* We’ll let you know when there is an important update.\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: sharedActions,
  },
  {
    kind: 'ready',
    variant: 'improved_ready',
    parameters: ['venue', 'resource'],
    body: {
      es: '¡Buenas noticias! Tu turno en {{1}} está disponible antes de lo previsto.\n\n*Acércate a {{2}}. Consulta el botón para conocer el plazo de llegada.*\n\nSi crees que vas a llegar tarde, puedes pasar turno o abandonar la lista de espera.',
      en: 'Good news! Your turn at {{1}} is available earlier than expected.\n\n*Go to {{2}}. Check the button for your arrival deadline.*\n\nIf you may arrive late, you can pass your turn or leave the list.',
    },
    buttons: {
      es: [...sharedActions.es, ...turnAction.es],
      en: [...sharedActions.en, ...turnAction.en],
    },
  },
  {
    kind: 'expired',
    variant: 'expired',
    parameters: ['venue'],
    body: {
      es: '*Lo sentimos, tu turno en {{1}} ha expirado.*\n\nNo hemos confirmado tu llegada a tiempo y tu turno ya no está activo. Si aún quieres venir, puedes elegir otra lista de espera.',
      en: '*Sorry, your turn at {{1}} has expired.*\n\nWe did not confirm your arrival in time, so your turn is no longer active. If you still want to visit, you can choose another waiting list.',
    },
    buttons: selectorAction,
  },
  {
    kind: 'cancelled',
    variant: 'cancelled_customer',
    parameters: ['venue'],
    body: {
      es: '*Has salido de la lista de espera de {{1}}.*\n\nTu turno ya no está activo. Si cambias de idea, puedes elegir otra lista de espera.',
      en: '*You have left the waiting list at {{1}}.*\n\nYour turn is no longer active. If you change your mind, you can choose another waiting list.',
    },
    buttons: selectorAction,
  },
  {
    kind: 'cancelled',
    variant: 'cancelled_staff',
    parameters: ['venue'],
    body: {
      es: 'El establecimiento ha cancelado tu turno en {{1}}.\n\nConsulta el botón para ver el estado actualizado.',
      en: 'The venue has cancelled your turn at {{1}}.\n\nUse the button to view the updated status.',
    },
    buttons: turnAction,
  },
  {
    kind: 'cancelled',
    variant: 'cancelled_unknown',
    parameters: ['venue'],
    body: {
      es: 'Tu turno en {{1}} ya no está activo.\n\nConsulta el botón para ver el estado actualizado.',
      en: 'Your turn at {{1}} is no longer active.\n\nUse the button to view the updated status.',
    },
    buttons: turnAction,
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
}

const lowercaseWaitExamples: Record<Locale, string> = {
  es: 'hay 2 turnos por delante. La espera estimada es de unos 12 minutos.',
  en: 'there are 2 turns ahead. The estimated wait is around 12 minutes.',
}

function catalogEntry(
  item: Copy,
  locale: Locale,
  environment?: LifecycleV4Environment,
): LifecycleV4Template {
  const suffix = item.variant.replaceAll('-', '_').toUpperCase()
  const baseName = `noqueue_v4_${item.variant}_${locale}`
  const buttons: LifecycleV4Button[] = (item.buttons?.[locale] ?? []).map(
    (button) => {
      if (button.type === 'quick_reply') return button
      if (!environment)
        throw new Error('URL templates require an explicit target environment')
      return {
        ...button,
        urlPattern: `${environmentOrigins[environment]}${
          button.destination === 'turn' ? '/t/{{1}}' : '/v/{{1}}'
        }`,
      }
    },
  )
  return {
    kind: item.kind,
    variant: item.variant,
    locale,
    ...(environment ? { environment } : {}),
    name: environment ? `${baseName}_${environment}` : baseName,
    binding: `WHATSAPP_QUEUE_V4_${suffix}_TEMPLATE_${locale.toUpperCase()}`,
    body: item.body[locale],
    footer: footer[locale],
    parameters: item.parameters,
    examples: item.parameters.map((parameter) =>
      parameter === 'wait' &&
      (item.variant === 'queue_joined' || item.variant === 'approaching')
        ? lowercaseWaitExamples[locale]
        : examples[parameter][locale],
    ),
    buttons,
  }
}

export const whatsappV4Catalog: LifecycleV4Template[] = copy.flatMap((item) =>
  (['es', 'en'] as const).flatMap((locale) => {
    const hasUrlButton = (item.buttons?.[locale] ?? []).some(
      (button) => button.type === 'url',
    )
    return hasUrlButton
      ? (['staging', 'production'] as const).map((environment) =>
          catalogEntry(item, locale, environment),
        )
      : [catalogEntry(item, locale)]
  }),
)

export function whatsappV4CatalogForEnvironment(
  environment: LifecycleV4Environment,
) {
  return whatsappV4Catalog.filter(
    (template) =>
      template.environment === undefined ||
      template.environment === environment,
  )
}

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

function aheadDescription(message: Message): string {
  const es = message.locale === 'es'
  const ahead = message.ahead
  if (ahead == null || !Number.isInteger(ahead) || ahead < 0) return ''
  if (ahead === 0)
    return es
      ? 'No tienes turnos por delante.'
      : 'There are no turns ahead.'
  return es
    ? ahead === 1
      ? 'Hay 1 turno por delante.'
      : `Hay ${ahead} turnos por delante.`
    : ahead === 1
      ? 'There is 1 turn ahead.'
      : `There are ${ahead} turns ahead.`
}

function etaDescription(message: Message): string {
  const es = message.locale === 'es'
  const known =
    message.estimateQuality !== 'unknown' &&
    message.etaMinutes != null &&
    Number.isFinite(message.etaMinutes) &&
    message.etaMinutes >= 0
  if (!known)
    return es
      ? 'Aún no podemos estimar la espera.'
      : 'We cannot estimate the wait yet.'
  return es
    ? `La espera estimada es de unos ${message.etaMinutes} ${message.etaMinutes === 1 ? 'minuto' : 'minutos'}.`
    : `The estimated wait is around ${message.etaMinutes} ${message.etaMinutes === 1 ? 'minute' : 'minutes'}.`
}

function waitDescription(message: Message, lowercaseStart = false): string {
  const wait = [aheadDescription(message), etaDescription(message)]
    .filter(Boolean)
    .join(' ')
  return lowercaseStart ? `${wait.slice(0, 1).toLowerCase()}${wait.slice(1)}` : wait
}

function values(message: Message): Record<Parameter, string> {
  return {
    venue: message.venue,
    reference: message.code,
    wait: waitDescription(
      message,
      message.notice === 'queue_joined' || message.notice === 'approaching',
    ),
    resource: message.resourceName ?? message.serviceName ?? message.venue,
  }
}

function selectedTemplateVariant(message: Message): LifecycleV4TemplateVariant {
  return inferVariant(message)
}

export function lifecycleV4(
  message: OutboundWhatsAppMessage,
  environment: LifecycleV4Environment = 'production',
) {
  const v4 = message as Message
  const variant = selectedTemplateVariant(v4)
  const template = whatsappV4Catalog.find(
    (item) =>
      item.variant === variant &&
      item.locale === message.locale &&
      (item.environment === undefined || item.environment === environment),
  )
  if (!template) throw new Error('Invalid v4 lifecycle kind or locale')
  const context = values(v4)
  return { template, parameters: template.parameters.map((parameter) => context[parameter]) }
}

export function renderLifecycleV4(
  message: OutboundWhatsAppMessage,
  options: {
    now?: number
    environment?: LifecycleV4Environment
    includeButtonPreview?: boolean
  } = {},
) {
  const { template, parameters } = lifecycleV4(
    message,
    options.environment ?? 'production',
  )
  const body = template.body.replace(/\{\{(\d+)\}\}/g, (_, number: string) => {
    return parameters[Number(number) - 1] ?? ''
  })
  const buttonPreview =
    options.includeButtonPreview && template.buttons.length > 0
      ? `\n\n${template.buttons.map((button) => `[${button.label}]`).join('  ')}`
      : ''
  return `${body}${buttonPreview}\n\n${template.footer}`
}
