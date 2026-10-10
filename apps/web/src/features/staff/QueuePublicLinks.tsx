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
  let urls: Record<'queue' | 'kiosk' | 'qr', string> | undefined
  let configError = ''
  try {
    urls = {
      queue: publicQueueUrl(queueId),
      kiosk: publicQueueUrl(queueId, 'kiosk'),
      qr: publicQueueUrl(queueId, 'qr'),
    }
  } catch (error) {
    configError =
      error instanceof Error
        ? error.message
        : 'Revisa la configuración del enlace público.'
  }
  function open(event: MouseEvent, destination: 'queue' | 'kiosk' | 'qr') {
    if (!Capacitor.isNativePlatform()) return
    event.preventDefault()
    setError('')
    void openPublicQueue(queueId, destination).catch(() =>
      setError(
        'No se pudo abrir el enlace público. Comprueba la configuración y vuelve a intentarlo.'
      )
    )
  }
  return (
    <div className="space-y-2">
      <div className="inline-flex items-center">
        <Button
          variant="outline"
          className="h-9 rounded-r-none px-3"
          disabled={!urls}
          nativeButton={!urls}
          render={
            urls ? (
              <a
                role="link"
                href={urls.queue}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => open(event, 'queue')}
              />
            ) : undefined
          }
        >
          <img src={externalLink} alt="" aria-hidden="true" />
          Abrir enlace público
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!urls}
            render={
              <Button
                variant="outline"
                size="icon"
                className="-ml-px size-9 rounded-l-none"
                aria-label="Opciones del enlace público"
              />
            }
          >
            <img src={chevronDown} alt="" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem
              render={
                <a
                  href={urls?.kiosk}
                  target="_blank"
                  rel="noopener noreferrer"
                />
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
      </div>
      {(configError || error) && (
        <p role="alert" className="text-destructive">
          {configError || error}
        </p>
      )}
    </div>
  )
}
