import { useId, useRef, useState } from 'react'
import {
  serviceJoinSchema,
  type PublicService,
  type ServiceJoin,
} from '@noqueue/contracts/queue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { receptionLabels } from './queue-labels'
import { errorMessage } from './api'

export function QueueEntryForm({
  service,
  onSubmit,
  submitLabel = 'Añadir turno',
  disabled = false,
  onBusyChange,
}: {
  service: Pick<PublicService, 'type' | 'receptionServices' | 'spaces'>
  onSubmit: (input: ServiceJoin, key: string) => Promise<void>
  submitLabel?: string
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const id = useId()
  const [displayName, setDisplayName] = useState('')
  const [partySize, setPartySize] = useState(
    service.type === 'reception' ? 1 : 2,
  )
  const [receptionService, setReceptionService] = useState(
    service.receptionServices[0] ?? 'other',
  )
  const [preferredSpaceId, setPreferredSpaceId] = useState('fastest')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const attempt = useRef<{ body: string; key: string } | null>(null)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current || disabled) return
    const input = serviceJoinSchema.safeParse({
      displayName: displayName.trim(),
      partySize,
      locale: 'es',
      ...(service.type === 'reception' ? { receptionService } : {}),
      ...(service.type === 'restaurant' ? { preferredSpaceId } : {}),
    })
    if (!input.success) {
      setError('Revisa el nombre y el número de personas.')
      return
    }
    lock.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    const body = JSON.stringify(input.data)
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() }
    try {
      await onSubmit(input.data, attempt.current.key)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      lock.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
  }
  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || disabled} className="space-y-5">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Nombre</FieldLabel>
          <Input
            id={`${id}-name`}
            required
            maxLength={100}
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        {service.type !== 'reception' && (
          <Field>
            <FieldLabel htmlFor={`${id}-size`}>Número de personas</FieldLabel>
            <Input
              id={`${id}-size`}
              type="number"
              min={1}
              max={20}
              required
              value={partySize}
              onChange={(event) => setPartySize(event.target.valueAsNumber)}
            />
          </Field>
        )}
        {service.type === 'reception' && (
          <Field>
            <FieldLabel htmlFor={`${id}-reception`}>
              Tipo de gestión
            </FieldLabel>
            <select
              id={`${id}-reception`}
              className="h-10 w-full rounded-lg border bg-background px-3"
              value={receptionService}
              onChange={(event) =>
                setReceptionService(
                  event.target.value as typeof receptionService,
                )
              }
            >
              {service.receptionServices.map((type) => (
                <option key={type} value={type}>
                  {receptionLabels[type]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {service.type === 'restaurant' && (
          <Field>
            <FieldLabel htmlFor={`${id}-space`}>Espacio</FieldLabel>
            <select
              id={`${id}-space`}
              className="h-10 w-full rounded-lg border bg-background px-3"
              value={preferredSpaceId}
              onChange={(event) => setPreferredSpaceId(event.target.value)}
            >
              <option value="fastest">El más rápido</option>
              {service.spaces.map((space) => (
                <option
                  key={space.id}
                  value={space.id}
                  disabled={partySize > space.maxPartySize}
                >
                  {space.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Si eliges un espacio, el turno esperará a que haya sitio en él.
            </p>
          </Field>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        className="h-12 w-full"
        type="submit"
        disabled={busy || disabled}
      >
        {busy ? 'Guardando…' : submitLabel}
      </Button>
    </form>
  )
}
