import { LoadingSpinner } from '@/components/LoadingSpinner'
import { customerFetch } from '@/data/api/customer'
import { prepareMobileJoin, finishMobileJoin } from '@/platform/capacitor/installation'
import { detectRuntime } from '@/app/bootstrap/runtime'
import { usePushAfterJoin } from '@/platform/capacitor/native-push-context'
import { usePublicAnalyticsPage } from '@/features/privacy/use-public-analytics-page'
import { useLocale, usePublicResource } from './public-resource'
import { useEffect, useState } from 'react'
import { visitService } from './discovery-state'
import { useParams } from 'react-router'
import { useAppNavigate } from '@/app/navigation/native-transitions'
import {
  joinedEntrySchema,
  mobileActiveConflictSchema,
  publicServiceSchema,
  mobileServiceJoinSchema,
  type ServiceJoin,
  type PublicServiceJoin,
} from '@noqueue/contracts/queue'
import { ServiceForm } from './ServiceForm'
import { RestaurantForm } from './RestaurantForm'
import { CustomerShell, LoadError } from './shared'
const parse = (value: unknown) => publicServiceSchema.parse(value)
export function PublicQueue() {
  const channel = detectRuntime() === 'native' ? 'mobile' : 'web'
  const { queueId } = useParams()
  const navigate = useAppNavigate()
  const requestPushAfterJoin = usePushAfterJoin()
  const [attemptedQueue, setAttemptedQueue] = useState<string | undefined>()
  const [locale, setLocale] = useLocale()
  const {
    data: service,
    error,
    refresh,
  } = usePublicResource(`/api/v1/public/services/${queueId}`, parse)
  useEffect(() => {
    if (service) visitService(service.id)
  }, [service])
  usePublicAnalyticsPage(Boolean(service), error)
  const Form = service?.type === 'restaurant' ? RestaurantForm : ServiceForm

  async function submit(input: ServiceJoin | PublicServiceJoin, key: string) {
    setAttemptedQueue(queueId)
    if (channel === 'mobile') {
      const intent = await prepareMobileJoin(queueId!, key, mobileServiceJoinSchema.parse(input))
      key = intent.key
      input = intent.input
    }
    const response = await customerFetch(
      `/api/v1/public/services/${queueId}/entries`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(input),
      },
    ).catch(error => {
      if (channel === 'mobile') window.dispatchEvent(new Event('noqueue:turn-changed'))
      throw error
    })
    if (!response.ok) {
      // Definitive validation/admission rejection did not commit a turn. Keep
      // ambiguous network/5xx/conflict intents, but do not fill the vault with
      // rejected form edits. A retry still uses the form's idempotency key.
      if (channel === 'mobile') {
        const error = await response.json().catch(() => null) as { error?: string } | null
        const active = mobileActiveConflictSchema.safeParse(error)
        if (response.status === 409 && active.success) {
          await finishMobileJoin(key)
          window.dispatchEvent(new Event('noqueue:turn-changed'))
          navigate(`/t/${active.data.entry.recoveryToken}?lang=${locale}`, { replace: true })
          return
        }
        if ([400, 403, 404, 413, 422].includes(response.status) ||
            (response.status === 409 && error?.error === 'queue_unavailable'))
          await finishMobileJoin(key)
      }
      throw new Error(
        locale === 'es'
          ? 'No se pudo añadir el turno. Revisa los datos y la disponibilidad del servicio.'
          : 'Could not join. Check your details and service availability.',
      )
    }
    const joined = joinedEntrySchema.parse(await response.json())
    if (channel === 'mobile') {
      await finishMobileJoin(key)
      requestPushAfterJoin(key)
      window.dispatchEvent(new Event('noqueue:turn-changed'))
    }
    navigate(`/t/${joined.recoveryToken}?lang=${locale}`, {
      state: { joined: true },
      replace: channel === 'mobile',
    })
  }

  return (
    <CustomerShell
      title={service?.name ?? (locale === 'es' ? 'Restaurante' : 'Restaurant')}
      back={`/?lang=${locale}`}
      locale={locale}
      setLocale={setLocale}
    >
      {error && <LoadError locale={locale} retry={() => void refresh()} />}
      {!service && !error && (
        detectRuntime() === 'native' ? (
          <LoadingSpinner locale={locale} className="flex-1" />
        ) : (
          <p className="p-4" role="status">
            {locale === 'es' ? 'Cargando…' : 'Loading…'}
          </p>
        )
      )}
      {service?.canJoin === false && (
        <p className="px-4 pt-4" role="status">
          {locale === 'es'
            ? 'No se admiten inscripciones en este momento.'
            : 'Registrations are not available right now.'}
        </p>
      )}
      {service &&
        (service.queueState !== 'inactive' || attemptedQueue === queueId) && (
          <Form
            key={queueId}
            service={service}
            locale={locale}
            disabled={!service.canJoin}
            channel={channel}
            onSubmit={submit}
            onMobileSubmit={submit}
          />
        )}
    </CustomerShell>
  )
}
