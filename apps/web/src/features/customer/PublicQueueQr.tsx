import { useParams } from 'react-router'
import { QRCodeSVG } from 'qrcode.react'
import { publicServiceSchema } from '@noqueue/contracts/queue'
import { publicQueueUrl } from '@/lib/public-queue-links'
import { CustomerShell, KioskContent, LoadError } from './shared'
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
      <KioskContent>
        <section className="mx-auto flex w-full max-w-md flex-col items-center gap-6 text-center">
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
              <h1 className="text-3xl font-semibold leading-10 sm:text-4xl">
                {es ? 'Te damos la bienvenida a' : 'Welcome to'}{' '}
                {service.venueName}
              </h1>
              <p className="text-xl font-medium leading-8 sm:text-2xl">
                {es
                  ? 'Escanea el QR para apuntarte a la lista de espera desde tu teléfono móvil.'
                  : 'Scan the QR code to join the waiting list from your mobile phone.'}
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
            </>
          )}
        </section>
      </KioskContent>
    </CustomerShell>
  )
}
