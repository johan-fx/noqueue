import { useState, type MouseEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import externalLink from '@/assets/public-queue/external-link.svg'
import chevronDown from '@/assets/public-queue/chevron-down.svg'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { publicQueueUrl, openPublicQueue } from '@/lib/public-queue-links'

export function QueuePublicLinks({ queueId }: { queueId: string }) {
  const [error, setError] = useState('')
  let urls: Record<'kiosk' | 'qr', string> | undefined
  let configError = ''
  try {
    urls = {
      kiosk: publicQueueUrl(queueId, 'kiosk'),
      qr: publicQueueUrl(queueId, 'qr'),
    }
  } catch (error) {
    configError =
      error instanceof Error
        ? error.message
        : 'Revisa la configuración del enlace público.'
  }
  function open(event: MouseEvent, destination: 'kiosk' | 'qr') {
    if (!Capacitor.isNativePlatform()) return
    event.preventDefault()
    setError('')
    void openPublicQueue(queueId, destination).catch(() =>
      setError(
        'No se pudo abrir el enlace público. Comprueba la configuración y vuelve a intentarlo.',
      ),
    )
  }
  return (
    <div className="space-y-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!urls}
          render={<Button variant="outline" className="h-9 px-3" />}
        >
          <img src={externalLink} alt="" aria-hidden="true" />
          Abrir enlace público
          <img src={chevronDown} alt="" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem
            render={
              <a href={urls?.kiosk} target="_blank" rel="noopener noreferrer" />
            }
            onClick={(event) => open(event, 'kiosk')}
          >
            Inscripción
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a href={urls?.qr} target="_blank" rel="noopener noreferrer" />
            }
            onClick={(event) => open(event, 'qr')}
          >
            QR
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {(configError || error) && (
        <p role="alert" className="text-destructive">
          {configError || error}
        </p>
      )}
    </div>
  )
}
