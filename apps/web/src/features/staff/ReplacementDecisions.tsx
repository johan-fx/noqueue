import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ReplacementCommand,
  ReplacementDecision,
} from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { api, ApiError, errorMessage } from './api'

export function ReplacementDecisions({
  queueId,
  blocked,
  onBusy,
  onResolved,
  returnFocus,
}: {
  queueId: string
  blocked: boolean
  onBusy: (value: boolean) => void
  onResolved: () => Promise<void>
  returnFocus?: () => HTMLElement | null
}) {
  // Suppress only during this visit; reopening the list recovers pending decisions.
  const [closed, setClosed] = useState(() => new Set<string>())
  const [rows, setRows] = useState<ReplacementDecision[]>([])
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  type Attempt = {
    key: string
    command: ReplacementCommand
    decision: ReplacementDecision
  }
  const request = useRef<Attempt | null>(null)
  const [attemptSnapshot, setAttemptSnapshot] = useState<Attempt | null>(null)
  const reading = useRef(0)
  const mounted = useRef(true)
  const load = useCallback(async () => {
    const sequence = ++reading.current
    try {
      const result = await api<ReplacementDecision[]>(
        `/queues/${queueId}/replacement-decisions`,
      )
      if (mounted.current && sequence === reading.current) {
        setRows(result)
        setReadError(false)
      }
    } catch (e) {
      if (mounted.current && sequence === reading.current) {
        setReadError(true)
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          setRows([])
        }
      }
    }
  }, [queueId])
  useEffect(() => {
    mounted.current = true
    const initial = setTimeout(() => void load(), 0)
    const timer = setInterval(() => {
      if (!request.current && document.visibilityState !== 'hidden') void load()
    }, 5000)
    const focus = () => {
      if (document.visibilityState !== 'hidden' && !request.current) void load()
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      mounted.current = false
      clearTimeout(initial)
      clearInterval(timer)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [load])
  const active =
    attemptSnapshot?.decision ??
    (!blocked ? rows.find((r) => !closed.has(r.id)) : undefined)
  function remember(id: string) {
    setClosed((previous) => new Set(previous).add(id))
  }
  function close() {
    if (busy || uncertain) return
    if (active) remember(active.id)
    setChoosing(false)
    setError('')
  }
  async function send(command: ReplacementCommand) {
    if (busy || !active || (request.current && !uncertain)) return
    const attempt = request.current ?? {
      key: crypto.randomUUID(),
      command,
      decision: active,
    }
    request.current = attempt
    setAttemptSnapshot(attempt)
    setBusy(true)
    onBusy(true)
    setError('')
    try {
      await api(
        `/queues/${queueId}/commands`,
        'POST',
        attempt.command,
        attempt.key,
      )
      request.current = null
      setAttemptSnapshot(null)
      setChoosing(false)
      setUncertain(false)
      remember(attempt.decision.id)
      await load()
      await onResolved().catch(() => undefined)
    } catch (e) {
      const unknown = !(e instanceof ApiError) || e.status >= 500
      if (!unknown) {
        request.current = null
        setAttemptSnapshot(null)
        setChoosing(false)
        setUncertain(false)
        await load()
        await onResolved().catch(() => undefined)
      } else setUncertain(true)
      setError(
        unknown
          ? 'No pudimos confirmar la respuesta. Comprueba la asignación antes de continuar.'
          : errorMessage(e),
      )
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }
  const suggested = active?.candidates.find(
    (c) => c.partySize <= active.originalPartySize,
  )
  function assign(candidate: ReplacementDecision['candidates'][number]) {
    if (active)
      void send({
        action: 'resolve_replacement',
        decisionId: active.id,
        decisionVersion: active.version,
        entryId: candidate.id,
        version: candidate.version,
      })
  }
  return (
    <>
      <Sheet
        open={!!active}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <SheetContent
          side="bottom"
          finalFocus={returnFocus}
          showCloseButton={!busy && !uncertain}
          className="mx-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="px-0 pr-8">
            <SheetTitle className="text-2xl">Elige otro turno</SheetTitle>
            <SheetDescription>
              {active?.unavailable
                ? active.unavailable === 'disabled'
                  ? 'El relevo automático está desactivado. Asigna el siguiente turno manualmente desde la lista.'
                  : 'No podemos confirmar el espacio y la capacidad. Asigna el siguiente turno manualmente desde la lista.'
                : active?.candidates.some(
                    (c) => c.partySize === active.originalPartySize,
                  )
                ? 'Hay nuevos turnos disponibles. Elige el siguiente grupo.'
                : `No hay otro grupo de ${active?.originalPartySize} compatible con esta mesa.`}
            </SheetDescription>
          </SheetHeader>
          {active?.seating && (
            <p className="text-sm text-muted-foreground">
              {active.seating.spaceName} · Mesa para {active.seating.seats}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {!active?.unavailable && !active?.candidates.length && (
            <p>No hay turnos compatibles disponibles.</p>
          )}
          {!choosing && suggested && (
            <div className="rounded-lg border p-4 space-y-1">
              <p className="font-medium">
                {suggested.displayName || `Turno ${suggested.code}`}
              </p>
              <p className="text-sm text-muted-foreground">
                Turno: {suggested.code} · Grupo de {suggested.partySize}
              </p>
            </div>
          )}
          {choosing && (
            <div
              className="space-y-2"
              role="group"
              aria-label="Turnos compatibles"
            >
              {active?.candidates.map((candidate) => (
                <Button
                  key={candidate.id}
                  variant="outline"
                  className="h-auto w-full justify-between whitespace-normal py-3"
                  disabled={busy || uncertain || readError}
                  onClick={() => assign(candidate)}
                >
                  <span>
                    {candidate.displayName || `Turno ${candidate.code}`} ·{' '}
                    {candidate.code}
                  </span>
                  <span>Asignar grupo de {candidate.partySize}</span>
                </Button>
              ))}
            </div>
          )}
          <SheetFooter className="px-0 gap-2">
            {uncertain && attemptSnapshot ? (
              <Button
                disabled={busy}
                onClick={() => void send(attemptSnapshot.command)}
              >
                Comprobar asignación
              </Button>
            ) : (
              <>
                {!choosing && suggested && (
                  <Button
                    disabled={busy || readError}
                    className="h-12"
                    onClick={() => assign(suggested)}
                  >
                    Asignar grupo de {suggested.partySize}
                  </Button>
                )}
                {!choosing && !!active?.candidates.length && (
                  <Button
                    variant="outline"
                    disabled={busy || readError}
                    onClick={() => setChoosing(true)}
                  >
                    Elegir otro turno
                  </Button>
                )}
                <Button variant="outline" disabled={busy} onClick={close}>
                  Ahora no
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || readError}
                  onClick={() =>
                    active &&
                    void send({
                      action: 'dismiss_replacement',
                      decisionId: active.id,
                      decisionVersion: active.version,
                    })
                  }
                >
                  Descartar aviso
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
