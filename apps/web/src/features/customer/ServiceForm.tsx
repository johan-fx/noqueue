import { useRef, useState, type FormEvent } from 'react'
import {
  publicServiceConsentVersion,
  type PublicService,
  type PublicServiceJoin,
  type ServiceJoin,
} from '@noqueue/contracts/queue'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CustomerFooter, type Locale } from './shared'
import {
  PublicWhatsAppConsentFields,
  validPublicWhatsAppConsent,
} from './PublicWhatsAppConsentFields'

/** Single-person public admission for reception and pool services. */
export function ServiceForm({
  service,
  locale,
  disabled = false,
  onSubmit,
}: {
  service: PublicService
  locale: Locale
  disabled?: boolean
  onSubmit: (input: PublicServiceJoin, key: string) => Promise<void>
}) {
  const es = locale === 'es'
  const reception = service.type === 'reception'
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [task, setTask] = useState<ServiceJoin['receptionService']>()
  const selected =
    task && service.receptionServices.includes(task)
      ? task
      : service.receptionServices.includes('check_in')
      ? 'check_in'
      : service.receptionServices[0]
  const [busy, setBusy] = useState(false)
  const [hasAttempt, setHasAttempt] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<{ input: PublicServiceJoin; key: string } | null>(null)
  const lock = useRef(false)
  const unavailable = reception && !selected
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (
      lock.current ||
      (!request.current &&
        (disabled ||
          unavailable ||
          !name.trim() ||
          !validPublicWhatsAppConsent(phone, consent)))
    )
      return
    const input: PublicServiceJoin = {
      displayName: name.trim(),
      partySize: 1,
      locale,
      whatsapp: {
        consent: true,
        phone,
        version: publicServiceConsentVersion,
      },
      ...(reception ? { receptionService: selected } : {}),
    }
    // Retry the frozen intent even if polling changed admission or configuration.
    request.current ??= { input, key: crypto.randomUUID() }
    setHasAttempt(true)
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await onSubmit(request.current.input, request.current.key)
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
  const labels = {
    check_in: 'Check-in',
    check_out: 'Check-out',
    other: es ? 'Otros temas' : 'Other matters',
  }
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      <div className="space-y-4 px-4 pt-6 pb-8">
        <h1 className="text-3xl leading-9 font-medium text-gray-800">
          {es ? 'Introduce tus datos' : 'Enter your details'}
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
              onChange={(event) => {
                setName(event.target.value)
                request.current = null
                setHasAttempt(false)
              }}
              disabled={busy || disabled}
              className="h-11 text-sm!"
            />
          </label>
          {reception && (
            <fieldset disabled={busy || disabled}>
              <legend className="mb-4 font-medium leading-none">
                {es ? '¿Qué tienes que hacer?' : 'What do you need to do?'}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {service.receptionServices.map((value) => (
                  <label
                    key={value}
                    className={`relative flex min-h-12 cursor-pointer items-center justify-between gap-1 rounded-lg border px-4 py-2 shadow-xs has-focus-visible:ring-2 has-disabled:cursor-not-allowed has-disabled:opacity-40 ${
                      selected === value ? 'border-gray-800' : 'border-input'
                    }`}
                  >
                    <input
                      type="radio"
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                      name="reception-service"
                      value={value}
                      checked={selected === value}
                      onChange={() => {
                        setTask(value)
                        request.current = null
                        setHasAttempt(false)
                      }}
                    />
                    <span className="text-base leading-5">{labels[value]}</span>
                    {selected === value && (
                      <Check aria-hidden="true" className="size-6 shrink-0" />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {unavailable && (
            <p role="alert">
              {es
                ? 'No hay trámites de recepción disponibles.'
                : 'No reception services are available.'}
            </p>
          )}
          <PublicWhatsAppConsentFields
            locale={locale}
            phone={phone}
            consent={consent}
            disabled={busy || disabled}
            onPhoneChange={(value) => {
              setPhone(value)
              request.current = null
              setHasAttempt(false)
            }}
            onConsentChange={(value) => {
              setConsent(value)
              request.current = null
              setHasAttempt(false)
            }}
          />
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
      <CustomerFooter>
        <Button
          type="submit"
          disabled={
            busy ||
            (!hasAttempt &&
              (disabled ||
                unavailable ||
                !name.trim() ||
                !validPublicWhatsAppConsent(phone, consent)))
          }
        >
          {busy
            ? es
              ? 'Guardando…'
              : 'Saving…'
            : es
            ? 'Ponerme en lista'
            : 'Join waiting list'}
        </Button>
      </CustomerFooter>
    </form>
  )
}
