import { useParams } from 'react-router'
import { QRCodeSVG } from 'qrcode.react'
import { publicServiceSchema } from '@noqueue/contracts/queue'
import { publicQueueUrl } from '@/lib/public-queue-links'
import { CustomerShell, LoadError } from './shared'
import { useLocale, usePublicResource } from './public-resource'

const parse = (value: unknown) => publicServiceSchema.parse(value)
export function PublicQueueQr() {
  const { queueId } = useParams()
  const [locale, setLocale] = useLocale()
  const es = locale === 'es'
  const {
    data: service,
    error,
    refresh,
  } = usePublicResource(
    `/api/v1/public/services/${encodeURIComponent(queueId ?? '')}`,
    parse,
    true,
    'omit'
  )
  let url = ''
  let originError = false
  try {
    url = publicQueueUrl(queueId ?? '', 'queue', locale)
  } catch {
    originError = true
  }
  return (
    <CustomerShell
      presentation="kiosk"
      title={service?.name ?? 'QR'}
      locale={locale}
      setLocale={setLocale}
    >
      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-4 py-10 text-center">
        {error && <LoadError locale={locale} retry={() => void refresh()} />}
        {!service && !error && (
          <p role="status">{es ? 'Cargando…' : 'Loading…'}</p>
        )}
        {originError && (
          <p role="alert">
            {es
              ? 'El enlace público no está configurado correctamente. Contacta con el establecimiento.'
              : 'The public link is not configured correctly. Contact the venue.'}
          </p>
        )}
        {service && !error && !originError && (
          <>
            <h1 className="text-3xl font-semibold">{service.venueName}</h1>
            <p className="text-xl">{service.name}</p>
            <p>
              {es
                ? 'Escanea el QR para apuntarte a la lista de espera.'
                : 'Scan the QR code to join the waiting list.'}
            </p>
            <QRCodeSVG
              value={url}
              size={320}
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#000000"
              className="h-auto max-w-full"
              role="img"
              aria-label={
                es
                  ? 'QR para inscribirte en la lista'
                  : 'QR code to join the waiting list'
              }
            />
            <a
              href={url}
              className="break-all underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {es ? 'Abrir lista de espera' : 'Open waiting list'}
            </a>
          </>
        )}
      </section>
    </CustomerShell>
  )
}
