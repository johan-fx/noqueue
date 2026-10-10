import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

type PublicDestination = 'queue' | 'kiosk' | 'qr'

/** The browser and printed QR must point to the same public origin as the API. */
export function publicQueueUrl(
  queueId: string,
  destination: PublicDestination = 'queue',
  locale?: 'es' | 'en'
) {
  const native = Capacitor.isNativePlatform()
  const configured = import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim()
  const origin = configured || (!native ? window.location.origin : '')
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new Error(
      'Configura VITE_PUBLIC_APP_ORIGIN con el dominio público del servicio.'
    )
  }
  const hostname = url.hostname.toLowerCase()
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127\./.test(hostname) ||
    hostname === '0.0.0.0'
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (native && (url.protocol !== 'https:' || loopback))
  )
    throw new Error(
      'Configura VITE_PUBLIC_APP_ORIGIN con un origen público HTTPS válido, sin rutas ni credenciales.'
    )
  url.pathname = `/q/${encodeURIComponent(queueId)}${
    destination === 'queue' ? '' : `/${destination}`
  }`
  if (locale) url.searchParams.set('lang', locale)
  return url.href
}

export async function openPublicQueue(
  queueId: string,
  destination: PublicDestination = 'queue'
) {
  const url = publicQueueUrl(queueId, destination)
  if (Capacitor.isNativePlatform()) await Browser.open({ url })
  else if (!window.open(url, '_blank', 'noopener,noreferrer')) {
    throw new Error(
      'No se pudo abrir el enlace. Permite las ventanas emergentes y vuelve a intentarlo.'
    )
  }
}
