import { useRef, useState, type FormEvent } from 'react'
import {
  publicServiceConsentVersion,
  type PublicService,
  type PublicServiceJoin,
  type ServiceJoin,
} from '@noqueue/contracts/queue'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CustomerFooter, type Locale } from './shared'
import { SpaceSelector } from './SpaceSelector'
import { PublicWhatsAppConsentFields } from './PublicWhatsAppConsentFields'
import { validPublicWhatsAppConsent } from '@/lib/phone-validation'

export function RestaurantForm({
  service,
  locale,
  initial,
  disabled = false,
  onSubmit,
  onCancel,
}: {
  service: PublicService
  locale: Locale
  initial?: ServiceJoin
  disabled?: boolean
  onSubmit: (input: ServiceJoin | PublicServiceJoin, key: string) => Promise<void>
  onCancel?: () => void
}) {
  const es = locale === 'es'
  const [name, setName] = useState(initial?.displayName ?? '')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [size, setSize] = useState(initial?.partySize ?? 1)
  const [space, setSpace] = useState(initial?.preferredSpaceId ?? 'fastest')
  const [hasAttempt, setHasAttempt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<{ payload: string; key: string } | null>(null)
  const lock = useRef(false)
  const compatible =
    space === 'fastest'
      ? service.spaces.some((s) => s.maxPartySize >= size)
      : service.spaces.some((s) => s.id === space && s.maxPartySize >= size)
  function changeSize(next: number) {
    setSize(next)
    if (
      space !== 'fastest' &&
      !service.spaces.some((s) => s.id === space && s.maxPartySize >= next)
    )
      setSpace('fastest')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (
      lock.current ||
      (disabled && !request.current) ||
      !name.trim() ||
      !compatible ||
      (!initial && !validPublicWhatsAppConsent(phone, consent))
    )
      return
    setHasAttempt(true)
    lock.current = true
    setBusy(true)
    setError('')
    const input: ServiceJoin | PublicServiceJoin = {
      displayName: name.trim(),
      partySize: size,
      preferredSpaceId: space,
      locale,
      ...(!initial
        ? {
            whatsapp: {
              consent: true as const,
              phone,
              version: publicServiceConsentVersion,
            },
          }
        : {}),
    }
    const payload = JSON.stringify(input)
    if (request.current?.payload !== payload)
      request.current = { payload, key: crypto.randomUUID() }
    try {
      await onSubmit(input, request.current.key)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : es
          ? 'No se pudo guardar.'
          : 'Could not save.',
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      <div className="space-y-4 px-4 pt-6 pb-8">
        <h1 className="text-3xl leading-9 font-medium text-gray-800">
          {initial
            ? es
              ? 'Modifica tus datos'
              : 'Edit your details'
            : es
            ? 'Introduce tus datos'
            : 'Enter your details'}
        </h1>
        <div className="space-y-6">
          <label
            className="grid gap-4 font-medium leading-none"
            htmlFor="customer-name"
          >
            <span>
              {es ? 'Nombre' : 'Name'}
              <span aria-hidden="true">*</span>
            </span>
            <Input
              id="customer-name"
              aria-label={es ? 'Nombre' : 'Name'}
              autoComplete="name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy || disabled}
              className="h-11 text-sm!"
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">
              {es ? '¿Cuántos comensales?' : 'How many guests?'}
            </p>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="size-11 rounded-xl"
                aria-label={es ? 'Menos comensales' : 'Fewer guests'}
                disabled={size <= 1 || busy || disabled}
                onClick={() => changeSize(size - 1)}
              >
                <Minus />
              </Button>
              <output
                aria-label={es ? 'Número de comensales' : 'Number of guests'}
                className="min-w-5 text-center"
              >
                {size}
              </output>
              <Button
                type="button"
                variant="outline"
                className="size-11 rounded-xl"
                aria-label={es ? 'Más comensales' : 'More guests'}
                disabled={size >= 20 || busy || disabled}
                onClick={() => changeSize(size + 1)}
              >
                <Plus />
              </Button>
            </div>
          </div>
          <SpaceSelector
            service={service}
            locale={locale}
            size={size}
            value={space}
            disabled={busy || disabled}
            onChange={setSpace}
          />
          {!initial && (
            <PublicWhatsAppConsentFields
              locale={locale}
              phone={phone}
              consent={consent}
              disabled={busy || disabled}
              onPhoneChange={(value) => {
                setPhone(value)
                setHasAttempt(false)
              }}
              onConsentChange={(value) => {
                setConsent(value)
                setHasAttempt(false)
              }}
            />
          )}
          {!compatible && (
            <p role="status">
              {es
                ? 'No hay espacios compatibles con este grupo.'
                : 'No space can accommodate this group.'}
            </p>
          )}
          {disabled && (
            <p role="status">
              {!service.open
                ? es
                  ? 'La lista está cerrada.'
                  : 'The waiting list is closed.'
                : es
                ? 'El turno ya no permite esta operación.'
                : 'This entry no longer allows this action.'}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
      <CustomerFooter>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            {es ? 'Volver' : 'Back'}
          </Button>
        )}
        <Button
          type="submit"
          disabled={
            busy ||
            (disabled && !hasAttempt) ||
            !compatible ||
            (!initial && !validPublicWhatsAppConsent(phone, consent))
          }
        >
          {busy
            ? es
              ? 'Guardando…'
              : 'Saving…'
            : initial
            ? es
              ? 'Guardar cambios'
              : 'Save changes'
            : es
            ? 'Ponerme en lista'
            : 'Join waiting list'}
        </Button>
      </CustomerFooter>
    </form>
  )
}
