import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  joinedEntrySchema,
  publicServiceSchema,
  type PublicService,
} from '@noqueue/contracts/queue'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'
import { QueueEntryForm } from './QueueEntryForm'
export function PublicQueue() {
  const { queueId } = useParams()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<{
    queueId: string
    service: PublicService
  } | null>(null)
  const [error, setError] = useState('')
  const service = loaded && loaded.queueId === queueId ? loaded.service : null
  useEffect(() => {
    let live = true
    fetch(`/api/v1/public/services/${queueId}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const service = publicServiceSchema.parse(await response.json())
        if (live) {
          setLoaded({ queueId: queueId!, service })
          setError('')
        }
      })
      .catch(() => {
        if (live) setError('Este servicio no está disponible.')
      })
    return () => {
      live = false
    }
  }, [queueId])
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <p className="text-sm text-muted-foreground">{service?.venueName}</p>
        <CardTitle>{service?.name ?? 'Cola'}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {service && (
          <QueueEntryForm
            key={queueId}
            service={service}
            disabled={!service.open}
            submitLabel="Unirme a la cola"
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
                  'No se pudo añadir el turno. Revisa los datos y que la cola esté abierta y tenga capacidad.',
                )
              const entry = joinedEntrySchema.parse(await response.json())
              navigate(`/t/${entry.recoveryToken}?lang=es`)
            }}
          />
        )}
        {service && !service.open && (
          <p role="status" className="mt-4 text-muted-foreground">
            La cola está cerrada.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
