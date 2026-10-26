import { useEffect, useState, type ReactNode } from 'react'
import type {
  AssignmentSeating,
  EntryCommand,
  QueueAutomation,
  QueueSummary,
  StaffEntry,
} from '@noqueue/contracts/staff'
import { assignmentTableOptions, defaultAssignmentSeating } from '@noqueue/contracts/staff'
import { UsersIcon } from 'lucide-react'
import { QueueCycleDetails } from './QueueCycleDetails'
import { AssignmentOptions } from './AssignmentOptions'
import { receptionLabels, queueActionLabels } from './queue-labels'
import { Alert, AlertDescription } from '@/components/ui/alert'
import warningIcon from '@/assets/queue-sheet/warning.svg'
import usersIcon from '@/assets/queue-sheet/users.svg'
import dotIcon from '@/assets/queue-sheet/dot.svg'
import assignIcon from '@/assets/queue-sheet/assign.svg'
import arrivalClockIcon from '@/assets/queue-sheet/arrival-clock.svg'
import closeIcon from '@/assets/queue-sheet/close.svg'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatCountdown } from '@/lib/countdown'

type PendingCommand = {
  queueId: string
  entryId: string
  action: EntryCommand['action']
  key: string
  attentionId?: string
} | null

type AutomationSnapshot = QueueAutomation & { observedAt: number }

type QueueTurnSheetsProps = {
  queue?: QueueSummary | undefined
  automationSnapshot: AutomationSnapshot | null
  canOperate?: boolean
  managedOpen: boolean
  managedEntry?: StaffEntry | undefined
  managedActions: EntryCommand['action'][]
  managedIsNext: boolean
  pending: PendingCommand
  pendingQueue?: QueueSummary | undefined
  pendingEntry?: StaffEntry | undefined
  busy: boolean
  commandUncertain: boolean
  commandStale: boolean
  pendingActionUnavailable: boolean
  validSeating: boolean
  olderAssignmentWarning: boolean
  olderCompatibleCandidates: StaffEntry[]
  automaticConflict: 'processed' | 'assigned' | null
  commandError: string
  restaurantAssignment: boolean
  seatingOptions: ReturnType<typeof assignmentTableOptions>
  seating: AssignmentSeating | null
  returnFocus: () => HTMLElement | null
  onManagedOpenChange: (open: boolean) => void
  onPendingOpenChange: (open: boolean) => void
  onAction: (entry: StaffEntry, action: EntryCommand['action']) => void
  onConfirm: () => void
  onDismissAutomaticConflict: () => void
  onSelectCandidate: (candidate: StaffEntry) => void
  onSeatingChange: (seating: AssignmentSeating | null) => void
}

// The action, not the automation setting, owns the sheet presentation.
// Keep the reviewed F01/G03 frame shared so both assignment modes evolve together.
export function TurnSheetFrame({ children, footer, busy, returnFocus, warning = false, hasFooter = true }: {
  children: ReactNode
  footer: ReactNode
  busy: boolean
  returnFocus: () => HTMLElement | null
  warning?: boolean
  hasFooter?: boolean
}) {
  return (
    <SheetContent
      side="bottom"
      finalFocus={returnFocus}
      showCloseButton={false}
      className="mx-auto max-h-[90dvh] max-w-lg gap-0 overflow-hidden rounded-t-2xl border-t-0 p-0 data-[side=bottom]:border-t-0"
    >
      <div className={`min-h-0 overflow-y-auto px-4 pt-6 ${hasFooter ? '' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]'}`}>{children}</div>
      {hasFooter && <SheetFooter className={`shrink-0 gap-4 bg-background px-4 ${warning ? 'pt-11' : 'pt-8'} pb-[max(1.5rem,env(safe-area-inset-bottom))]`}>
        {footer}
      </SheetFooter>}
      {!busy && (
        <SheetClose render={<Button variant="ghost" className="absolute top-6 right-4 size-6 rounded-none border-0 p-0" />}>
          <img src={closeIcon} alt="" aria-hidden="true" className="shrink-0" />
          <span className="sr-only">Cerrar</span>
        </SheetClose>
      )}
    </SheetContent>
  )
}

function TurnIdentity({ entry, queue }: { entry: StaffEntry; queue?: QueueSummary | undefined }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words text-[22px] font-normal leading-7 tracking-[-0.26px] text-[#111827]" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
          {entry.displayName || `Turno ${entry.code}`}
        </p>
        <p className="shrink-0 text-sm font-medium leading-5 text-[#111827]">
          <span className="text-[#9ca3af]">Turno: </span>{entry.code}
        </p>
      </div>
      {queue?.config.type === 'restaurant' ? (
        <div className="flex min-h-5 flex-wrap items-center gap-1 text-xs font-medium leading-none text-[#9ca3af]">
          <img src={usersIcon} alt="" aria-hidden="true" className="shrink-0" />
          <span className="px-1" aria-label={`${entry.partySize} personas`}>{entry.partySize}</span>
          {(entry.assignedSeating?.spaceName || entry.space?.name) && <>
            <img src={dotIcon} alt="" aria-hidden="true" className="shrink-0" />
            <span className="px-1">{entry.assignedSeating?.spaceName || entry.space?.name}</span>
          </>}
          {entry.assignedSeating && <span className="sr-only">Mesa para {entry.assignedSeating.seats}</span>}
        </div>
      ) : queue?.config.type === 'reception' && entry.receptionService ? (
        <p className="text-xs leading-5 text-[#9ca3af]">{receptionLabels[entry.receptionService]}</p>
      ) : null}
    </div>
  )
}

const actionButtonClass = 'h-12 w-full rounded-lg text-sm font-medium'

function ArrivalCountdown({ deadline, clockOffsetMs }: { deadline: number; clockOffsetMs: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])
  return <>{formatCountdown(deadline - now - clockOffsetMs)}</>
}

function WaitingAge({
  since,
  clockOffsetMs,
}: {
  since?: number | undefined
  clockOffsetMs: number
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(interval)
  }, [])
  if (since == null) return <>Tiempo de espera no disponible</>
  const elapsedMinutes = Math.max(
    0,
    Math.floor((now + clockOffsetMs - since) / 60000),
  )
  return <>{elapsedMinutes < 1 ? 'Menos de 1' : elapsedMinutes} min esperando</>
}

export function QueueAssignmentCandidate({ candidate, clockOffsetMs, disabled, onSelect }: {
  candidate: StaffEntry
  clockOffsetMs: number
  disabled: boolean
  onSelect: (candidate: StaffEntry) => void
}) {
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium leading-5 text-[#111827]">
          {candidate.displayName || `Turno ${candidate.code}`}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs font-medium leading-4 text-[#9ca3af]">
          <span className="inline-flex shrink-0 items-center gap-1">
            <img src={usersIcon} alt="" aria-hidden="true" className="shrink-0" />
            <span className="px-1" aria-label={`${candidate.partySize} personas`}>{candidate.partySize}</span>
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <img src={dotIcon} alt="" aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 break-words px-1">{candidate.assignment?.spaceName || candidate.space?.name || 'Espacio compatible'}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <img src={dotIcon} alt="" aria-hidden="true" className="shrink-0" />
            <span className="break-words px-1">
              <WaitingAge since={candidate.waitingSince} clockOffsetMs={clockOffsetMs} />
            </span>
          </span>
        </div>
      </div>
      <Button
        className="h-9 shrink-0 gap-2 self-center whitespace-nowrap rounded-lg px-4 text-sm font-medium"
        variant="ghost"
        disabled={disabled}
        onClick={() => onSelect(candidate)}
      >
        Asignar <img src={assignIcon} alt="" aria-hidden="true" className="shrink-0" />
      </Button>
    </li>
  )
}

export function QueueTurnSheets({
  queue,
  canOperate = true,
  automationSnapshot,
  managedOpen,
  managedEntry,
  managedActions,
  managedIsNext,
  pending,
  pendingQueue,
  pendingEntry,
  busy,
  commandUncertain,
  commandStale,
  pendingActionUnavailable,
  validSeating,
  olderAssignmentWarning,
  olderCompatibleCandidates,
  automaticConflict,
  commandError,
  restaurantAssignment,
  seatingOptions,
  seating,
  returnFocus,
  onManagedOpenChange,
  onPendingOpenChange,
  onAction,
  onConfirm,
  onDismissAutomaticConflict,
  onSelectCandidate,
  onSeatingChange,
}: QueueTurnSheetsProps) {
  const availableManagedActions = canOperate && managedEntry && ['waiting', 'called'].includes(managedEntry.status)
    ? managedActions
    : []
  const compactManagement = canOperate && !!managedEntry && ['waiting', 'called'].includes(managedEntry.status) && managedEntry.automationCycle?.state !== 'stopped'
  const showingOlderWarning = !automaticConflict && olderAssignmentWarning && pending?.action === 'call'
  const hasOlderCapacity = olderCompatibleCandidates.some(
    (candidate) => candidate.partySize !== pendingEntry?.partySize,
  )
  const olderWarningCopy = hasOlderCapacity
    ? 'Hay turnos de otras capacidades que llevan más tiempo esperando. Puedes continuar o revisar la lista.'
    : 'Hay turnos compatibles que llevan más tiempo esperando. Puedes continuar o revisar la lista.'

  return (
    <>
      <Sheet open={managedOpen} onOpenChange={onManagedOpenChange}>
        <TurnSheetFrame busy={busy} returnFocus={returnFocus} hasFooter={availableManagedActions.length > 0} footer={<>
            {managedEntry && availableManagedActions.includes('call') && (
              <Button
                className={actionButtonClass}
                disabled={busy}
                onClick={() => onAction(managedEntry, 'call')}
              >
                Asignar próximo turno
              </Button>
            )}
            {managedEntry && availableManagedActions.includes('complete') && (
              <Button
                className={actionButtonClass}
                disabled={busy}
                onClick={() => onAction(managedEntry, 'complete')}
              >
                Confirmar llegada
              </Button>
            )}
            {managedEntry && !managedIsNext && availableManagedActions.includes('prioritize') && (
              <Button
                className={actionButtonClass}
                variant="outline"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'prioritize')}
              >
                Priorizar para siguiente turno
              </Button>
            )}
            {managedEntry &&
              (managedEntry.status === 'called' || managedIsNext) &&
              availableManagedActions.includes('pass') && (
              <Button
                className={actionButtonClass}
                variant="outline"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'pass')}
              >
                Pasar turno
              </Button>
            )}
            {managedEntry && availableManagedActions.includes('cancel') && (
              <Button
                className={`${actionButtonClass} border-[#b91c1c] text-[#b91c1c] hover:text-[#b91c1c]`}
                variant="outline"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'cancel')}
              >
                Cancelar turno
              </Button>
            )}

          </>}>
          <SheetHeader className="gap-2 p-0 pr-8">
            <SheetTitle className="text-2xl font-medium leading-none text-[#374151]">{canOperate && managedEntry && ['waiting', 'called'].includes(managedEntry.status) ? 'Gestionar turno' : 'Detalle del turno'}</SheetTitle>
            {managedEntry && (
              <SheetDescription className={compactManagement ? "sr-only" : "text-sm leading-5 text-[#6b7280]"}>
                {managedEntry.displayName || `Turno ${managedEntry.code}`} · Turno:{' '}
                {managedEntry.code}
              </SheetDescription>
            )}
          </SheetHeader>
          {managedEntry && (compactManagement ? (
            <div className="mt-6 flex flex-col gap-2">
              <TurnIdentity entry={managedEntry} queue={queue} />
              {managedEntry.status === 'called' && managedEntry.arrivalDeadlineAt != null && (
                <div className="flex flex-wrap items-center gap-1">
                  <p className="px-1 text-xs font-medium leading-none text-[#9ca3af]">Tiempo para confirmar llegada</p>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fef2f2] px-2 py-0.5 text-xs font-semibold leading-4 text-[#dc2626]">
                    <img src={arrivalClockIcon} alt="" aria-hidden="true" className="shrink-0" />
                    <span className="tabular-nums"><ArrivalCountdown deadline={managedEntry.arrivalDeadlineAt} clockOffsetMs={automationSnapshot ? automationSnapshot.serverNow - automationSnapshot.observedAt : 0} /></span>
                  </span>
                </div>
              )}
              {managedEntry.automationCycle?.state === 'active' && <p className="sr-only">Ciclo automático · Intento {managedEntry.automationCycle.attempt ?? 1}. Confirmar o cancelar pausa solo este ciclo.</p>}
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <QueueCycleDetails entry={managedEntry} canOperate={canOperate} />
              {queue?.config.type === 'restaurant' ? (
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <UsersIcon className="size-4" aria-hidden="true" />
                  {managedEntry.partySize}{' '}
                  {managedEntry.partySize === 1 ? 'persona' : 'personas'}
                  {managedEntry.assignedSeating
                    ? ` · ${managedEntry.assignedSeating.spaceName} · Mesa para ${managedEntry.assignedSeating.seats}`
                    : managedEntry.space
                      ? ` · ${managedEntry.space.name}`
                      : ''}
                </p>
              ) : queue?.config.type === 'reception' && managedEntry.receptionService ? (
                <p className="text-sm text-muted-foreground">
                  {receptionLabels[managedEntry.receptionService]}
                </p>
              ) : null}
              {managedEntry.status === 'called' &&
                managedEntry.arrivalDeadlineAt != null && (
                  <div className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
                    <p>Tiempo para confirmar llegada</p>
                    <p className="tabular-nums">
                      <ArrivalCountdown
                        deadline={managedEntry.arrivalDeadlineAt}
                        clockOffsetMs={
                          automationSnapshot
                            ? automationSnapshot.serverNow - automationSnapshot.observedAt
                            : 0
                        }
                      />
                    </p>
                  </div>
                )}
              {managedEntry.status === 'called' &&
                managedEntry.automationCycle?.state === 'active' && (
                  <p className="text-xs text-muted-foreground">
                    Ciclo automático · Intento{' '}
                    {managedEntry.automationCycle.attempt ?? 1}. Confirmar o
                    cancelar pausa solo este ciclo.
                  </p>
                )}
            </div>
          ))}
        </TurnSheetFrame>
      </Sheet>

      <Sheet open={!!pending} onOpenChange={onPendingOpenChange}>
        <TurnSheetFrame busy={busy} returnFocus={returnFocus} warning={showingOlderWarning} footer={<>
            {automaticConflict ? (
              <Button className={actionButtonClass} onClick={onDismissAutomaticConflict}>
                Entendido
              </Button>
            ) : (
              <>
                <Button
                  className={`${actionButtonClass} ${
                    pending?.action === 'cancel'
                      ? 'border-destructive text-destructive hover:text-destructive'
                      : ''
                  }`}
                  variant={pending?.action === 'cancel' ? 'outline' : 'default'}
                  aria-busy={busy || undefined}
                  disabled={
                    busy ||
                    (!commandUncertain &&
                      (commandStale ||
                        pendingActionUnavailable ||
                        !validSeating ||
                        (pending?.action === 'call' &&
                          pendingEntry?.assignment?.available === false)))
                  }
                  onClick={onConfirm}
                >
                  {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
                  {busy
                    ? 'Guardando…'
                    : pending?.action === 'cancel'
                      ? 'Cancelar turno'
                      : pending?.action === 'call'
                        ? olderAssignmentWarning || pending.attentionId
                          ? 'Confirmar'
                          : restaurantAssignment &&
                              !seatingOptions.length &&
                              !commandUncertain
                            ? 'Asignar sin especificar mesa'
                            : 'Asignar turno'
                        : pending?.action === 'complete'
                          ? 'Confirmar llegada'
                          : pending?.action === 'pass'
                            ? 'Pasar turno'
                            : pending?.action === 'prioritize'
                              ? 'Confirmar'
                              : 'Confirmar'}
                </Button>

              </>
            )}
          </>}>
          <div className="space-y-6">
          <SheetHeader className="gap-2 p-0">
            <SheetTitle className="pr-8 text-2xl font-medium leading-[1.4] text-[#374151]">
              {automaticConflict
                ? 'Turno ya procesado'
                : olderAssignmentWarning && pending?.action === 'call'
                  ? 'Hay turnos esperando desde antes'
                  : pending?.action === 'cancel'
                    ? '¿Confirmas que quieres cancelar el turno?'
                    : pending?.action === 'prioritize'
                      ? 'Priorizar para el siguiente turno'
                      : pending?.action === 'pass'
                        ? 'Pasar turno'
                        : pending
                          ? queueActionLabels[pending.action]
                          : ''}
            </SheetTitle>
            <SheetDescription className={automaticConflict || showingOlderWarning || ['prioritize', 'pass', 'skip'].includes(pending?.action ?? '') || (['cancel', 'complete'].includes(pending?.action ?? '') && pendingEntry?.automationCycle?.state === 'active') ? "text-sm leading-5 text-[#6b7280]" : "sr-only"}>
              {automaticConflict === 'processed'
                ? 'El sistema ya ha asignado este turno y ha avisado al siguiente cliente. La cola se actualizará automáticamente.'
                : automaticConflict === 'assigned'
                  ? 'Este turno ya ha sido asignado automáticamente. La lista se actualizará automáticamente.'
                  : olderAssignmentWarning && pending?.action === 'call' && pendingEntry
                    ? <>Vas a iniciar una asignación para <strong className="font-semibold">{pendingEntry.partySize} {pendingEntry.partySize === 1 ? 'persona' : 'personas'}</strong>{pendingEntry.assignedSeating?.spaceName || pendingEntry.assignment?.spaceName || pendingEntry.space?.name ? <> en <strong className="font-semibold">{pendingEntry.assignedSeating?.spaceName || pendingEntry.assignment?.spaceName || pendingEntry.space?.name}.</strong></> : '.'}</>
                    : pending?.action === 'prioritize'
                      ? 'Esta persona tendrá prioridad en la siguiente asignación compatible. La persona que ya ha sido avisada conservará su turno y se recalcularán los tiempos estimados.'
                      : pending?.action === 'pass'
                        ? 'Se pasará este turno y se ofrecerá al siguiente turno compatible.'
                        : pending?.action === 'cancel'
                          ? null
                          : pending?.action === 'skip'
                            ? 'El turno se moverá al final de la lista.'
                            : pending?.action === 'call' ? queueActionLabels[pending.action] : null}
              {!automaticConflict && pending?.action === 'cancel' &&
                pendingEntry?.automationCycle?.state === 'active' &&
                ' La cancelación manual pausará únicamente este ciclo automático y no avisará al siguiente. Para reanudarlo, asigna otro turno manualmente.'}
              {!automaticConflict && pending?.action === 'complete' &&
                pendingEntry?.automationCycle?.state === 'active' &&
                ' Confirmar la llegada completará el turno y pausará únicamente este ciclo automático.'}
            </SheetDescription>
          </SheetHeader>

          {!showingOlderWarning && pendingEntry && <TurnIdentity entry={pendingEntry} queue={pending?.action === 'call' && !restaurantAssignment ? undefined : pendingQueue} />}

          {!automaticConflict && olderAssignmentWarning &&
            pending?.action === 'call' &&
            olderCompatibleCandidates.length > 0 && (
              <div className="space-y-6">
                <Alert className="grid-cols-[16px_1fr] gap-x-3 rounded-[10px] border-0 bg-[#fffbeb] px-4 py-3 text-[#b45309]">
                  <img src={warningIcon} alt="" aria-hidden="true" className="mt-0.5 shrink-0" />
                  <AlertDescription className="min-w-0 text-sm font-normal leading-5 text-[#b45309] text-wrap md:text-wrap">
                    {olderWarningCopy}
                  </AlertDescription>
                </Alert>
                <ul aria-label="Turnos compatibles anteriores" className="space-y-6">
                  {olderCompatibleCandidates.map((candidate) => (
                    <QueueAssignmentCandidate key={candidate.id} candidate={candidate}
                      clockOffsetMs={automationSnapshot ? automationSnapshot.serverNow - automationSnapshot.observedAt : 0}
                      disabled={busy || commandUncertain} onSelect={onSelectCandidate} />
                  ))}
                </ul>
              </div>
            )}

          {!automaticConflict && (commandError || pendingActionUnavailable) && (
            <p role="alert" className="text-destructive">
              {commandError ||
                'El turno ya no permite esta acción. Cierra esta ventana y revisa la lista.'}
            </p>
          )}
          {!automaticConflict && pending?.action === 'call' && restaurantAssignment && (
            <div className="space-y-4">
              {restaurantAssignment && pendingQueue && pendingEntry && (
                showingOlderWarning ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Asignación seleccionada</p>
                    <p className="text-sm text-muted-foreground">
                      {seating?.mode === 'confirmed'
                        ? `${seatingOptions.find((space) => space.spaceId === seating.spaceId)?.name ?? 'Espacio no disponible'} · Mesa para ${seating.seats}`
                        : !seatingOptions.length
                          ? 'Sin especificar mesa'
                          : 'Pendiente de revisar la asignación'}
                    </p>
                    {!validSeating && !commandUncertain && (
                      <>
                        <p role="alert" className="text-sm text-destructive">
                          Las opciones han cambiado. Revisa la asignación antes de confirmar.
                        </p>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => onSeatingChange(defaultAssignmentSeating(pendingQueue.config, pendingEntry))}
                        >
                          Revisar asignación
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                <AssignmentOptions
                  config={pendingQueue.config}
                  party={pendingEntry}
                  seating={seating}
                  onChange={onSeatingChange}
                  disabled={busy || commandUncertain}
                />
                )
              )}

            </div>
          )}

          </div>
        </TurnSheetFrame>
      </Sheet>
    </>
  )
}
