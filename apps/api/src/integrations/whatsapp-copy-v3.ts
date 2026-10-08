import type { OutboundWhatsAppMessage } from './360dialog'

type Locale = 'es' | 'en'
type Kind = NonNullable<OutboundWhatsAppMessage['notice']>
type Variant = 'default' | 'customer' | 'staff' | 'unknown'
type Parameter = 'wait' | 'details' | 'arrival' | 'reference'
export type LifecycleV3Template = {
  kind: Kind
  variant: Variant
  locale: Locale
  name: string
  binding: string
  body: string
  footer: string
  button: string
  parameters: Parameter[]
  examples: string[]
}

/** Missing means historical/default v2; an explicitly invalid profile never falls back. */
export function copyVersion(env: {
  WHATSAPP_COPY_VERSION?: string
}): 2 | 3 | null {
  if (
    env.WHATSAPP_COPY_VERSION === undefined ||
    env.WHATSAPP_COPY_VERSION === '2'
  )
    return 2
  return env.WHATSAPP_COPY_VERSION === '3' ? 3 : null
}

const openings: Record<Kind, Record<Locale, string>> = {
  queue_joined: {
    es: 'Ya estás en la cola. Te avisaremos cuando sea tu turno.',
    en: 'You’re on the waiting list. We’ll let you know when it’s your turn.',
  },
  approaching: {
    es: 'Es buen momento para ir acercándote con calma. Te avisaremos cuando sea tu turno.',
    en: 'It’s a good time to start making your way over. We’ll let you know when it’s your turn.',
  },
  delayed: {
    es: 'La espera está siendo un poco mayor de lo previsto. Sigues en la cola.',
    en: 'The wait is a little longer than expected. You’re still on the waiting list.',
  },
  improved: {
    es: 'Tu turno se acerca más rápido de lo previsto.',
    en: 'Your turn is coming up sooner than expected.',
  },
  ready: { es: '¡Ya es tu turno!', en: 'It’s your turn!' },
  expired: {
    es: 'Tu turno ha terminado porque ha pasado el plazo para llegar.',
    en: 'Your turn has ended because the arrival deadline has passed.',
  },
  cancelled: {
    es: 'Tu turno ha sido cancelado.',
    en: 'Your turn has been cancelled.',
  },
  service_ended: {
    es: 'El servicio ha terminado y tu turno ha finalizado.',
    en: 'The service has ended, so your turn has ended too.',
  },
}
const cancellationOpenings = {
  customer: {
    es: 'Has cancelado tu turno.',
    en: 'You’ve cancelled your turn.',
  },
  staff: {
    es: 'El personal del establecimiento ha cancelado tu turno.',
    en: 'The venue staff have cancelled your turn.',
  },
}
function values(message: OutboundWhatsAppMessage): Record<Parameter, string> {
  const es = message.locale === 'es'
  const service = message.serviceName || message.venue
  const reference = [...new Set([message.venue, service]), message.code]
    .filter(Boolean)
    .join(' · ')
  const minutes = message.etaMinutes
  const known =
    message.estimateQuality !== 'unknown' &&
    minutes != null &&
    Number.isFinite(minutes) &&
    minutes >= 0
  const eta = !known
    ? es
      ? 'Aún no podemos estimar la espera.'
      : 'We can’t estimate the wait yet.'
    : es
    ? minutes === 1
      ? 'Calculamos alrededor de 1 minuto de espera.'
      : `Calculamos unos ${minutes} minutos de espera.`
    : `We estimate a wait of around ${minutes} ${
        minutes === 1 ? 'minute' : 'minutes'
      }.`
  const ahead = message.ahead
  const position =
    ahead == null || !Number.isInteger(ahead) || ahead < 0
      ? ''
      : ahead === 0
      ? es
        ? 'Estás al principio de la cola.'
        : 'You’re at the front of the waiting list.'
      : es
      ? ahead === 1
        ? 'Hay 1 turno por delante.'
        : `Hay ${ahead} turnos por delante.`
      : `There ${
          ahead === 1 ? 'is 1 turn' : `are ${ahead} turns`
        } ahead of you.`
  const time =
    message.arrivalDeadlineAt == null
      ? null
      : new Intl.DateTimeFormat(es ? 'es-ES' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(message.arrivalDeadlineAt)
  const wait = [eta, position].filter(Boolean).join(' ')
  const action = message.approachRecommended
    ? es
      ? 'Es buen momento para ir acercándote con calma. Te avisaremos cuando sea tu turno.'
      : 'It’s a good time to start making your way over. We’ll let you know when it’s your turn.'
    : es
    ? 'Consulta el estado de tu turno en el enlace.'
    : 'Check the status of your turn using the link.'
  const arrival = es
    ? `Acude a ${service}${
        message.resourceName ? ` · ${message.resourceName}` : ''
      }.`
    : `Please come to ${service}${
        message.resourceName ? ` · ${message.resourceName}` : ''
      }.`
  const deadline = time
    ? es
      ? `Llega antes de las ${time}.`
      : `Arrive before ${time}.`
    : es
    ? 'Consulta tu plazo de llegada en el enlace.'
    : 'Check your arrival deadline using the link.'
  return {
    wait,
    details: `${action} ${wait}`,
    arrival: `${arrival} ${deadline}`,
    reference,
  }
}

function template(
  kind: Kind,
  locale: Locale,
  variant: Variant,
): LifecycleV3Template {
  const es = locale === 'es'
  const opening =
    kind === 'cancelled' && (variant === 'customer' || variant === 'staff')
      ? cancellationOpenings[variant][locale]
      : openings[kind][locale]
  const parameters: Parameter[] =
    kind === 'ready'
      ? ['arrival', 'reference']
      : kind === 'improved'
      ? ['details', 'reference']
      : ['queue_joined', 'approaching', 'delayed'].includes(kind)
      ? ['wait', 'reference']
      : ['reference']
  const final =
    kind === 'expired'
      ? es
        ? 'Elige una cola y vuelve a inscribirte si lo necesitas.'
        : 'Choose a queue and join again if you need to.'
      : kind === 'service_ended'
      ? es
        ? 'Puedes volver a inscribirte cuando el servicio esté disponible.'
        : 'You can join again when the service is available.'
      : es
      ? 'Puedes consultar tu turno en el enlace.'
      : 'You can check your turn using the link.'
  const suffix = kind === 'cancelled' ? `_${variant}` : ''
  const name = `noqueue_v3_${kind}${suffix}_${locale}`
  const examples = values({
    phone: '+34600000000',
    token: 'example',
    locale,
    venue: 'Example venue',
    serviceName: 'Example service',
    code: 'ABCD23',
    etaMinutes: 12,
    ahead: 2,
    estimateQuality: 'estimated',
    resourceName: 'Example terrace',
    approachRecommended: true,
  })
  return {
    kind,
    locale,
    variant,
    name,
    binding: `WHATSAPP_QUEUE_V3_${kind.toUpperCase()}${suffix.toUpperCase()}_TEMPLATE_${locale.toUpperCase()}`,
    body: [
      opening,
      ...parameters.map((parameter, index) =>
        parameter === 'reference'
          ? `${es ? 'Tu turno' : 'Your turn'}: {{${index + 1}}}`
          : `{{${index + 1}}}`,
      ),
      final,
    ].join('\n\n'),
    footer: es
      ? 'Envía BAJA para dejar de recibir avisos.'
      : 'Reply STOP to stop receiving updates.',
    button:
      kind === 'expired' || kind === 'service_ended'
        ? es
          ? 'Volver a inscribirme'
          : 'Join again'
        : es
        ? 'Ver mi turno'
        : 'View my turn',
    parameters,
    examples: parameters.map((p) => examples[p]),
  }
}

/** Registration manifest is also the renderer contract: only parameters used by each body are sent. */
export const whatsappV3Catalog = (Object.keys(openings) as Kind[]).flatMap(
  (kind) =>
    (['es', 'en'] as const).flatMap((locale) =>
      (kind === 'cancelled'
        ? (['customer', 'staff', 'unknown'] as const)
        : (['default'] as const)
      ).map((variant) => template(kind, locale, variant)),
    ),
)
export function lifecycleV3(message: OutboundWhatsAppMessage) {
  const variant: Variant =
    message.notice !== 'cancelled'
      ? 'default'
      : message.cancellationReason === 'customer_cancel'
      ? 'customer'
      : message.cancellationReason === 'staff_cancel'
      ? 'staff'
      : 'unknown'
  const spec = whatsappV3Catalog.find(
    (t) =>
      t.kind === message.notice &&
      t.locale === message.locale &&
      t.variant === variant,
  )
  if (!spec) throw new Error('Invalid v3 lifecycle kind or locale')
  const context = values(message)
  return { template: spec, parameters: spec.parameters.map((p) => context[p]) }
}
export function renderLifecycleV3(
  message: OutboundWhatsAppMessage,
  link: string,
) {
  const { template, parameters } = lifecycleV3(message)
  const body = template.body.replace(
    /\{\{(\d+)\}\}/g,
    (_, number: string) => parameters[Number(number) - 1]!,
  )
  return `${body}\n${link}\n\n${template.footer}`
}
export function v3TemplateReady(
  env: CloudflareBindings,
  spec: LifecycleV3Template,
) {
  const binding = (env as unknown as Record<string, unknown>)[spec.binding]
  return (
    env.STAGING_CONSENT_APPROVED === 'true' &&
    env.WHATSAPP_V3_TEMPLATES_APPROVED === 'true' &&
    binding === spec.name
  )
}
