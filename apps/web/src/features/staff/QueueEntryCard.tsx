import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from 'motion/react'
import {
  Check,
  Clock,
  CircleX,
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
import { formatCountdown } from '@/lib/countdown'
import assignmentCheck from '@/assets/queue-actions/queue-assignment-check.svg'
import cardUsers from '@/assets/queue-card/users.svg'
import spaceDot from '@/assets/queue-card/space-dot.svg'
import arrivalClock from '@/assets/queue-card/arrival-clock.svg'
import automaticIcon from '@/assets/queue-card/automatic.svg'
import attemptDot from '@/assets/queue-card/attempt-dot.svg'
import completedCheck from '@/assets/queue-card/completed-check.svg'
import cancelledX from '@/assets/queue-card/cancelled-x.svg'
import {
  queueActionLabels,
  receptionLabels,
  entryActions,
} from './queue-labels'
const statusLabels: Record<string, string> = {
  waiting: 'En espera',
  called: 'Pendiente de llegada',
  completed: 'Completado',
  served: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No presentado',
  expired: 'Caducado',
}
export function QueueEntryCard({
  entry,
  queue,
  now,
  online = true,
  position,
  isNext = position === 1,
  canOperate,
  busy,
  revealed,
  onReveal,
  onManage,
  onAction,
}: {
  entry: StaffEntry
  queue: QueueSummary
  now: number
  online?: boolean
  position: number
  isNext?: boolean
  canOperate: boolean
  busy: boolean
  revealed: 'left' | 'right' | 'all' | null
  onReveal: (direction: 'left' | 'right' | 'all' | null) => void
  onManage: (entry: StaffEntry) => void
  onAction: (entry: StaffEntry, action: QueueCommand['action']) => void
}) {
  const detailsId = useId()
  const wait = entry.waitEstimate
  const waitRemaining =
    wait?.predictedAt != null &&
    Number.isFinite(wait.predictedAt) &&
    ['estimated', 'provisional'].includes(wait.estimateQuality)
      ? wait.predictedAt - now
      : null
  const waitLabel =
    waitRemaining == null
      ? null
      : waitRemaining <= 0
      ? online
        ? 'Actualizando…'
        : 'Sin conexión'
      : formatCountdown(waitRemaining)
  const waitTitle =
    wait?.estimateQuality === 'provisional'
      ? 'Espera provisional'
      : 'Espera estimada'
  const seatingSpaceName = entry.assignedSeating?.spaceName ?? entry.space?.name
  const completed = entry.status === 'completed' || entry.status === 'served'
  const headerStatus = completed || entry.status === 'cancelled'
  const cycle = entry.automationCycle
  const automaticallyManaged = entry.status === 'called' && cycle?.state === 'active'
  const actions = (
    entry.allowedActions ?? entryActions(entry.status, queue.config.type)
  )
    .filter((action) => action !== 'release')
    .filter((action) =>
      entry.status !== 'waiting'
        ? true
        : action === 'pass'
          ? isNext
          : action === 'prioritize'
            ? !isNext
            : true,
    )
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
  const callDisabled = busy
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
      className="relative overflow-hidden rounded-lg border border-[#d1d5db] bg-background select-none [&_*]:select-none"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchCancel={(event) => event.stopPropagation()}
      data-entry-code={entry.code}
      data-entry-id={entry.id}
    >
      {automaticallyManaged && (
        // Figma's outer accent stays fixed during swipe, without changing layout.
        <span
          data-automatic-border=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] border-l-2 border-black"
        />
      )}
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
        className="relative flex min-h-21 touch-pan-y items-center gap-4 bg-background"
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
              'button:not([data-manage-entry]), a, input, select, textarea',
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
        <div className="relative flex w-full min-w-0 items-center gap-4 rounded-md bg-background p-[15px] text-left">
          <button
            type="button"
            data-manage-entry=""
            className="absolute inset-0 z-10 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default"
            aria-label={`${canOperate && active ? 'Gestionar turno' : 'Ver detalle del turno'} ${entry.code}`}
            aria-describedby={detailsId}
            disabled={busy}
            onClick={() => {
              onReveal(null)
              onManage(entry)
            }}
          />
        {active && (
          <span
            aria-label={`Posición ${position}`}
            className="w-6 shrink-0 text-center text-2xl font-medium tabular-nums"
          >
            {position}
          </span>
        )}
        <div id={detailsId} className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">
                {entry.displayName || `Turno ${entry.code}`}
              </p>
              <p className="text-sm font-medium">
                <span className="text-[#9ca3af]">Turno: </span>
                {entry.code}
              </p>
            </div>
            {headerStatus && (
              <span
                data-entry-status=""
                className={`flex max-w-[55%] shrink-0 items-start gap-1 text-xs font-normal leading-4 ${completed ? 'text-[#84cc16]' : 'text-[#b91c1c]'}`}
              >
                <img src={completed ? completedCheck : cancelledX} alt="" aria-hidden="true" className="shrink-0" />
                <span>{completed ? 'Completado' : entry.cancellationReason === 'service_ended' ? 'Cancelado por cierre de servicio' : 'Cancelado'}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-y-1 text-xs text-[#9ca3af]">
            {queue.config.type === 'reception' && entry.receptionService && (
              <span className="flex items-center gap-1">
                <ReceptionIcon className="size-4" aria-hidden="true" />
                {receptionLabels[entry.receptionService]}
              </span>
            )}
            {queue.config.type === 'restaurant' && (
              // Figma row: 16px icon, 12px medium gray labels with 4px horizontal
              // padding, a 4px dot, and 4px gaps. The count stays numeric.
              <span className={`flex min-w-0 items-center gap-1 text-xs font-medium leading-none text-[#9ca3af] ${entry.status === 'called' ? 'flex-1 pr-1' : ''}`}>
                <span className="flex shrink-0 items-center gap-1">
                  <img src={cardUsers} alt="" aria-hidden="true" className="shrink-0" />
                  <span className="px-1 tabular-nums">{entry.partySize}</span>
                  <span className="sr-only">
                    {entry.partySize === 1 ? 'persona' : 'personas'}
                  </span>
                </span>
                {seatingSpaceName && (
                  <>
                    <img src={spaceDot} alt="" aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 truncate px-1">{seatingSpaceName}</span>
                  </>
                )}
              </span>
            )}
            {entry.status === 'waiting' &&
              (entry.manualOnly ? (
                <span className="ml-auto font-medium text-foreground">
                  Pendiente de asignación manual
                </span>
              ) : waitLabel == null ? (
                <span>Espera pendiente de datos</span>
              ) : (
                <Badge
                  className="ml-auto border-0 bg-orange-100 text-orange-700 tabular-nums dark:bg-orange-950 dark:text-orange-300"
                  title={waitTitle}
                  aria-label={`${waitTitle}: ${waitLabel}`}
                >
                  <Clock className="size-3" aria-hidden="true" />
                  {waitLabel}
                </Badge>
              ))}
            {entry.status !== 'waiting' && !headerStatus && (
              // Keep the arrival status and its deadline together at narrow widths.
              <span className="flex shrink-0 items-center gap-1" data-arrival-status={entry.status === 'called' ? '' : undefined}>
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
                {entry.status === 'called' && entry.arrivalDeadlineAt != null && (
                  <Badge
                    variant={cycle?.state === 'active' ? 'destructive' : 'secondary'}
                    className={`tabular-nums ${cycle?.state === 'active' ? 'border-0 bg-[#fef2f2] font-semibold text-[#dc2626]' : ''}`}
                    title="Tiempo restante para llegar"
                    aria-label={`Tiempo restante para llegar: ${formatCountdown(
                      entry.arrivalDeadlineAt - now,
                    )}`}
                  >
                    {cycle?.state === 'active'
                      ? <img src={arrivalClock} alt="" aria-hidden="true" className="shrink-0" />
                      : <Clock className="size-3" aria-hidden="true" />}
                    {formatCountdown(entry.arrivalDeadlineAt - now)}
                  </Badge>
                )}
              </span>
            )}
          </div>
          {automaticallyManaged && (
            <p className="flex items-center gap-1 text-xs font-medium leading-none text-[#1f2937]">
              <img src={automaticIcon} alt="" aria-hidden="true" className="shrink-0" />
              <span className="px-1">Automático</span>
              <img src={attemptDot} alt="" aria-hidden="true" className="shrink-0" />
              {' '}<span className="sr-only">·</span>{' '}
              <span className="px-1">Intento {cycle.attempt ?? 1}</span>
            </p>
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
              disabled={busy}
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
