import { useNavigate, useParams } from 'react-router'
import {
  joinedEntrySchema,
  publicServiceSchema,
} from '@noqueue/contracts/queue'
import { PublicQueue as LegacyPublicQueue } from '@/features/staff/PublicQueue'
import { RestaurantForm } from './RestaurantForm'
import {
  CustomerShell,
  LoadError,
  useLocale,
  usePublicResource,
} from './shared'
const parse = (value: unknown) => publicServiceSchema.parse(value)
export function PublicQueue() {
  const { queueId } = useParams()
  const navigate = useNavigate()
  const [locale, setLocale] = useLocale()
  const {
    data: service,
    error,
    refresh,
  } = usePublicResource(`/api/v1/public/services/${queueId}`, parse)
  if (service && service.type !== 'restaurant')
    return (
      <div className="p-4">
        <LegacyPublicQueue />
      </div>
    )
  return (
    <CustomerShell
      title={service?.name ?? (locale === 'es' ? 'Restaurante' : 'Restaurant')}
      back={
        service?.venueId ? `/v/${service.venueId}?lang=${locale}` : undefined
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
        <RestaurantForm
          key={queueId}
          service={service}
          locale={locale}
          disabled={!service.open}
          onSubmit={async (input, key) => {
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
