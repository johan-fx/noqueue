import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  consentCopy,
  consentVersion,
  entrySchema,
  joinedEntrySchema,
  type Entry,
} from '@noqueue/contracts/queue'
import { Button } from '@/components/ui/button'

export function DemoQueue() {
  const id = useId()
  const navigate = useNavigate()
  const [locale, setLocale] = useState<'es' | 'en'>('es')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState<{ key: string; body: string } | null>(
    null,
  )
  const es = locale === 'es'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const body = JSON.stringify({
      partySize: Number(form.get('partySize')),
      locale,
      whatsapp: consent
        ? { consent: true, phone: form.get('phone'), version: consentVersion }
        : { consent: false },
    })
    const current =
      attempt?.body === body ? attempt : { key: crypto.randomUUID(), body }
    setAttempt(current)
    try {
      const response = await fetch('/api/v1/public/queues/demo-queue/entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': current.key,
          'X-NoQueue-Pilot-Token': String(form.get('pilot')),
        },
        body,
      })
      if (!response.ok) throw new Error('join_failed')
      const entry = joinedEntrySchema.parse(await response.json())
      navigate(`/t/${entry.recoveryToken}?lang=${locale}`)
    } catch {
      setError(
        es
          ? 'No se pudo confirmar el turno. Reintenta con los mismos datos; no se duplicará.'
          : 'Could not confirm your entry. Retry with the same details; it will not be duplicated.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold">
        {es ? 'Lista de demostración' : 'Demo waiting list'}
      </h1>
      <div>
        <label htmlFor={`${id}-locale`}>{es ? 'Idioma' : 'Language'}</label>
        <Select
          items={[
            { value: 'es', label: 'Español' },
            { value: 'en', label: 'English' },
          ]}
          value={locale}
          onValueChange={(value) => {
            if (value !== null) setLocale(value === 'en' ? 'en' : 'es')
          }}
        >
          <SelectTrigger id={`${id}-locale`} disabled={busy}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="es">Español</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          {es ? 'Comensales' : 'Party size'}
          <input
            className="block border rounded p-2"
            name="partySize"
            type="number"
            min="1"
            max="20"
            defaultValue="2"
            required
            disabled={busy}
          />
        </label>
        <label className="block">
          {es ? 'Código de acceso a pruebas' : 'Pilot access code'}
          <input
            className="block border rounded p-2"
            name="pilot"
            type="password"
            autoComplete="off"
            required
            disabled={busy}
          />
        </label>
        <div className="flex gap-2">
          <Checkbox
            id={`${id}-consent`}
            checked={consent}
            onCheckedChange={(checked) => setConsent(checked)}
            disabled={busy}
          />
          <label htmlFor={`${id}-consent`}>{consentCopy[locale]}</label>
        </div>
        {consent && (
          <label className="block">
            {es
              ? 'Teléfono con prefijo internacional'
              : 'Phone with country code'}
            <input
              className="block border rounded p-2"
              name="phone"
              type="tel"
              placeholder="+34600000000"
              pattern="\+[1-9][0-9]{7,14}"
              required
              disabled={busy}
            />
          </label>
        )}
        <Button type="submit" disabled={busy}>
          {busy
            ? es
              ? 'Guardando…'
              : 'Saving…'
            : es
            ? 'Apuntarme a la lista'
            : 'Join waiting list'}
        </Button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  )
}
export function DemoEntry() {
  const { recoveryToken } = useParams()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [error, setError] = useState(false)
  const es = new URLSearchParams(window.location.search).get('lang') !== 'en'
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/v1/public/entries/${recoveryToken}`,
          { signal: controller.signal, cache: 'no-store' },
        )
        if (!response.ok) throw new Error('entry_unavailable')
        setEntry(entrySchema.parse(await response.json()))
        setError(false)
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [recoveryToken])
  return (
    <section className="space-y-4" aria-live="polite">
      <h1 className="text-2xl font-semibold">
        {es ? 'Tu turno' : 'Your waiting list entry'}
      </h1>
      {entry && (
        <>
          <p className="text-4xl font-bold">{entry.code}</p>
          <p>
            {es ? 'Estado' : 'Status'}:{' '}
            {entry.status === 'called'
              ? es
                ? 'Es tu turno. Acude al servicio.'
                : 'Your turn. Please arrive at the service.'
              : entry.status === 'completed'
              ? es
                ? 'En servicio'
                : 'In service'
              : entry.status === 'served'
              ? es
                ? 'Servicio finalizado'
                : 'Service finished'
              : entry.status}
          </p>
          <p>
            {es ? 'Posición' : 'Position'}: {entry.position}
          </p>
          <p>
            {entry.estimateQuality === 'unknown' ? (
              es ? (
                'Espera pendiente de datos'
              ) : (
                'Wait estimate not yet available'
              )
            ) : (
              <>
                {es ? 'Espera aproximada' : 'Estimated wait'}:{' '}
                {entry.etaMinutes} min
                {entry.estimateQuality === 'provisional'
                  ? es
                    ? ' · Provisional'
                    : ' · Provisional'
                  : ''}
              </>
            )}
          </p>
          <p>WhatsApp: {entry.notification}</p>
          <p>
            {es
              ? 'Guarda este enlace privado para consultar el estado de tu turno.'
              : 'Save this private link to check your waiting list status.'}
          </p>
        </>
      )}
      {error && (
        <p role="alert">
          {es
            ? 'No se puede actualizar el turno. Volveremos a intentarlo.'
            : 'Cannot refresh your entry. We will try again.'}
        </p>
      )}
    </section>
  )
}
