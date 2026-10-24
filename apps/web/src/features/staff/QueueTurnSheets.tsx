import { useEffect, useState } from 'react'
import type {
  AssignmentSeating,
  EntryCommand,
  QueueAutomation,
  QueueSummary,
  StaffEntry,
} from '@noqueue/contracts/staff'
import { assignmentTableOptions } from '@noqueue/contracts/staff'
import { UsersIcon } from 'lucide-react'
import { QueueCycleDetails } from './QueueCycleDetails'
import { AssignmentOptions } from './AssignmentOptions'
import { receptionLabels, queueActionLabels } from './queue-labels'
import { Alert, AlertDescription } from '@/components/ui/alert'
import warningIcon from '@/assets/queue-sheet/warning.svg'
import usersIcon from '@/assets/queue-sheet/users.svg'
import dotIcon from '@/assets/queue-sheet/dot.svg'
import assignIcon from '@/assets/queue-sheet/assign.svg'
import backIcon from '@/assets/queue-sheet/back.svg'
import arrivalClockIcon from '@/assets/queue-sheet/arrival-clock.svg'
import closeIcon from '@/assets/queue-sheet/close.svg'
import { Button } from '@/components/ui/button'
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
  arrivalMode: 'notify' | 'present'
  returnFocus: () => HTMLElement | null
  onManagedOpenChange: (open: boolean) => void
  onPendingOpenChange: (open: boolean) => void
  onAction: (entry: StaffEntry, action: EntryCommand['action']) => void
  onConfirm: () => void
  onBack: () => void
  onDismissAutomaticConflict: () => void
  onSelectCandidate: (candidate: StaffEntry) => void
  onSeatingChange: (seating: AssignmentSeating | null) => void
  onArrivalModeChange: (mode: 'notify' | 'present') => void
}

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
  arrivalMode,
  returnFocus,
  onManagedOpenChange,
  onPendingOpenChange,
  onAction,
  onConfirm,
  onBack,
  onDismissAutomaticConflict,
  onSelectCandidate,
  onSeatingChange,
  onArrivalModeChange,
}: QueueTurnSheetsProps) {
  const availableManagedActions = canOperate && managedEntry && ['waiting', 'called'].includes(managedEntry.status)
    ? managedActions
    : []
  const compactCalled = canOperate && managedEntry?.status === 'called' && managedEntry.automationCycle?.state !== 'stopped'
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
        <SheetContent
          side="bottom"
          finalFocus={returnFocus}
          showCloseButton={!busy && !compactCalled}
          className={compactCalled ? "mx-auto max-h-[90dvh] max-w-lg gap-0 overflow-hidden rounded-t-2xl border-t-0 p-0 data-[side=bottom]:border-t-0" : "mx-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"}
        >
          <div className={compactCalled ? "min-h-0 overflow-y-auto px-4 pt-6" : "contents"}>
          <SheetHeader className={compactCalled ? "gap-0 p-0 pr-8" : "px-0 pr-8"}>
            <SheetTitle className={compactCalled ? "text-2xl font-medium leading-none text-[#374151]" : "text-2xl"}>{canOperate && managedEntry && ['waiting', 'called'].includes(managedEntry.status) ? 'Gestionar turno' : 'Detalle del turno'}</SheetTitle>
            {managedEntry && (
              <SheetDescription className={compactCalled ? "sr-only" : undefined}>
                {managedEntry.displayName || `Turno ${managedEntry.code}`} · Turno:{' '}
                {managedEntry.code}
              </SheetDescription>
            )}
          </SheetHeader>
          {managedEntry && (compactCalled ? (
            <div className="mt-6 flex flex-col gap-2">
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 break-words text-[22px] font-normal leading-7 tracking-[-0.26px] text-[#111827]" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
                  {managedEntry.displayName || `Turno ${managedEntry.code}`}
                </p>
                <p className="shrink-0 text-sm font-medium leading-5 text-[#111827]">
                  <span className="text-[#9ca3af]">Turno: </span>{managedEntry.code}
                </p>
              </div>
              {queue?.config.type === 'restaurant' ? (
                <div className="flex min-h-5 flex-wrap items-center gap-1 text-xs font-medium leading-none text-[#9ca3af]">
                  <img src={usersIcon} alt="" aria-hidden="true" className="shrink-0" />
                  <span className="px-1" aria-label={`${managedEntry.partySize} personas`}>{managedEntry.partySize}</span>
                  {(managedEntry.assignedSeating?.spaceName || managedEntry.space?.name) && <>
                    <img src={dotIcon} alt="" aria-hidden="true" className="shrink-0" />
                    <span className="px-1">{managedEntry.assignedSeating?.spaceName || managedEntry.space?.name}</span>
                  </>}
                  {managedEntry.assignedSeating && <span className="sr-only">Mesa para {managedEntry.assignedSeating.seats}</span>}
                </div>
              ) : queue?.config.type === 'reception' && managedEntry.receptionService ? (
                <p className="text-xs leading-5 text-[#9ca3af]">{receptionLabels[managedEntry.receptionService]}</p>
              ) : null}
              {managedEntry.arrivalDeadlineAt != null && (
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
            <div className="space-y-3 pb-2">
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
          </div>
          <SheetFooter className={compactCalled ? "shrink-0 gap-4 px-4 pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]" : "gap-3 px-0"}>
            {managedEntry && availableManagedActions.includes('call') && (
              <Button
                className={compactCalled ? "h-12 w-full rounded-lg text-sm font-medium" : "h-12 w-full bg-zinc-900 text-white hover:bg-zinc-800"}
                disabled={busy}
                onClick={() => onAction(managedEntry, 'call')}
              >
                Asignar próximo turno
              </Button>
            )}
            {managedEntry && availableManagedActions.includes('complete') && (
              <Button
                className={compactCalled ? "h-12 w-full rounded-lg text-sm font-medium" : "h-12 w-full bg-zinc-900 text-white hover:bg-zinc-800"}
                disabled={busy}
                onClick={() => onAction(managedEntry, 'complete')}
              >
                Confirmar llegada
              </Button>
            )}
            {managedEntry && !managedIsNext && availableManagedActions.includes('prioritize') && (
              <Button
                className={`h-12 w-full ${compactCalled ? 'rounded-lg text-sm font-medium' : ''}`}
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
                className={`h-12 w-full ${compactCalled ? 'rounded-lg text-sm font-medium' : ''}`}
                variant="outline"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'pass')}
              >
                Pasar turno
              </Button>
            )}
            {managedEntry && availableManagedActions.includes('cancel') && (
              <Button
                className={compactCalled ? "h-12 w-full rounded-lg border-[#b91c1c] text-sm font-medium text-[#b91c1c] hover:text-[#b91c1c]" : "h-12 w-full border-destructive text-destructive hover:text-destructive"}
                variant="outline"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'cancel')}
              >
                Cancelar turno
              </Button>
            )}
            {!compactCalled && <Button
              className={`h-12 w-full ${compactCalled ? 'rounded-lg text-sm font-medium' : ''}`}
              variant="outline"
              disabled={busy}
              onClick={() => onManagedOpenChange(false)}
            >
              Volver
            </Button>}
          </SheetFooter>
          {compactCalled && !busy && (
            <SheetClose render={<Button variant="ghost" className="absolute top-6 right-4 size-6 rounded-none border-0 p-0" />}>
              <img src={closeIcon} alt="" aria-hidden="true" className="shrink-0" />
              <span className="sr-only">Cerrar</span>
            </SheetClose>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!pending} onOpenChange={onPendingOpenChange}>
        <SheetContent
          side="bottom"
          finalFocus={returnFocus}
          showCloseButton={!busy && !showingOlderWarning}
          className={showingOlderWarning
            ? "mx-auto max-h-[90dvh] max-w-lg overflow-hidden rounded-t-2xl gap-0 border-t-0 p-0"
            : "mx-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"}
        >
          <div className={showingOlderWarning ? "min-h-0 overflow-y-auto px-4 pt-6 space-y-6" : "contents"}>
          <SheetHeader className={showingOlderWarning ? "gap-2 p-0" : "px-0 pr-8"}>
            <SheetTitle className={showingOlderWarning ? "pr-8 text-2xl font-medium leading-[1.4] text-[#374151]" : "text-2xl"}>
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
            <SheetDescription className={showingOlderWarning ? "text-sm leading-5 text-[#6b7280]" : undefined}>
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
                          ? 'Se registrará la cancelación con tu identidad.'
                          : pending?.action === 'skip'
                            ? 'El turno se moverá al final de la lista.'
                            : pending
                              ? 'Se registrará esta acción con tu identidad.'
                              : null}
              {!automaticConflict && pending?.action === 'cancel' &&
                pendingEntry?.automationCycle?.state === 'active' &&
                ' La cancelación manual pausará únicamente este ciclo automático y no avisará al siguiente. Para reanudarlo, asigna otro turno manualmente.'}
              {!automaticConflict && pending?.action === 'complete' &&
                pendingEntry?.automationCycle?.state === 'active' &&
                ' Confirmar la llegada completará el turno y pausará únicamente este ciclo automático.'}
            </SheetDescription>
          </SheetHeader>

          {!showingOlderWarning && <div className="space-y-2 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xl">
                {pendingEntry?.displayName ||
                  (pendingEntry ? `Turno ${pendingEntry.code}` : 'Turno')}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Turno: </span>
                {pendingEntry?.code}
              </p>
            </div>
            {pendingQueue?.config.type === 'restaurant' && pendingEntry && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <UsersIcon className="size-4" aria-hidden="true" />
                Grupo de {pendingEntry.partySize}{' '}
                {pendingEntry.partySize === 1 ? 'persona' : 'personas'}
                {pendingEntry.space ? ` · ${pendingEntry.space.name}` : ''}
              </p>
            )}
            {pendingQueue?.config.type === 'reception' &&
              pendingEntry?.receptionService && (
                <p className="text-xs text-muted-foreground">
                  {receptionLabels[pendingEntry.receptionService]}
                </p>
              )}
          </div>}

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
                    <li key={candidate.id} className="min-w-0">
                      <p className="truncate text-sm font-medium leading-5 text-[#111827]">
                        {candidate.displayName || `Turno ${candidate.code}`}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-x-2">
                        <div className="flex min-w-0 items-center gap-1 text-xs font-medium leading-none text-[#9ca3af]">
                          <img src={usersIcon} alt="" aria-hidden="true" className="shrink-0" />
                          <span className="px-1" aria-label={`${candidate.partySize} personas`}>{candidate.partySize}</span>
                          <img src={dotIcon} alt="" aria-hidden="true" className="shrink-0" />
                          <span className="max-w-24 truncate px-1">{candidate.assignment?.spaceName || candidate.space?.name || 'Espacio compatible'}</span>
                          <img src={dotIcon} alt="" aria-hidden="true" className="shrink-0" />
                          <span className="px-1">
                            <WaitingAge since={candidate.waitingSince} clockOffsetMs={automationSnapshot ? automationSnapshot.serverNow - automationSnapshot.observedAt : 0} />
                          </span>
                        </div>
                        <Button
                          className="h-9 shrink-0 gap-2 rounded-lg px-4 text-sm font-medium"
                          variant="ghost"
                          disabled={busy || commandUncertain}
                          onClick={() => onSelectCandidate(candidate)}
                        >
                          Asignar <img src={assignIcon} alt="" aria-hidden="true" className="shrink-0" />
                        </Button>
                      </div>
                    </li>
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
          {!automaticConflict && !showingOlderWarning && pending?.action === 'call' && (
            <div className="space-y-4">
              {pendingQueue?.config.automaticAssignmentEnabled &&
              automationSnapshot?.effective &&
              arrivalMode === 'notify' ? (
                <p className="text-sm text-muted-foreground">
                  {restaurantAssignment
                    ? seating?.mode === 'confirmed'
                      ? `Si vence el plazo, cancelaremos este turno y avisaremos automáticamente a un grupo compatible: primero del mismo tamaño (${pendingEntry?.partySize} personas) y después grupos más pequeños hasta una persona; nunca uno mayor. Si no quedan candidatos compatibles, el ciclo quedará pausado y tendrás que iniciar otro con una nueva asignación manual. Confirmar la llegada o cancelar manualmente pausa solo este ciclo.`
                      : 'Sin espacio y capacidad confirmados, tendrás que asignar el siguiente turno manualmente.'
                    : 'Si vence el plazo, cancelaremos este turno y avisaremos automáticamente al siguiente candidato compatible. Confirmar la llegada o cancelar manualmente pausa solo este ciclo.'}
                </p>
              ) : (
                <p>
                  Al asignar confirmas que puedes atender este turno.
                  {arrivalMode === 'notify' &&
                    ' El cliente tendrá el plazo configurado para presentarse.'}
                </p>
              )}
              {restaurantAssignment && pendingQueue && pendingEntry && (
                <AssignmentOptions
                  config={pendingQueue.config}
                  party={pendingEntry}
                  seating={seating}
                  onChange={onSeatingChange}
                  disabled={busy || commandUncertain}
                />
              )}
              <div role="group" aria-label="Cliente" className="space-y-1">
                <p className="text-sm font-medium">Cliente</p>
                <div className="flex flex-wrap gap-1">
                  {(['notify', 'present'] as const).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      className="min-h-11 min-w-11 rounded-full"
                      variant={arrivalMode === mode ? 'default' : 'ghost'}
                      aria-pressed={arrivalMode === mode}
                      disabled={busy || commandUncertain}
                      onClick={() => onArrivalModeChange(mode)}
                    >
                      {mode === 'notify' ? 'Avisar al cliente' : 'Ya está presente'}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          </div>
          <SheetFooter className={showingOlderWarning ? "shrink-0 gap-4 bg-background px-4 pt-11 pb-[max(1.5rem,env(safe-area-inset-bottom))]" : "gap-3 px-0"}>
            {automaticConflict ? (
              <Button className="h-12 w-full" onClick={onDismissAutomaticConflict}>
                Entendido
              </Button>
            ) : (
              <>
                <Button
                  className={`h-12 w-full ${showingOlderWarning ? 'rounded-lg text-sm font-medium' : ''} ${
                    pending?.action === 'cancel'
                      ? 'border-destructive text-destructive hover:text-destructive'
                      : ''
                  }`}
                  variant={pending?.action === 'cancel' ? 'outline' : 'default'}
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
                  {busy
                    ? 'Guardando…'
                    : pending?.action === 'cancel'
                      ? 'Cancelar turno'
                      : pending?.action === 'call'
                        ? olderAssignmentWarning
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
                <Button
                  className={`h-12 w-full ${showingOlderWarning ? 'gap-2 rounded-lg text-sm font-medium' : ''}`}
                  variant="outline"
                  disabled={busy}
                  onClick={onBack}
                >
                  {showingOlderWarning && <img src={backIcon} alt="" aria-hidden="true" className="shrink-0" />}
                  {pending?.action === 'cancel' ? '← Volver' : 'Volver'}
                </Button>
              </>
            )}
          </SheetFooter>
          {showingOlderWarning && !busy && (
            <SheetClose render={<Button variant="ghost" className="absolute top-6 right-4 size-6 rounded-none border-0 p-0" />}>
              <img src={closeIcon} alt="" aria-hidden="true" className="shrink-0" />
              <span className="sr-only">Cerrar</span>
            </SheetClose>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
