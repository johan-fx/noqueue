import { useEffect, useId, useRef, useState } from 'react'
import type {
  LocationCandidate,
  LocationScope,
} from '@noqueue/contracts/discovery'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox'
import { api, ApiError, errorMessage } from './api'

type Props = {
  scope: LocationScope
  onSelection: (token: string) => void
  initialAddress?: string
  disabled?: boolean
}
export function LocationPicker(props: Props) {
  // A scope change owns a fresh request/selection lifetime, never an automatic search.
  return (
    <AddressCombobox key={`${props.scope.kind}:${props.scope.id}`} {...props} />
  )
}
function AddressCombobox({
  scope,
  onSelection,
  initialAddress = '',
  disabled = false,
}: Props) {
  const id = useId(),
    [text, setText] = useState(initialAddress),
    [candidates, setCandidates] = useState<LocationCandidate[]>([]),
    [selected, setSelected] = useState<LocationCandidate | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [quotaBlocked, setQuotaBlocked] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const revision = useRef(0),
    request = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    expiry = useRef<ReturnType<typeof setTimeout> | null>(null),
    quota = useRef<ReturnType<typeof setTimeout> | null>(null),
    composing = useRef(false),
    callback = useRef(onSelection)
  useEffect(() => {
    callback.current = onSelection
  }, [onSelection])
  function cancel() {
    revision.current++
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    request.current?.abort()
    request.current = null
  }
  useEffect(
    () => () => {
      revision.current++
      if (timer.current) clearTimeout(timer.current)
      request.current?.abort()
      if (expiry.current) clearTimeout(expiry.current)
      if (quota.current) clearTimeout(quota.current)
      callback.current('')
    },
    [],
  )
  const valid = text.trim().length >= 5 && text.trim().length <= 200
  async function query(value: string) {
    cancel()
    const current = revision.current,
      controller = new AbortController()
    request.current = controller
    setBusy(true)
    setCandidates([])
    setError('')
    try {
      const result = await api<{ candidates: LocationCandidate[] }>(
        '/locations/autocomplete',
        'POST',
        { text: value.trim(), scope },
        undefined,
        controller.signal,
      )
      if (current !== revision.current || controller.signal.aborted) return
      setCandidates(result.candidates.slice(0, 5))
    } catch (e) {
      if (current !== revision.current || controller.signal.aborted) return
      setCandidates([])
      setError(errorMessage(e))
      setOpen(false)
      if (e instanceof ApiError && e.retryAfter > 0) {
        setQuotaBlocked(true)
        if (quota.current) clearTimeout(quota.current)
        quota.current = setTimeout(
          () => setQuotaBlocked(false),
          e.retryAfter * 1000,
        )
      }
    } finally {
      if (current === revision.current) {
        setBusy(false)
        request.current = null
      }
    }
  }
  function edit(value: string) {
    cancel()
    if (expiry.current) clearTimeout(expiry.current)
    setBusy(false)
    setText(value)
    setSelected(null)
    setCandidates([])
    setError('')
    callback.current('')
    setOpen(true)
    if (
      !disabled &&
      !composing.current &&
      !quotaBlocked &&
      value.trim().length >= 5 &&
      value.trim().length <= 200
    )
      timer.current = setTimeout(() => void query(value), 350)
  }
  function close() {
    cancel()
    setBusy(false)
    setOpen(false)
  }
  function select(candidate: LocationCandidate | null) {
    if (!candidate) return
    cancel()
    setBusy(false)
    setOpen(false)
    if (expiry.current) clearTimeout(expiry.current)
    if (candidate.expiresAt <= Date.now()) {
      setSelected(null)
      setError(
        'La selección ha caducado. Busca y selecciona de nuevo la dirección.',
      )
      callback.current('')
      return
    }
    setSelected(candidate)
    setText(candidate.location.formatted)
    setError('')
    callback.current(candidate.token)
    expiry.current = setTimeout(() => {
      setSelected(null)
      setError(
        'La selección ha caducado. Busca y selecciona de nuevo la dirección.',
      )
      callback.current('')
    }, candidate.expiresAt - Date.now())
  }
  const message = busy
    ? 'Buscando direcciones…'
    : error
    ? error
    : selected
    ? 'Dirección seleccionada. Confirma el formulario para guardar.'
    : !valid
    ? 'Escribe al menos 5 caracteres (máximo 200). Incluye calle, número y municipio.'
    : candidates.length
    ? `${candidates.length} direcciones. Selecciona una para confirmar.`
    : 'No hay direcciones precisas. Incluye calle, número y municipio.'
  const retry =
    error || (!busy && valid && !selected && !candidates.length) ? (
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy || !valid || !!selected || quotaBlocked}
        onClick={() => {
          inputRef.current?.focus()
          setOpen(true)
          void query(text)
        }}
      >
        Reintentar búsqueda
      </Button>
    ) : null
  return (
    <div className="space-y-3">
      <Combobox
        items={candidates}
        filter={null}
        value={selected}
        inputValue={text}
        open={open}
        disabled={disabled}
        itemToStringLabel={(c) => c.location.formatted}
        isItemEqualToValue={(a, b) => a.token === b.token}
        onInputValueChange={(value, details) => {
          if (
            details.reason === 'input-change' ||
            details.reason === 'clear-press'
          )
            edit(value)
          else if (details.reason === 'input-clear') details.cancel()
        }}
        onValueChange={(value, details) => {
          if (details.reason === 'item-press') select(value)
        }}
        onOpenChange={(value) => {
          if (!value) close()
          else if (!disabled) setOpen(true)
        }}
      >
        <Field>
          <FieldLabel htmlFor={id}>Dirección del establecimiento</FieldLabel>
          <ComboboxInput
            id={id}
            ref={inputRef}
            aria-label="Dirección del establecimiento"
            autoComplete="off"
            maxLength={200}
            aria-describedby={`${id}-status`}
            placeholder="Calle, número y municipio (España)"
            onCompositionStart={() => {
              composing.current = true
              edit(text)
            }}
            onCompositionEnd={(e) => {
              composing.current = false
              edit(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && open) {
                e.preventDefault()
                e.stopPropagation()
                close()
              }
            }}
          />
        </Field>
        <ComboboxContent>
          <ComboboxEmpty>
            {busy ? 'Buscando direcciones…' : message}
            {open && retry}
          </ComboboxEmpty>
          <ComboboxList>
            {(candidate: LocationCandidate) => (
              <ComboboxItem key={candidate.token} value={candidate}>
                <span>{candidate.location.formatted}</span>
                <span className="block text-xs text-muted-foreground">
                  {candidate.location.attribution
                    .map((a) => a.text)
                    .join(' · ')}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p
        id={`${id}-status`}
        role="status"
        aria-live="polite"
        className={`text-sm ${
          error ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        {message}
      </p>
      {!open && retry}
      {(
        selected?.location.attribution ?? candidates[0]?.location.attribution
      )?.map((a, i) => (
        <span key={a.url} className="text-xs text-muted-foreground">
          {i ? ' · ' : ''}
          <a href={a.url} target="_blank" rel="noreferrer">
            {a.text}
          </a>
        </span>
      ))}
      <p className="text-sm text-muted-foreground">
        Selecciona una dirección antes de guardar. Todos los servicios
        compartirán esta ubicación.
      </p>
    </div>
  )
}
