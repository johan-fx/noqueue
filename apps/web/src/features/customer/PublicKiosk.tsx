import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { publicServiceSchema } from '@noqueue/contracts/queue'
import { Button } from '@/components/ui/button'
import { availabilityText } from './availability'
import { RestaurantForm } from './RestaurantForm'
import { ServiceForm } from './ServiceForm'
import { CustomerShell, LoadError } from './shared'
import { useLocale, usePublicResource } from './public-resource'

const parse = (value: unknown) => publicServiceSchema.parse(value)

export function PublicKiosk() {
  const { queueId } = useParams()
  return <KioskPage key={queueId} queueId={queueId ?? ''} />
}

function KioskPage({ queueId }: { queueId: string }) {
  const [locale, setLocale] = useLocale()
  const es = locale === 'es'
  const {
    data: service,
    error,
    refresh,
  } = usePublicResource(
    `/api/v1/public/services/${encodeURIComponent(queueId)}`,
    parse,
    true,
    'omit'
  )
  const [success, setSuccess] = useState(false)
  const [guest, setGuest] = useState(0)
  const reset = () => {
    setSuccess(false)
    setGuest((previous) => previous + 1)
    void refresh()
  }
  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => {
      setSuccess(false)
      setGuest((previous) => previous + 1)
      void refresh()
    }, 10000)
    return () => clearTimeout(timer)
  }, [success, refresh])
  const title =
    service?.type === 'reception'
      ? es
        ? 'Recepción'
        : 'Reception'
      : service?.type === 'pool'
      ? es
        ? 'Piscina'
        : 'Pool'
      : es
      ? 'Restaurante'
      : 'Restaurant'
  const Form = service?.type === 'restaurant' ? RestaurantForm : ServiceForm
  return (
    <CustomerShell
      presentation="kiosk"
      title={title}
      locale={locale}
      setLocale={setLocale}
    >
      <div className="mt-6 px-4 py-10 sm:px-10 lg:px-20">
        {success ? (
          <section
            className="mx-auto max-w-[500px] space-y-10"
            aria-live="polite"
          >
            <div className="space-y-6 text-gray-800">
              <p className="text-2xl font-semibold">{service?.venueName}</p>
              <h1 className="text-3xl font-semibold leading-10 sm:text-4xl">
                {es
                  ? '¡Ya estás en la lista de espera!'
                  : "You're on the waiting list!"}
              </h1>
              <p className="text-xl font-medium leading-8 sm:text-2xl">
                {es
                  ? 'Te avisaremos por WhatsApp cuando sea el momento de acercarte.'
                  : "We'll notify you on WhatsApp when it's time to come over."}
              </p>
              <p className="text-xl font-medium leading-8 sm:text-2xl">
                {es ? 'Muchas gracias.' : 'Thank you.'}
              </p>
            </div>
            <div className="py-4">
              <Button className="h-14 w-full" onClick={reset}>
                {es ? 'Ponerme en lista' : 'Join waiting list'}
              </Button>
            </div>
          </section>
        ) : (
          <section className="mx-auto max-w-[864px] space-y-10">
            {error && (
              <LoadError locale={locale} retry={() => void refresh()} />
            )}
            {!service && !error && (
              <p role="status">{es ? 'Cargando…' : 'Loading…'}</p>
            )}
            {service && (
              <>
                <div className="space-y-6 text-gray-800">
                  <h1 className="text-3xl font-semibold leading-10 sm:text-4xl">
                    {es ? 'Te damos la bienvenida a' : 'Welcome to'}{' '}
                    {service.venueName}
                  </h1>
                  <p className="text-xl font-medium leading-8 sm:text-2xl">
                    {es
                      ? 'Introduce tus datos para apuntarte a la lista de espera.'
                      : 'Enter your details to join the waiting list.'}
                  </p>
                </div>
                {!service.canJoin && (
                  <p role="status">{availabilityText(service, locale)}</p>
                )}
                <Form
                  key={guest}
                  presentation="kiosk"
                  service={service}
                  locale={locale}
                  disabled={error || !service.canJoin}
                  onSubmit={async (input, key) => {
                    let response: Response
                    try {
                      response = await fetch(
                        `/api/v1/public/services/${encodeURIComponent(
                          queueId
                        )}/entries`,
                        {
                          method: 'POST',
                          credentials: 'omit',
                          cache: 'no-store',
                          headers: {
                            'Content-Type': 'application/json',
                            'Idempotency-Key': key,
                          },
                          body: JSON.stringify(input),
                        }
                      )
                    } catch {
                      throw new Error(
                        es
                          ? 'No se pudo conectar. Reintenta para recuperar esta inscripción.'
                          : 'Could not connect. Retry to recover this registration.'
                      )
                    }
                    if (!response.ok) {
                      void refresh()
                      throw new Error(
                        response.status === 429
                          ? es
                            ? 'Demasiadas solicitudes. Espera un minuto antes de reintentar.'
                            : 'Too many requests. Wait a minute before retrying.'
                          : es
                          ? 'No se pudo añadir el turno. Revisa la disponibilidad y reintenta.'
                          : 'Could not join. Check availability and retry.'
                      )
                    }
                    // A shared tablet must never retain or expose the personal recovery token.
                    void response.body?.cancel().catch(() => undefined)
                    setSuccess(true)
                  }}
                />
              </>
            )}
          </section>
        )}
      </div>
    </CustomerShell>
  )
}
