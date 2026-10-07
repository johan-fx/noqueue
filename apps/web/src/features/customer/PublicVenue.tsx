import { useLocale, usePublicResource } from './public-resource'
import { availabilityText, visualWaitingPeople } from './availability'
import { Link, useParams } from 'react-router'
import { ArrowRight, Clock, Users } from 'lucide-react'
import { publicVenueSchema } from '@noqueue/contracts/queue'
import { CustomerShell, LoadError } from './shared'
const parse = (value: unknown) => publicVenueSchema.parse(value)
export function PublicVenue() {
  const { venueId } = useParams()
  const [locale, setLocale] = useLocale(),
    es = locale === 'es'
  const {
    data: venue,
    error,
    refresh,
  } = usePublicResource(`/api/v1/public/venues/${venueId}/services`, parse)
  return (
    <CustomerShell title="No Queue" locale={locale} setLocale={setLocale}>
      {error && <LoadError locale={locale} retry={() => void refresh()} />}
      {venue ? (
        <div className="space-y-6 px-4 pt-4 pb-8">
          <div className="space-y-2">
            <h1 className="text-2xl leading-8 font-semibold">
              {es ? 'Te damos la bienvenida a' : 'Welcome to'} {venue.name}
            </h1>
            <p className="text-base leading-6 text-gray-500">
              {es
                ? 'Utilizamos un sistema de gestión de lista de espera digital para mejorar tu experiencia.'
                : 'We use a digital waiting list to improve your experience.'}
            </p>
          </div>
          <ol className="list-inside list-decimal space-y-2 rounded-xl bg-secondary p-5 text-base leading-6">
            <li>
              {es
                ? 'Elige el servicio al que deseas acceder'
                : 'Choose your service'}
            </li>
            <li>
              {es
                ? 'Apúntate a la lista sin tener que esperar físicamente'
                : 'Join the list without waiting in line'}
            </li>
            <li>
              {es
                ? '¡Te avisaremos cuando sea tu turno!'
                : 'Check back here for your turn!'}
            </li>
          </ol>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">
              {es
                ? 'Selecciona una opción para comenzar'
                : 'Choose an option to begin'}
            </h2>
            <div className="space-y-2">
              {venue.services.map((service) => (
                <Link
                  key={service.id}
                  className="block space-y-2 rounded-lg border border-gray-300 p-4 focus-visible:ring-2"
                  to={`/q/${service.id}?lang=${locale}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-800">
                      {service.name}
                    </h3>
                    <ArrowRight className="size-5" />
                  </div>
                  <p className="flex items-center gap-2 text-xs">
                    <Users className="size-4" />
                    {visualWaitingPeople(service)}{' '}
                    {es ? 'personas en lista de espera' : 'people waiting'}
                  </p>
                  <p className="flex items-center gap-2 text-xs">
                    <Clock className="size-4" />
                    {availabilityText(
                      service,
                      locale,
                      service.averageWaitMinutes,
                    )}
                  </p>
                </Link>
              ))}
            </div>
            {!venue.services.length && (
              <p>
                {es
                  ? 'No hay servicios disponibles.'
                  : 'No services available.'}
              </p>
            )}
          </section>
        </div>
      ) : (
        !error && (
          <p className="p-4" role="status">
            {es ? 'Cargando…' : 'Loading…'}
          </p>
        )
      )}
    </CustomerShell>
  )
}
