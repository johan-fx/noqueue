import { discoveryQrDestination } from '@/platform/capacitor/discovery-capabilities'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppNavigate } from '@/app/navigation/native-transitions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import type { Locale } from './shared'
import { visitService } from './discovery-state'
export function QrScanner({
  locale,
  onClose,
}: {
  locale: Locale
  onClose: () => void
}) {
  const navigate = useAppNavigate()
  const stopCamera = useRef<() => void>(() => {})
  const registerCameraStop = useCallback((stop: () => void) => {
    stopCamera.current = stop
  }, [])
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
        <CameraPreview locale={locale} onClose={onClose} registerStop={registerCameraStop} />
        <Button
          variant="outline"
          onClick={() => {
            stopCamera.current()
            onClose()
            navigate(`/search?lang=${locale}`, { intent: 'forward' })
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
  registerStop,
}: {
  locale: Locale
  onClose: () => void
  registerStop: (stop: () => void) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const navigate = useAppNavigate()
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
            const target = discoveryQrDestination(result.getText())
            if (!target) {
              setError(
                locale === 'es'
                  ? 'Este QR no enlaza a un servicio de No Queue.'
                  : 'This QR does not link to a No Queue service.',
              )
              return
            }
            if (target.startsWith('/q/')) visitService(target.split('?')[0]!.slice(3))
            stop()
            onClose()
            navigate(target.includes('?') ? target : `${target}?lang=${locale}`)
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
    const stop = () => {
      active = false
      controls?.stop()
      const stream = element?.srcObject
      if (stream && 'getTracks' in stream)
        stream.getTracks().forEach((track) => track.stop())
      if (element) element.srcObject = null
    }
    registerStop(stop)
    const hidden = () => { if (document.visibilityState === 'hidden') { stop(); onClose() } }
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden); stop() }
  }, [locale, navigate, onClose, registerStop])
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
