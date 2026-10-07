import { usePublicResource } from '../customer/public-resource'

import { availabilityText, visualWaitingPeople } from '../customer/availability'
import { useNavigate, useParams } from 'react-router'
import {
  joinedEntrySchema,
  publicServiceSchema,
  type PublicService,
} from '@noqueue/contracts/queue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { QueueEntryForm } from './QueueEntryForm'
const parse = (value: unknown) => publicServiceSchema.parse(value)
export function PublicQueue({
  providedService,
  locale = 'es',
}: { providedService?: PublicService; locale?: 'es' | 'en' } = {}) {
  const { queueId } = useParams()
  const navigate = useNavigate()
  const { data, error, refresh } = usePublicResource(
    providedService ? null : `/api/v1/public/services/${queueId}`,
    parse,
  )
  const service = providedService ?? data

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <p className="text-sm text-muted-foreground">{service?.venueName}</p>
        <CardTitle>{service?.name ?? 'Lista'}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="text-destructive">
            {locale === 'es'
              ? 'Este servicio no está disponible.'
              : 'Service unavailable.'}
          </p>
        )}
        {service && (
          <QueueEntryForm
            key={queueId}
            service={service}
            locale={locale}
            disabled={!service.canJoin}
            submitLabel={
              locale === 'es' ? 'Unirme a la lista' : 'Join waiting list'
            }
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
                  'No se pudo añadir el turno. Revisa los datos y que la lista esté abierta y tenga capacidad.',
                )
              const entry = joinedEntrySchema.parse(await response.json())
              navigate(`/t/${entry.recoveryToken}?lang=${locale}`)
            }}
          />
        )}
        {service && (
          <div className="mt-4 space-y-2">
            <p role="status">
              {availabilityText(
                service,
                locale,
                service.averageWaitMinutes ?? null,
              )}
            </p>
            <p>
              {visualWaitingPeople(service)}{' '}
              {locale === 'es'
                ? 'personas en lista de espera'
                : 'people waiting'}
            </p>
          </div>
        )}
        {error && (
          <button onClick={() => void refresh()}>
            {locale === 'es' ? 'Reintentar' : 'Retry'}
          </button>
        )}
      </CardContent>
    </Card>
  )
}
