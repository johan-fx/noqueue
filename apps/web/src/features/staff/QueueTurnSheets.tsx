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
import { AssignmentOptions } from './AssignmentOptions'
import { receptionLabels, queueActionLabels } from './queue-labels'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
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
          showCloseButton={!busy}
          className="mx-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="px-0 pr-8">
            <SheetTitle className="text-2xl">Gestionar turno</SheetTitle>
            {managedEntry && (
              <SheetDescription>
                {managedEntry.displayName || `Turno ${managedEntry.code}`} · Turno:{' '}
                {managedEntry.code}
              </SheetDescription>
            )}
          </SheetHeader>
          {managedEntry && (
            <div className="space-y-3 pb-2">
              {queue?.config.type === 'restaurant' ? (
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <UsersIcon className="size-4" aria-hidden="true" />
                  {managedEntry.partySize}{' '}
                  {managedEntry.partySize === 1 ? 'persona' : 'personas'}
                  {managedEntry.assignedSeating
                    ? ` · ${managedEntry.assignedSeating.spaceName}`
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
                    cancelar detiene solo este ciclo.
                  </p>
                )}
            </div>
          )}
          <SheetFooter className="gap-3 px-0">
            {managedEntry && managedActions.includes('call') && (
              <Button
                className="h-12 w-full bg-zinc-900 text-white hover:bg-zinc-800"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'call')}
              >
                Asignar próximo turno
              </Button>
            )}
            {managedEntry && managedActions.includes('complete') && (
              <Button
                className="h-12 w-full bg-zinc-900 text-white hover:bg-zinc-800"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'complete')}
              >
                Confirmar llegada
              </Button>
            )}
            {managedEntry && !managedIsNext && managedActions.includes('prioritize') && (
              <Button
                className="h-12 w-full"
                variant="outline"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'prioritize')}
              >
                Priorizar para siguiente turno
              </Button>
            )}
            {managedEntry &&
              (managedEntry.status === 'called' || managedIsNext) &&
              managedActions.includes('pass') && (
              <Button
                className="h-12 w-full"
                variant="outline"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'pass')}
              >
                Pasar turno
              </Button>
            )}
            {managedEntry && managedActions.includes('cancel') && (
              <Button
                className="h-12 w-full border-destructive text-destructive hover:text-destructive"
                variant="outline"
                disabled={busy}
                onClick={() => onAction(managedEntry, 'cancel')}
              >
                Cancelar turno
              </Button>
            )}
            <Button
              className="h-12 w-full"
              variant="outline"
              disabled={busy}
              onClick={() => onManagedOpenChange(false)}
            >
              Volver
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={!!pending} onOpenChange={onPendingOpenChange}>
        <SheetContent
          side="bottom"
          finalFocus={returnFocus}
          showCloseButton={!busy}
          className={showingOlderWarning
            ? "mx-auto max-h-[90dvh] max-w-lg overflow-hidden rounded-t-xl gap-0 p-0"
            : "mx-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"}
        >
          <div className={showingOlderWarning ? "min-h-0 overflow-y-auto p-4 space-y-4" : "contents"}>
          <SheetHeader className="px-0 pr-8">
            <SheetTitle className="text-2xl">
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
            <SheetDescription>
              {automaticConflict === 'processed'
                ? 'El sistema ya ha asignado este turno y ha avisado al siguiente cliente. La cola se actualizará automáticamente.'
                : automaticConflict === 'assigned'
                  ? 'Este turno ya ha sido asignado automáticamente. La lista se actualizará automáticamente.'
                  : olderAssignmentWarning && pending?.action === 'call' && pendingEntry
                    ? `Vas a iniciar una asignación para ${pendingEntry.partySize} personas${pendingEntry.assignedSeating?.spaceName || pendingEntry.assignment?.spaceName || pendingEntry.space?.name ? ` en ${pendingEntry.assignedSeating?.spaceName || pendingEntry.assignment?.spaceName || pendingEntry.space?.name}` : ''}.`
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
                ' La cancelación manual detendrá únicamente este ciclo automático y no avisará al siguiente. Para reanudarlo, asigna otro turno manualmente.'}
              {!automaticConflict && pending?.action === 'complete' &&
                pendingEntry?.automationCycle?.state === 'active' &&
                ' Confirmar la llegada completará el turno y detendrá únicamente este ciclo automático.'}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-2 pb-4">
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
          </div>

          {!automaticConflict && olderAssignmentWarning &&
            pending?.action === 'call' &&
            olderCompatibleCandidates.length > 0 && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                <p className="text-sm text-amber-950">{olderWarningCopy}</p>
                <ul aria-label="Turnos compatibles anteriores" className="space-y-2">
                  {olderCompatibleCandidates.map((candidate) => (
                    <li
                      key={candidate.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-background p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {candidate.displayName || `Turno ${candidate.code}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {candidate.partySize}{' '}
                          {candidate.partySize === 1 ? 'persona' : 'personas'} ·{' '}
                          {candidate.assignment?.spaceName ||
                            candidate.space?.name ||
                            'Espacio compatible'} ·{' '}
                          <WaitingAge
                            since={candidate.waitingSince}
                            clockOffsetMs={
                              automationSnapshot
                                ? automationSnapshot.serverNow - automationSnapshot.observedAt
                                : 0
                            }
                          />
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || commandUncertain}
                        onClick={() => onSelectCandidate(candidate)}
                      >
                        Asignar →
                      </Button>
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
          {!automaticConflict && pending?.action === 'call' && (
            <div className="space-y-4">
              {pendingQueue?.config.automaticAssignmentEnabled &&
              automationSnapshot?.effective &&
              arrivalMode === 'notify' ? (
                <p className="text-sm text-muted-foreground">
                  {restaurantAssignment
                    ? seating?.mode === 'confirmed'
                      ? `Si vence el plazo, cancelaremos este turno y avisaremos automáticamente a un grupo compatible: primero del mismo tamaño (${pendingEntry?.partySize} personas) y después grupos más pequeños hasta una persona; nunca uno mayor. Si no quedan candidatos compatibles, el ciclo se detendrá y tendrás que iniciar otro con una nueva asignación manual. Confirmar la llegada o cancelar manualmente detiene solo este ciclo.`
                      : 'Sin espacio y capacidad confirmados, tendrás que asignar el siguiente turno manualmente.'
                    : 'Si vence el plazo, cancelaremos este turno y avisaremos automáticamente al siguiente candidato compatible. Confirmar la llegada o cancelar manualmente detiene solo este ciclo.'}
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
          <SheetFooter className={showingOlderWarning ? "shrink-0 gap-3 border-t bg-background px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]" : "gap-3 px-0"}>
            {automaticConflict ? (
              <Button className="h-12 w-full" onClick={onDismissAutomaticConflict}>
                Entendido
              </Button>
            ) : (
              <>
                <Button
                  className={`h-12 w-full ${
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
                  className="h-12 w-full"
                  variant="outline"
                  disabled={busy}
                  onClick={onBack}
                >
                  {pending?.action === 'cancel' ? '← Volver' : 'Volver'}
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
