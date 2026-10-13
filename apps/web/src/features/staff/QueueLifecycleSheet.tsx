import { useEffect, useRef, useState } from 'react'
import type {
  QueueLifecycleCommand,
  QueueOpeningContext,
  ServiceInput,
} from '@noqueue/contracts/staff'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { api, ApiError, errorMessage } from './api'
export function QueueLifecycleSheet({
  queueId,
  name,
  action,
  onClose,
  onSaved,
  returnFocus,
}: {
  queueId: string
  name: string
  action: QueueLifecycleCommand['action']
  type?: ServiceInput['type']
  onClose: () => void
  onSaved: () => void | Promise<void>
  returnFocus?: HTMLElement | null
}) {
  const [context, setContext] = useState<QueueOpeningContext | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const request = useRef<{ payload: string; key: string } | null>(null)
  useEffect(() => {
    let live = true
    api<QueueOpeningContext>(`/queues/${queueId}/opening-context`)
      .then((value) => {
        if (live) setContext(value)
      })
      .catch((e) => {
        if (live) setError(errorMessage(e))
      })
    return () => {
      live = false
    }
    // The component is mounted for one queue/action; a fresh opening never inherits a draft.
  }, [queueId, action])
  async function submit(body: QueueLifecycleCommand) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    const payload = JSON.stringify(body)
    if (request.current?.payload !== payload)
      request.current = { payload, key: crypto.randomUUID() }
    try {
      await api(
        `/queues/${queueId}/lifecycle`,
        'POST',
        body,
        request.current.key,
      )
      // A committed mutation must never be offered again because its refresh failed.
      onClose()
      await onSaved()
    } catch (e) {
      setError(errorMessage(e))
      if (e instanceof ApiError && e.status === 409) {
        request.current = null
        try {
          setContext(
            await api<QueueOpeningContext>(
              `/queues/${queueId}/opening-context`,
            ),
          )
          setError(
            'La lista ha cambiado. Revisa los datos actualizados y vuelve a confirmar.',
          )
        } catch (refreshError) {
          setContext(null)
          setError(errorMessage(refreshError))
        }
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const labels: Partial<Record<QueueLifecycleCommand['action'], string>> = {
    open: 'Abrir lista',
    declare_full: 'Activar lista',
    pause: 'Pausar lista',
    resume: 'Reanudar lista',
    close: 'Cerrar lista',
    dismiss_reminder: 'Ahora no',
    enable_intelligence: 'Volver a gestión automática',
    disable_intelligence: 'Desactivar gestión inteligente',
  }
  const label = labels[action]
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving.current) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        finalFocus={() => returnFocus ?? null}
        className="mx-auto max-h-[85dvh] w-full rounded-t-xl sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>
            {label ?? 'Operación retirada'} · {name}
          </SheetTitle>
          <SheetDescription>
            {action === 'pause' || action === 'close'
              ? 'Se detienen las nuevas inscripciones. Los turnos existentes conservan su plazo de llegada.'
              : 'La gestión de turnos no requiere registrar la ocupación de mesas o espacios.'}
          </SheetDescription>
        </SheetHeader>
        <div className="p-6">
          {!context && !error && <p>Cargando…</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <SheetFooter>
          <Button
            disabled={busy || !context || !label}
            onClick={() => {
              if (context && label)
                void submit({
                  action,
                  contextToken: context.contextToken,
                  ...(action === 'open' ? { groups: [] } : {}),
                } as QueueLifecycleCommand)
            }}
          >
            {busy ? 'Guardando…' : label ?? 'Operación retirada'}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Volver
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
