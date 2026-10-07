import { useLocale, usePublicResource } from './public-resource'
import { availabilityText, visualWaitingPeople } from './availability'
import { useEffect, useState } from 'react'
import { visitService } from './discovery-state'
import { useLocation, useNavigate, useParams } from 'react-router'
import {
  joinedEntrySchema,
  publicServiceSchema,
} from '@noqueue/contracts/queue'
import { PublicQueue as LegacyPublicQueue } from '@/features/staff/PublicQueue'
import { RestaurantForm } from './RestaurantForm'
import { CustomerShell, LoadError } from './shared'
const parse = (value: unknown) => publicServiceSchema.parse(value)
export function PublicQueue() {
  const { queueId } = useParams()
  const navigate = useNavigate()
  const [attemptedQueue, setAttemptedQueue] = useState<string | undefined>()
  const route = useLocation()
  const returnTo =
    typeof route.state?.discoveryReturn === 'string' &&
    /^\/(?:search(?:\?|$)|\?(?:lang=))/.test(route.state.discoveryReturn)
      ? (route.state.discoveryReturn as string)
      : undefined
  const [locale, setLocale] = useLocale()
  const {
    data: service,
    error,
    refresh,
  } = usePublicResource(`/api/v1/public/services/${queueId}`, parse)
  useEffect(() => {
    if (service) visitService(service.id)
  }, [service])
  if (service && service.type !== 'restaurant')
    return (
      <CustomerShell
        title={service.name}
        back={returnTo ?? `/v/${service.venueId}?lang=${locale}`}
        locale={locale}
        setLocale={setLocale}
      >
        <div className="p-4">
          <LegacyPublicQueue providedService={service} locale={locale} />
        </div>
      </CustomerShell>
    )
  return (
    <CustomerShell
      title={service?.name ?? (locale === 'es' ? 'Restaurante' : 'Restaurant')}
      back={
        returnTo ??
        (service?.venueId ? `/v/${service.venueId}?lang=${locale}` : undefined)
      }
      locale={locale}
      setLocale={setLocale}
    >
      {error && <LoadError locale={locale} retry={() => void refresh()} />}
      {!service && !error && (
        <p className="p-4" role="status">
          {locale === 'es' ? 'Cargando…' : 'Loading…'}
        </p>
      )}
      {service && (
        <div className="space-y-2 px-4 pt-4">
          <p role="status">
            {availabilityText(
              service,
              locale,
              service.averageWaitMinutes ?? null,
            )}
          </p>
          <p>
            {visualWaitingPeople(service)}{' '}
            {locale === 'es' ? 'personas en lista de espera' : 'people waiting'}
          </p>
        </div>
      )}
      {service &&
        (service.queueState !== 'inactive' || attemptedQueue === queueId) && (
          <RestaurantForm
            key={queueId}
            service={service}
            locale={locale}
            disabled={!service.canJoin}
            onSubmit={async (input, key) => {
              setAttemptedQueue(queueId)
              const response = await fetch(
                `/api/v1/public/services/${queueId}/entries`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': key,
                  },
                  body: JSON.stringify(input),
                },
              )
              if (!response.ok)
                throw new Error(
                  locale === 'es'
                    ? 'No se pudo añadir el turno. Revisa los datos y la disponibilidad del servicio.'
                    : 'Could not join. Check your details and service availability.',
                )
              const joined = joinedEntrySchema.parse(await response.json())
              navigate(`/t/${joined.recoveryToken}?lang=${locale}`, {
                state: { joined: true },
              })
            }}
          />
        )}
    </CustomerShell>
  )
}
