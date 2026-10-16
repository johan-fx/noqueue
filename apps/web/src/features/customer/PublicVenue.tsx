import { usePublicAnalyticsPage } from '@/features/privacy/use-public-analytics-page'
import { ClosedServiceCard } from './ClosedServiceCard'
import { PublicWaitingTurns } from './PublicWaitingTurns'
import { useLocale, usePublicResource } from './public-resource'
import { availabilityText, publicWaitText } from './availability'
import { Link, useParams } from 'react-router'
import { ArrowRight, Clock } from 'lucide-react'
import { isVisibleVenueService, publicVenueSchema } from '@noqueue/contracts/queue'
import { CustomerShell, LoadError } from './shared'
const parse = (value: unknown) => publicVenueSchema.parse(value)
export function PublicVenue() {
  const { venueId } = useParams()
  const [locale, setLocale] = useLocale(),
    es = locale === 'es'
  const {
    data: venue,
    error,
    updatedAt,
    refresh,
  } = usePublicResource(`/api/v1/public/venues/${venueId}/services`, parse)
  usePublicAnalyticsPage(Boolean(venue), error)
  const services = venue?.services.filter(isVisibleVenueService) ?? []
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
              {services.map((service) => service.serviceOpen === false && service.nextOpening ? (
                <ClosedServiceCard key={service.id} name={service.name} opening={service.nextOpening} receivedAt={updatedAt!} locale={locale} />
              ) : (
                <Link
                  key={service.id}
                  className="block space-y-2 rounded-lg border border-gray-300 p-[15px] focus-visible:ring-2"
                  to={`/q/${service.id}?lang=${locale}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="min-w-0 truncate text-lg leading-7 font-semibold text-gray-800" title={service.name}>
                      {service.name}
                    </h3>
                    <ArrowRight aria-hidden="true" className="size-6 shrink-0 text-gray-800" />
                  </div>
                  <PublicWaitingTurns
                    service={service}
                    locale={locale}
                    className="flex items-center gap-2 text-xs leading-none font-medium text-gray-500"
                    showIcon
                  />
                  <p
                    className="flex items-center gap-2 text-xs leading-none font-medium text-gray-500"
                    title={availabilityText(service, locale, service.averageWaitMinutes)}
                  >
                    <Clock aria-hidden="true" className="size-4 shrink-0" />
                    {service.canJoin === false
                      ? availabilityText(service, locale)
                      : publicWaitText(service.averageWaitMinutes, locale)}
                  </p>
                </Link>
              ))}
            </div>
            {!services.length && (
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
