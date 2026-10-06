import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import type { Locale } from './shared'
import { qrDestination, visitService } from './discovery-state'
export function QrScanner({
  locale,
  onClose,
}: {
  locale: Locale
  onClose: () => void
}) {
  const navigate = useNavigate()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogTitle>{locale === 'es' ? 'Escanear QR' : 'Scan QR'}</DialogTitle>
        <DialogDescription>
          {locale === 'es'
            ? 'Apunta al QR del establecimiento para acceder a la lista.'
            : 'Point at the venue QR to access the waiting list.'}
        </DialogDescription>
        <CameraPreview locale={locale} onClose={onClose} />
        <Button
          variant="outline"
          onClick={() => {
            onClose()
            navigate(`/search?lang=${locale}`)
          }}
        >
          {locale === 'es' ? 'Buscar servicio' : 'Search services'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {locale === 'es' ? 'Volver' : 'Back'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function CameraPreview({
  locale,
  onClose,
}: {
  locale: Locale
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const navigate = useNavigate()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let controls: { stop: () => void } | undefined
    const element = video.current
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        if (!active || !element) return
        controls = await new BrowserQRCodeReader().decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          element,
          (result) => {
            if (!active || !result) return
            const target = qrDestination(
              result.getText(),
              window.location.origin,
            )
            if (!target) {
              setError(
                locale === 'es'
                  ? 'Este QR no enlaza a un servicio de No Queue.'
                  : 'This QR does not link to a No Queue service.',
              )
              return
            }
            active = false
            controls?.stop()
            if (target.startsWith('/q/')) visitService(target.slice(3))
            onClose()
            navigate(`${target}?lang=${locale}`)
          },
        )
        if (!active) controls.stop()
      } catch {
        if (active)
          setError(
            locale === 'es'
              ? 'No se puede acceder a la cámara. Puedes buscar el servicio.'
              : 'Cannot access the camera. You can search for the service.',
          )
      }
    })()
    return () => {
      active = false
      controls?.stop()
      const stream = element?.srcObject
      if (stream && 'getTracks' in stream)
        stream.getTracks().forEach((track) => track.stop())
      if (element) element.srcObject = null
    }
  }, [locale, navigate, onClose])
  return (
    <>
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        className="aspect-square w-full rounded-lg bg-gray-100"
        aria-label={locale === 'es' ? 'Vista de la cámara' : 'Camera preview'}
      />
      {error && <p role="alert">{error}</p>}
    </>
  )
}
