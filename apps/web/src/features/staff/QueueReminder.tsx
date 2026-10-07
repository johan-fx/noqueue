import { useRef, useState } from 'react'
import type { QueueOpeningContext } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { api, ApiError, errorMessage } from './api'

/** There is no timeout or silent-accept path. Only these two operator responses mutate state. */
export function QueueReminder({
  queueId,
  onSaved,
}: {
  queueId: string
  onSaved: () => Promise<void> | void
}) {
  const lock = useRef(false)
  const request = useRef<{ action: string; body: unknown; key: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [error, setError] = useState('')
  async function respond(action: 'declare_full' | 'dismiss_reminder') {
    if (lock.current || committed) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (request.current?.action !== action) {
        const context = await api<QueueOpeningContext>(
          `/queues/${queueId}/opening-context`,
        )
        request.current = {
          action,
          body: { action, contextToken: context.contextToken },
          key: crypto.randomUUID(),
        }
      }
      await api(
        `/queues/${queueId}/lifecycle`,
        'POST',
        request.current.body,
        request.current.key,
      )
      setCommitted(true)
      await onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) request.current = null
      setError(errorMessage(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (committed)
    return error ? (
      <p role="status">Respuesta guardada. Actualiza el listado.</p>
    ) : null
  return (
    <div className="space-y-3 rounded-lg border p-3" role="status">
      <p>¿El restaurante está lleno?</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void respond('declare_full')}>
          Activar lista
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void respond('dismiss_reminder')}
        >
          Ahora no
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
