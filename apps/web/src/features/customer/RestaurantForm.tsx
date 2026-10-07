import { useRef, useState, type FormEvent } from 'react'
import type { PublicService, ServiceJoin } from '@noqueue/contracts/queue'
import { Check, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CustomerFooter, type Locale } from './shared'

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
  onSubmit: (input: ServiceJoin, key: string) => Promise<void>
  onCancel?: () => void
}) {
  const es = locale === 'es'
  const [name, setName] = useState(initial?.displayName ?? '')
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
      !compatible
    )
      return
    setHasAttempt(true)
    lock.current = true
    setBusy(true)
    setError('')
    const input = {
      displayName: name.trim(),
      partySize: size,
      preferredSpaceId: space,
      locale,
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
          <fieldset disabled={busy || disabled}>
            <legend className="mb-4 font-medium">
              {es
                ? '¿Dónde quieres tu mesa?'
                : 'Where would you like your table?'}
            </legend>
            <div className="grid grid-cols-2 gap-4">
              {[
                ...service.spaces,
                {
                  id: 'fastest',
                  name: es ? 'Opción más rápida' : 'Fastest option',
                  maxPartySize: Math.max(
                    0,
                    ...service.spaces.map((s) => s.maxPartySize),
                  ),
                },
              ].map((item) => (
                <label
                  key={item.id}
                  className={`relative flex min-h-12 cursor-pointer items-center justify-between gap-1 rounded-lg border px-4 py-2 has-focus-visible:ring-2 has-disabled:cursor-not-allowed has-disabled:opacity-40 ${
                    space === item.id ? 'border-gray-800' : 'border-input'
                  }`}
                >
                  <input
                    type="radio"
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                    name="customer-space"
                    value={item.id}
                    checked={space === item.id}
                    onChange={() => setSpace(item.id)}
                    disabled={item.maxPartySize < size}
                  />
                  <span className="text-base leading-5 tracking-tight">
                    {item.name}
                  </span>
                  {space === item.id && (
                    <Check aria-hidden="true" className="size-5 shrink-0" />
                  )}
                </label>
              ))}
            </div>
          </fieldset>
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
          disabled={busy || (disabled && !hasAttempt) || !compatible}
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
