import { useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import {
  serviceSchema,
  weeklySchedule,
  toGroupedService,
  pruneScheduleReminders,
  type QueueLifecycleCommand,
  type QueueSummary,
  type ServiceInput,
} from '@noqueue/contracts/staff'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from './api'
import { QueueLifecycleSheet } from './QueueLifecycleSheet'
import { ServiceConfigDrawer } from './ServiceConfigDrawer'
import { occupancyAction, readinessNotice } from './queue-readiness'

type Child = 'settings' | 'reminder' | QueueLifecycleCommand['action']
type DeliveryTrace = {
  summary: {
    kind: string
    accepted: number
    delivered: number
    read: number
    failed: number
    unknown: number
    openings: number
  }[]
  events: {
    id: string
    code: string
    kind: string
    event: string
    recordedAt: number
    attempt: number | null
  }[]
}
export function QueueAdvancedDrawer({
  queue,
  activeWaitingCount = 0,
  canOperate,
  canConfigure,
  returnFocus,
  onClose,
  onSaved,
}: {
  queue: QueueSummary
  activeWaitingCount?: number
  canOperate: boolean
  canConfigure: boolean
  returnFocus: HTMLElement | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [trace, setTrace] = useState<DeliveryTrace | null>(null)
  const [traceBusy, setTraceBusy] = useState(false)
  const [child, setChild] = useState<Child | null>(null)
  const [childFocus, setChildFocus] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const lock = useRef(false)
  const trigger = useRef<HTMLElement | null>(null)
  const childRef = useRef<Child | null>(null)
  function open(action: Child, target: HTMLElement) {
    if (lock.current || childRef.current || needsReload) return
    trigger.current = target
    setChildFocus(target)
    childRef.current = action
    setChild(action)
    setError('')
  }
  function closeChild() {
    if (lock.current) return
    childRef.current = null
    setChild(null)
  }
  async function saved() {
    try {
      await onSaved()
      setNeedsReload(false)
    } catch (e) {
      setNeedsReload(true)
      setError(
        `La operación está guardada. Actualiza los datos antes de continuar. ${errorMessage(
          e,
        )}`,
      )
    }
  }
  async function save(input: ServiceInput) {
    const config = pruneScheduleReminders(toGroupedService(input))
    if (lock.current || needsReload) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const noticePolicyChanged =
        (config.approachTurns ?? 2) !== (queue.config.approachTurns ?? 2) ||
        (config.approachMinutes ?? 10) !==
          (queue.config.approachMinutes ?? 10) ||
        (config.etaChangeThresholdMinutes ?? 5) !==
          (queue.config.etaChangeThresholdMinutes ?? 5) ||
        (config.notificationCooldownMinutes ?? 10) !==
          (queue.config.notificationCooldownMinutes ?? 10)
      const applyApproachToActive =
        noticePolicyChanged && activeWaitingCount > 0
      if (
        applyApproachToActive &&
        !window.confirm(
          'La política de avisos se actualizará para los turnos en espera. El plazo de llegada solo cambiará en futuras asignaciones. ¿Quieres continuar?',
        )
      )
        return
      await api(`/queues/${queue.id}`, 'PATCH', {
        ...config,
        version: queue.version,
        open: !!queue.open,
        applyApproachToActive,
      })
      childRef.current = null
      setChild(null)
      await saved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const notice = readinessNotice(queue)
  return (
    <Drawer
      open
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open && !lock.current && !childRef.current) onClose()
      }}
    >
      <DrawerContent finalFocus={() => returnFocus} className="w-full sm:w-md">
        <DrawerHeader className="border-b p-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Volver"
              disabled={busy || !!child}
              onClick={onClose}
            >
              <ChevronLeft />
            </Button>
            <DrawerTitle className="text-xl">
              Configuración avanzada
            </DrawerTitle>
          </div>
          <DrawerDescription>{queue.name}</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <p className="font-medium">{notice.title}</p>
          {notice.messages.map((message) => (
            <p key={message} className="text-sm text-muted-foreground">
              {message}
            </p>
          ))}
          {error && <p role="alert">{error}</p>}
          {needsReload && (
            <Button disabled={busy} onClick={() => void saved()}>
              Actualizar datos
            </Button>
          )}
          {canConfigure && (
            <Button
              variant="outline"
              className="min-h-12 w-full whitespace-normal"
              disabled={busy || needsReload}
              onClick={(e) => open('settings', e.currentTarget)}
            >
              Recursos y ajustes de estimación
            </Button>
          )}
          {canOperate && (
            <>
              {queue.config.type === 'restaurant' && (
                <Button
                  variant="outline"
                  className="min-h-12 w-full"
                  disabled={
                    busy ||
                    needsReload ||
                    queue.readiness?.reasons.includes('configuration_missing')
                  }
                  onClick={(e) =>
                    open(
                      occupancyAction(queue) ?? 'confirm_inventory',
                      e.currentTarget,
                    )
                  }
                >
                  Desglose y correcciones de ocupación
                </Button>
              )}
              <Button
                variant="outline"
                className="min-h-12 w-full whitespace-normal"
                disabled={busy || needsReload}
                onClick={(e) =>
                  open(
                    queue.config.intelligencePolicy === 'disabled'
                      ? 'enable_intelligence'
                      : 'disable_intelligence',
                    e.currentTarget,
                  )
                }
              >
                {queue.config.intelligencePolicy === 'disabled'
                  ? 'Volver a gestión automática'
                  : 'Desactivar gestión inteligente'}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            className="min-h-12 w-full"
            disabled={traceBusy}
            onClick={async () => {
              setTraceBusy(true)
              try {
                setTrace(
                  await api<DeliveryTrace>(
                    `/queues/${queue.id}/delivery-trace`,
                  ),
                )
              } catch (e) {
                setError(errorMessage(e))
              } finally {
                setTraceBusy(false)
              }
            }}
          >
            Trazabilidad de avisos (7 días)
          </Button>
          {trace && (
            <section
              aria-label="Trazabilidad de avisos"
              className="space-y-2 text-sm"
            >
              <p>
                Últimos 7 días. Aceptado no significa entregado; desconocido no
                confirma recepción.
              </p>
              {!trace.events.length && !trace.summary.length && (
                <p>No hay eventos de entrega en este periodo.</p>
              )}
              {!!trace.summary.length && (
                <ul
                  aria-label="Resumen por tipo de aviso"
                  className="space-y-2"
                >
                  {trace.summary.map((item) => (
                    <li key={item.kind} className="border-b py-2">
                      <strong>
                        {(
                          {
                            queue_joined: 'Inscripción',
                            ready: 'Asignación',
                            approaching: 'Acercamiento',
                            delayed: 'Retraso',
                            improved: 'Mejora de estimación',
                            expired: 'Plazo agotado',
                            cancelled: 'Cancelación',
                            service_ended: 'Fin del servicio',
                          } as Record<string, string>
                        )[item.kind] ?? item.kind}
                      </strong>
                      <p>
                        Aceptados: {item.accepted} · Entregados:{' '}
                        {item.delivered} · Leídos: {item.read} · Fallidos:{' '}
                        {item.failed} · Desconocidos: {item.unknown} · Aperturas
                        del enlace: {item.openings}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <ol>
                {trace.events.map((item) => (
                  <li key={item.id} className="border-b py-2">
                    {item.code} ·{' '}
                    {(
                      {
                        ready: 'Asignación',
                        approaching: 'Acercamiento',
                        queue_joined: 'Inscripción',
                        delayed: 'Retraso',
                        improved: 'Mejora de estimación',
                        expired: 'Plazo agotado',
                        cancelled: 'Cancelación',
                        service_ended: 'Fin del servicio',
                      } as Record<string, string>
                    )[item.kind] ?? item.kind}{' '}
                    ·{' '}
                    {(
                      {
                        queued: 'Registrado',
                        attempt_started: 'Intento iniciado',
                        accepted: 'Aceptado',
                        sent: 'Enviado',
                        delivered: 'Entregado',
                        read: 'Leído',
                        failed: 'Fallido',
                        unknown: 'Desconocido',
                        opened: 'Enlace abierto',
                        rate_limited: 'Límite temporal',
                        obsolete: 'Obsoleto',
                      } as Record<string, string>
                    )[item.event] ?? item.event}
                    {item.attempt ? ` · Intento ${item.attempt}` : ''} ·{' '}
                    {new Date(item.recordedAt).toLocaleString('es-ES')}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {canConfigure && queue.config.type === 'restaurant' && (
            <Button
              variant="outline"
              className="min-h-12 w-full whitespace-normal"
              disabled={busy || needsReload}
              onClick={(e) => open('reminder', e.currentTarget)}
            >
              Recordatorio de llenado habitual
            </Button>
          )}
        </div>
        <DrawerFooter className="border-t p-4">
          <Button
            variant="outline"
            disabled={busy || !!child}
            onClick={onClose}
          >
            Atrás
          </Button>
        </DrawerFooter>
        <ServiceConfigDrawer
          open={child === 'settings'}
          mode="edit"
          initial={queue.config}
          resetKey={queue.id}
          saving={busy}
          error={error}
          finalFocus={trigger}
          onClose={closeChild}
          onSave={save}
        />
        {child === 'reminder' && (
          <ReminderDrawer
            config={queue.config}
            busy={busy}
            error={error}
            returnFocus={trigger}
            onClose={closeChild}
            onSave={save}
          />
        )}
        {child && child !== 'settings' && child !== 'reminder' && (
          <QueueLifecycleSheet
            queueId={queue.id}
            name={queue.name}
            type={queue.config.type}
            action={child}
            returnFocus={childFocus}
            onClose={closeChild}
            onSaved={saved}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}
function ReminderDrawer({
  config,
  busy,
  error,
  returnFocus,
  onClose,
  onSave,
}: {
  config: ServiceInput
  busy: boolean
  error: string
  returnFocus: React.RefObject<HTMLElement | null>
  onClose: () => void
  onSave: (config: ServiceInput) => Promise<void>
}) {
  const calendar = weeklySchedule(config)
  const schedules = calendar.schedules
  const [enabled, setEnabled] = useState(config.reminder?.enabled ?? false)
  const [dailyAt, setDailyAt] = useState(config.reminder?.dailyAt ?? '')
  const [times, setTimes] = useState(
    schedules.map(
      (s) =>
        config.reminder?.intervals.find(
          (r) => r.day === s.day && r.from === s.from && r.to === s.to,
        )?.at ?? '',
    ),
  )
  const [validation, setValidation] = useState('')
  const draft = {
    ...config,
    reminder: {
      enabled,
      ...(dailyAt ? { dailyAt } : {}),
      intervals: schedules.flatMap((s, i) =>
        times[i] ? [{ ...s, at: times[i]! }] : [],
      ),
    },
  }
  return (
    <Drawer
      open
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DrawerContent finalFocus={returnFocus} className="w-full sm:w-md">
        <DrawerHeader className="border-b p-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Volver"
              disabled={busy}
              onClick={onClose}
            >
              <ChevronLeft />
            </Button>
            <DrawerTitle>Recordatorio de llenado habitual</DrawerTitle>
          </div>
          <DrawerDescription>
            Solo pregunta si deseas activar la lista. Ignorarlo nunca la activa.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          <Field orientation="horizontal">
            <Switch
              id="reminder-enabled"
              checked={enabled}
              disabled={busy}
              onCheckedChange={setEnabled}
            />
            <FieldLabel htmlFor="reminder-enabled">
              Activar recordatorio
            </FieldLabel>
          </Field>
          {enabled && (
            <>
              {calendar.allDayDays.length > 0 && (
                <Field>
                  <FieldLabel htmlFor="reminder-daily">Hora diaria</FieldLabel>
                  <Input
                    id="reminder-daily"
                    type="time"
                    disabled={busy}
                    value={dailyAt}
                    onChange={(e) => setDailyAt(e.target.value)}
                  />
                </Field>
              )}
              {schedules.map((s, i) => (
                <Field key={`${s.day}:${s.from}:${s.to}`}>
                  <FieldLabel htmlFor={`reminder-${i}`}>
                    {
                      [
                        'Domingo',
                        'Lunes',
                        'Martes',
                        'Miércoles',
                        'Jueves',
                        'Viernes',
                        'Sábado',
                      ][s.day]
                    }{' '}
                    · {s.from}–{s.to}
                  </FieldLabel>
                  <Input
                    id={`reminder-${i}`}
                    type="time"
                    disabled={busy}
                    value={times[i] ?? ''}
                    onChange={(e) =>
                      setTimes(
                        times.map((time, j) =>
                          j === i ? e.target.value : time,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
            </>
          )}
          {(error || validation) && <p role="alert">{error || validation}</p>}
        </div>
        <DrawerFooter className="border-t p-4">
          <Button
            disabled={busy}
            onClick={() => {
              const parsed = serviceSchema.safeParse(draft)
              if (!parsed.success) {
                setValidation(
                  'Indica una hora dentro del horario y antes del límite de inscripciones.',
                )
                return
              }
              void onSave(parsed.data)
            }}
          >
            {busy ? 'Guardando…' : 'Guardar recordatorio'}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Atrás
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
