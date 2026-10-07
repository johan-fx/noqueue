import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from 'motion/react'
import {
  Check,
  ChevronDown,
  Clock,
  CircleX,
  Users,
  LogIn,
  LogOut,
  BadgeHelp,
} from 'lucide-react'
import type {
  EntryCommand as QueueCommand,
  QueueSummary,
  StaffEntry,
} from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import assignmentCheck from '@/assets/queue-actions/queue-assignment-check.svg'
import {
  queueActionLabels,
  receptionLabels,
  entryActions,
} from './queue-labels'
const statusLabels: Record<string, string> = {
  waiting: 'En espera',
  called: 'Pendiente de llegada',
  completed: 'En servicio',
  served: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No presentado',
  expired: 'Caducado',
}
export function QueueEntryCard({
  entry,
  queue,
  now,
  position,
  canOperate,
  busy,
  revealed,
  onReveal,
  onAction,
}: {
  entry: StaffEntry
  queue: QueueSummary
  now: number
  position: number
  canOperate: boolean
  busy: boolean
  revealed: 'left' | 'right' | 'all' | null
  onReveal: (direction: 'left' | 'right' | 'all' | null) => void
  onAction: (entry: StaffEntry, action: QueueCommand['action']) => void
}) {
  const actions =
    entry.allowedActions ?? entryActions(entry.status, queue.config.type)
  const operable = canOperate && !busy && actions.length > 0
  const active = ['waiting', 'called'].includes(entry.status)
  const draggable = operable && active
  const x = useMotionValue(0)
  const controls = useDragControls()
  const reducedMotion = useReducedMotion()
  const leftTray = useRef<HTMLDivElement>(null)
  const rightTray = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pointerActive = useRef(false)
  const suppressClick = useRef(false)
  const [moving, setMoving] = useState(false)
  const [widths, setWidths] = useState({ left: 0, right: 0 })
  const latest = useRef({ onReveal, revealed })
  useLayoutEffect(() => {
    latest.current = { onReveal, revealed }
  })
  useLayoutEffect(() => {
    const measure = () =>
      setWidths({
        left: leftTray.current?.getBoundingClientRect().width ?? 0,
        right: rightTray.current?.getBoundingClientRect().width ?? 0,
      })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (leftTray.current) observer.observe(leftTray.current)
    if (rightTray.current) observer.observe(rightTray.current)
    return () => observer.disconnect()
  }, [entry.status, canOperate])
  const target =
    draggable && revealed === 'right'
      ? widths.left
      : draggable && revealed === 'left'
      ? -widths.right
      : 0
  useEffect(() => {
    if (dragging.current) return
    const animation = animate(x, target, {
      duration: reducedMotion ? 0 : 0.18,
      ease: 'easeOut',
    })
    return () => animation.stop()
  }, [x, target, reducedMotion])
  const identity = `${queue.id}:${entry.status}:${draggable}`
  const previousIdentity = useRef(identity)
  useEffect(() => {
    if (previousIdentity.current === identity) return
    previousIdentity.current = identity
    setMoving(false)
    // A new object from polling must not interrupt an active gesture.
    controls.cancel()
    dragging.current = false
    pointerActive.current = false
    x.stop()
    x.set(0)
    if (latest.current.revealed) latest.current.onReveal(null)
  }, [controls, x, identity])
  useEffect(() => () => controls.cancel(), [controls])
  function settle(cancelled = false) {
    controls.cancel()
    dragging.current = false
    pointerActive.current = false
    setMoving(false)
    const direction =
      !cancelled && draggable
        ? widths.left > 0 && x.get() > widths.left * 0.4
          ? 'right'
          : widths.right > 0 && x.get() < -widths.right * 0.4
          ? 'left'
          : null
        : null
    latest.current.onReveal(direction)
    animate(
      x,
      direction === 'right'
        ? widths.left
        : direction === 'left'
        ? -widths.right
        : 0,
      { duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' },
    )
  }
  const callDisabled =
    busy || queue.readiness?.reasons.includes('inventory_refresh_required')
  const ReceptionIcon =
    entry.receptionService === 'check_in'
      ? LogIn
      : entry.receptionService === 'check_out'
      ? LogOut
      : BadgeHelp
  function act(action: QueueCommand['action']) {
    onReveal(null)
    onAction(entry, action)
  }
  return (
    <li
      className="relative overflow-hidden rounded-lg border bg-background select-none [&_*]:select-none"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchCancel={(event) => event.stopPropagation()}
      data-entry-code={entry.code}
    >
      {canOperate && active && (
        <>
          <div
            ref={leftTray}
            className="absolute inset-y-0 left-0 flex"
            inert={!draggable || moving || revealed !== 'right'}
            aria-hidden={!draggable || moving || revealed !== 'right'}
          >
            {actions.includes('call') ? (
              <Button
                className="h-full w-36 rounded-none bg-[#26ad61] font-semibold text-white hover:bg-[#26ad61]/90"
                disabled={callDisabled}
                onClick={() => act('call')}
              >
                <img
                  src={assignmentCheck}
                  alt=""
                  aria-hidden="true"
                  width="19.9984"
                  height="19.9984"
                  className="pointer-events-none shrink-0"
                />
                Asignar turno
              </Button>
            ) : actions.includes('complete') ? (
              <Button
                aria-label="Confirmar llegada"
                className="h-full w-36 rounded-none bg-green-600 text-white hover:bg-green-700"
                disabled={busy}
                onClick={() => act('complete')}
              >
                <Check aria-hidden="true" />
                Confirmar llegada
              </Button>
            ) : null}
          </div>
          <div
            ref={rightTray}
            className="absolute inset-y-0 right-0 flex"
            inert={!draggable || moving || revealed !== 'left'}
            aria-hidden={!draggable || moving || revealed !== 'left'}
          >
            <Button
              variant="destructive"
              className="h-full w-28 flex-col rounded-none whitespace-normal bg-red-700 text-white hover:bg-red-800"
              disabled={busy}
              onClick={() => act('cancel')}
            >
              <CircleX aria-hidden="true" />
              Cancelar turno
            </Button>
          </div>
        </>
      )}
      <motion.div
        data-swipe-surface=""
        className="relative flex min-h-21 touch-pan-y items-center gap-4 bg-background p-4"
        style={{ x, touchAction: 'pan-y' }}
        drag={draggable ? 'x' : false}
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ left: -widths.right, right: widths.left }}
        dragElastic={0}
        dragMomentum={false}
        dragDirectionLock
        onDirectionLock={(axis) => {
          if (axis === 'y') settle(true)
        }}
        onDragStart={() => {
          dragging.current = true
          suppressClick.current = true
          setMoving(true)
          onReveal(null)
        }}
        onDragEnd={() => settle()}
        onPointerDown={(event) => {
          suppressClick.current = false
          if (
            !draggable ||
            !event.isPrimary ||
            event.button !== 0 ||
            (event.target as HTMLElement).closest(
              'button, a, input, select, textarea',
            )
          )
            return
          event.stopPropagation()
          pointerActive.current = true
          x.stop()
          controls.start(event)
        }}
        onPointerUp={() => {
          if (pointerActive.current && !dragging.current) settle()
        }}
        onPointerCancel={() => {
          if (pointerActive.current || dragging.current) settle(true)
        }}
        onClickCapture={(event) => {
          // Keyboard and assistive-technology clicks have detail=0.
          if (suppressClick.current && event.detail > 0) {
            event.preventDefault()
            event.stopPropagation()
            suppressClick.current = false
          }
        }}
      >
        {active && (
          <span
            aria-label={`Posición ${position}`}
            className="w-6 shrink-0 text-center text-2xl font-medium tabular-nums"
          >
            {position}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">
                {entry.displayName || `Turno ${entry.code}`}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Turno: </span>
                {entry.code}
              </p>
            </div>
            {canOperate && actions.length > 0 && (
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Acciones del turno ${entry.code}`}
                aria-expanded={revealed === 'all'}
                aria-controls={`actions-${entry.id}`}
                onClick={() => onReveal(revealed === 'all' ? null : 'all')}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={revealed === 'all' ? 'rotate-180' : ''}
                />
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {queue.config.type === 'reception' && entry.receptionService && (
              <span className="flex items-center gap-1">
                <ReceptionIcon className="size-4" aria-hidden="true" />
                {receptionLabels[entry.receptionService]}
              </span>
            )}
            {queue.config.type === 'restaurant' && (
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                <Users className="size-4" aria-hidden="true" />
                {entry.partySize}{' '}
                {entry.partySize === 1 ? 'persona' : 'personas'}
                {entry.space && (
                  <span className="break-words">
                    {entry.space.name} ·{' '}
                    {
                      {
                        preferred: 'Preferido',
                        predicted: 'Previsto',
                        assigned: 'Asignado',
                      }[entry.space.source]
                    }
                  </span>
                )}
              </span>
            )}
            {entry.status === 'waiting' &&
              entry.estimateQuality &&
              (entry.estimateQuality === 'unknown' ? (
                <span>Espera pendiente de datos</span>
              ) : (
                <Badge
                  className="ml-auto border-0 bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                  title={
                    entry.estimateQuality === 'provisional'
                      ? 'Espera provisional'
                      : 'Espera estimada'
                  }
                >
                  <Clock className="size-3" aria-hidden="true" />
                  {entry.estimateQuality === 'provisional' ? '~' : ''}
                  {entry.etaMinutes} min
                </Badge>
              ))}
            {entry.status !== 'waiting' && (
              <span
                className={
                  entry.status === 'served' || entry.status === 'completed'
                    ? 'text-green-600'
                    : ''
                }
              >
                {entry.status === 'completed' &&
                queue.config.type !== 'restaurant'
                  ? 'Completado'
                  : entry.cancellationReason === 'service_ended'
                  ? 'Cancelado por cierre de servicio'
                  : statusLabels[entry.status] ?? entry.status}
              </span>
            )}
            {entry.status === 'called' && entry.arrivalDeadlineAt != null && (
              <Badge variant="secondary" title="Tiempo restante para llegar">
                <Clock className="size-3" aria-hidden="true" />
                {Math.max(
                  0,
                  Math.ceil((entry.arrivalDeadlineAt! - now) / 60000),
                )}{' '}
                min
              </Badge>
            )}
          </div>
        </div>
      </motion.div>
      {canOperate && revealed === 'all' && (
        <div
          id={`actions-${entry.id}`}
          className="relative flex flex-wrap gap-2 border-t bg-background p-3"
        >
          {actions.map((action) => (
            <Button
              key={action}
              variant="outline"
              disabled={
                busy ||
                (action === 'call' &&
                  queue.readiness?.reasons.includes(
                    'inventory_refresh_required',
                  ))
              }
              onClick={() => act(action)}
            >
              {queueActionLabels[action]}
            </Button>
          ))}
        </div>
      )}
    </li>
  )
}
