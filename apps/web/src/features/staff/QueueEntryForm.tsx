import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
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
  locale = 'es',
}: {
  service: Pick<PublicService, 'type' | 'receptionServices' | 'spaces'>
  onSubmit: (input: ServiceJoin, key: string) => Promise<void>
  locale?: 'es' | 'en'
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
  const [hasAttempt, setHasAttempt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const attempt = useRef<{ body: string; key: string } | null>(null)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current || (disabled && !attempt.current)) return
    const input = serviceJoinSchema.safeParse({
      displayName: displayName.trim(),
      partySize,
      locale,
      ...(service.type === 'reception' ? { receptionService } : {}),
      ...(service.type === 'restaurant' ? { preferredSpaceId } : {}),
    })
    if (!input.success) {
      setError('Revisa el nombre y el número de personas.')
      return
    }
    setHasAttempt(true)
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
          <FieldLabel htmlFor={`${id}-name`}>
            {locale === 'es' ? 'Nombre' : 'Name'}
          </FieldLabel>
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
            <FieldLabel htmlFor={`${id}-size`}>
              {locale === 'es' ? 'Número de personas' : 'Number of guests'}
            </FieldLabel>
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
              {locale === 'es' ? 'Tipo de gestión' : 'Service type'}
            </FieldLabel>
            <Select
              items={service.receptionServices.map((type) => ({
                value: type,
                label:
                  locale === 'es'
                    ? receptionLabels[type]
                    : {
                        check_in: 'Check-in',
                        check_out: 'Check-out',
                        other: 'Other',
                      }[type],
              }))}
              value={receptionService}
              onValueChange={(value) => {
                if (value !== null)
                  setReceptionService(value as typeof receptionService)
              }}
            >
              <SelectTrigger id={`${id}-reception`} disabled={busy || disabled}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {service.receptionServices.map((type) => (
                  <SelectItem key={type} value={type}>
                    {locale === 'es'
                      ? receptionLabels[type]
                      : {
                          check_in: 'Check-in',
                          check_out: 'Check-out',
                          other: 'Other',
                        }[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {service.type === 'restaurant' && (
          <Field>
            <FieldLabel htmlFor={`${id}-space`}>Espacio</FieldLabel>
            <Select
              items={[
                { value: 'fastest', label: 'El más rápido' },
                ...service.spaces.map((space) => ({
                  value: space.id,
                  label: space.name,
                })),
              ]}
              value={preferredSpaceId}
              onValueChange={(value) => {
                if (value !== null) setPreferredSpaceId(value)
              }}
            >
              <SelectTrigger id={`${id}-space`} disabled={busy || disabled}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fastest">El más rápido</SelectItem>
                {service.spaces.map((space) => (
                  <SelectItem
                    key={space.id}
                    value={space.id}
                    disabled={partySize > space.maxPartySize}
                  >
                    {space.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        disabled={busy || (disabled && !hasAttempt)}
      >
        {busy ? (locale === 'es' ? 'Guardando…' : 'Saving…') : submitLabel}
      </Button>
    </form>
  )
}
