import { useRef, useState } from 'react'
import type {
  Capability,
  QueueLifecycleCommand,
  QueueOpeningContext,
  QueueSummary,
} from '@noqueue/contracts/staff'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { api, ApiError, errorMessage } from './api'
import { QueueReminder } from './QueueReminder'

type AdmissionAction = 'declare_full' | 'resume' | 'pause'
export function ServiceCard({
  service,
  permissions,
  waitingCount,
  disabled,
  onBusyChange,
  onSaved,
  onView,
  onConfigure,
  onAdvanced,
  onFree,
}: {
  service: QueueSummary
  permissions: readonly Capability[]
  waitingCount: number | undefined
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onSaved: () => Promise<void>
  onView: (trigger: HTMLButtonElement) => void
  onConfigure: (trigger: HTMLButtonElement) => void
  onAdvanced: (trigger: HTMLButtonElement) => void
  onFree: (trigger: HTMLButtonElement) => void
}) {
  const gear = useRef<HTMLButtonElement | null>(null)
  const control = useRef<HTMLButtonElement | null>(null)
  const cancel = useRef<HTMLButtonElement | null>(null)
  const saving = useRef(false)
  const request = useRef<{
    action: AdmissionAction
    body: QueueLifecycleCommand
    key: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const canOperate = permissions.includes('queue.operate')
  const canConfigure = permissions.includes('queue.configure')
  const active = service.queueState === 'active'
  const label = active
    ? 'Cerrar lista'
    : service.queueState === 'paused'
    ? 'Reanudar lista'
    : 'Activar lista'
  const locked = disabled || busy || needsReload
  const unavailable =
    !service.serviceOpen || (!active && service.blockReason === 'cutoff')
  function close() {
    if (!saving.current) setConfirm(false)
  }
  async function reload() {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    onBusyChange(true)
    try {
      await onSaved()
      setNeedsReload(false)
      setError('')
    } catch (e) {
      setError(
        `La operación está guardada. Actualiza los datos antes de continuar. ${errorMessage(
          e,
        )}`,
      )
    } finally {
      saving.current = false
      setBusy(false)
      onBusyChange(false)
    }
  }
  async function operate(action: AdmissionAction) {
    if (saving.current || locked || unavailable || !canOperate) return
    saving.current = true
    setBusy(true)
    onBusyChange(true)
    setError('')
    try {
      if (request.current?.action !== action) {
        const context = await api<QueueOpeningContext>(
          `/queues/${service.id}/opening-context`,
        )
        if (
          action === 'declare_full' &&
          context.readiness.reasons.includes('configuration_missing')
        ) {
          if (gear.current) onAdvanced(gear.current)
          return
        }
        request.current = {
          action,
          body: { action, contextToken: context.contextToken },
          key: crypto.randomUUID(),
        }
      }
      try {
        await api(
          `/queues/${service.id}/lifecycle`,
          'POST',
          request.current.body,
          request.current.key,
        )
      } catch (e) {
        setError(errorMessage(e))
        if (e instanceof ApiError && e.status === 409) {
          request.current = null
          try {
            const context = await api<QueueOpeningContext>(
              `/queues/${service.id}/opening-context`,
            )
            await onSaved()
            if (action === 'pause' && context.queueState !== 'active')
              setConfirm(false)
            setError(
              'La lista ha cambiado. Datos actualizados; revisa y confirma de nuevo.',
            )
          } catch (refreshError) {
            setError(errorMessage(refreshError))
          }
        }
        return
      }
      // The mutation is committed. A failed refresh offers reads only, never another POST.
      request.current = null
      setConfirm(false)
      setNeedsReload(true)
      try {
        await onSaved()
        setNeedsReload(false)
      } catch (e) {
        setError(
          `La operación está guardada. Actualiza los datos antes de continuar. ${errorMessage(
            e,
          )}`,
        )
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      saving.current = false
      setBusy(false)
      onBusyChange(false)
    }
  }
  return (
    <Card
      role="article"
      aria-label={`Servicio ${service.name}`}
      size="sm"
      className="min-w-0 ring-1 ring-foreground"
    >
      <CardHeader className="min-w-0">
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {service.name}
          </span>
          <Badge
            variant="secondary"
            className={
              service.serviceOpen ? 'bg-green-100 text-green-600' : undefined
            }
          >
            {service.serviceOpen ? 'Servicio abierto' : 'Servicio cerrado'}
          </Badge>
          <Badge
            variant="secondary"
            className={active ? 'bg-green-100 text-green-600' : undefined}
          >
            {active
              ? 'Lista activa'
              : service.queueState === 'paused'
              ? 'Lista pausada'
              : 'Lista inactiva'}
          </Badge>
        </CardTitle>
        <CardDescription>
          {
            {
              restaurant: 'Restaurante',
              reception: 'Recepción',
              pool: 'Piscina',
            }[service.config.type]
          }
        </CardDescription>
        {(canConfigure || canOperate) && (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    ref={gear}
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Opciones del servicio"
                    disabled={locked}
                  />
                }
              >
                <img
                  src="/assets/service-card/gear.svg"
                  alt=""
                  width="16"
                  height="16"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canOperate &&
                  service.config.type === 'restaurant' &&
                  service.inventoryConfirmed && (
                    <DropdownMenuItem
                      onClick={() => gear.current && onFree(gear.current)}
                    >
                      Mesa libre
                    </DropdownMenuItem>
                  )}
                <DropdownMenuItem
                  onClick={() => gear.current && onAdvanced(gear.current)}
                >
                  Configuración avanzada
                </DropdownMenuItem>
                {canConfigure && (
                  <DropdownMenuItem
                    onClick={() => gear.current && onConfigure(gear.current)}
                  >
                    Configurar servicio
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Turnos en lista de espera</dt>
            <dd className="font-medium">{waitingCount ?? '—'}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-muted-foreground">Capacidad</dt>
              <dd className="font-medium">{service.capacity}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duración media</dt>
              <dd className="font-medium">{service.averageMinutes} min</dd>
            </div>
          </div>
        </dl>
        {service.config.type === 'restaurant' &&
          service.queueState === 'inactive' && (
            <p className="text-sm text-muted-foreground">
              Actívala cuando el restaurante esté lleno.
            </p>
          )}
        {service.blockReason === 'cutoff' && (
          <p className="text-sm">Horario de inscripciones finalizado</p>
        )}
        {canOperate &&
          service.reminderDue &&
          !service.readiness?.reasons.includes('configuration_missing') && (
            <QueueReminder
              key={`${service.id}:${service.reminderId}`}
              queueId={service.id}
              onSaved={onSaved}
            />
          )}
        {error && !confirm && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {needsReload && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void reload()}
          >
            Actualizar datos
          </Button>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-2">
        {canOperate ? (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Switch
              nativeButton
              render={<button type="button" />}
              ref={control}
              aria-label={label}
              checked={active}
              className="data-[size=default]:h-5 data-[size=default]:w-9"
              disabled={locked || unavailable}
              onCheckedChange={(checked) => {
                if (saving.current || locked) return
                if (!checked) {
                  setError('')
                  setConfirm(true)
                } else if (
                  service.config.type === 'restaurant' &&
                  service.queueState === 'inactive' &&
                  service.readiness?.reasons.includes('configuration_missing')
                ) {
                  if (gear.current) onAdvanced(gear.current)
                } else
                  void operate(
                    service.queueState === 'paused' ||
                      service.config.type !== 'restaurant'
                      ? 'resume'
                      : 'declare_full',
                  )
              }}
            />
            <span>{busy ? 'Guardando…' : label}</span>
          </div>
        ) : (
          <span />
        )}
        <Button
          variant="outline"
          disabled={locked}
          onClick={(e) => onView(e.currentTarget)}
        >
          Ver lista
          <img
            src="/assets/service-card/arrow-right.svg"
            alt=""
            width="16"
            height="16"
          />
        </Button>
      </CardFooter>
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <AlertDialogContent
          initialFocus={cancel}
          finalFocus={control}
          className="w-[calc(100%-32px)] gap-0 overflow-hidden rounded-lg data-[size=default]:max-w-[330px] data-[size=default]:sm:max-w-[330px]"
        >
          <AlertDialogHeader className="relative items-start gap-1 place-items-start pb-4 pr-6 text-left">
            <AlertDialogTitle className="text-xl font-semibold">
              Vas a cerrar la lista
            </AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              Se deshabilitará la opción de añadir nuevos turnos y los clientes
              no podrán inscribirse. Los turnos existentes se conservarán y
              podrán seguir atendiéndose.
            </AlertDialogDescription>
            <Button
              className="absolute -top-2 -right-2"
              size="icon-sm"
              variant="ghost"
              aria-label="Cancelar cierre"
              disabled={busy}
              onClick={close}
            >
              <img
                src="/assets/service-card/close.svg"
                alt=""
                width="16"
                height="16"
              />
            </Button>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="pb-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter className="flex-row flex-wrap justify-start gap-2 bg-background py-6 sm:justify-start">
            <Button
              variant="destructive"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={busy || locked}
              onClick={() => void operate('pause')}
            >
              {busy ? 'Guardando…' : 'Cerrar lista'}
            </Button>
            <Button
              ref={cancel}
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancelar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
