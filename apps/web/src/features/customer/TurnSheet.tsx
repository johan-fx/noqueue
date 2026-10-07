import { useRef, useState } from 'react'
import { Minus, Plus, Users, X } from 'lucide-react'
import type { CustomerCommand, Entry } from '@noqueue/contracts/queue'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CustomerCommandError } from './customer-command-error'
import { SpaceSelector } from './SpaceSelector'
import type { Locale } from './shared'

type Customer = NonNullable<Entry['customer']>
type Step = 'menu' | 'party' | 'confirmParty' | 'space' | 'cancel' | 'yield'

export function TurnSheet({
  initial,
  current,
  action,
  locale,
  returnFocus,
  onClose,
  onCommand,
}: {
  initial: Customer
  current: Customer
  action: 'update' | 'cancel' | 'yield'
  locale: Locale
  returnFocus: HTMLElement | null
  onClose: () => void
  onCommand: (input: CustomerCommand, key: string) => Promise<void>
}) {
  const es = locale === 'es'
  const [step, setStep] = useState<Step>(action === 'update' ? 'menu' : action)
  const [delta, setDelta] = useState(0)
  const [space, setSpace] = useState(initial.preferredSpaceId ?? 'fastest')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState(false)
  const [attempt, setAttempt] = useState<{
    input: CustomerCommand
    key: string
  } | null>(null)
  const lock = useRef(false)
  const requiredAction = step === 'cancel' || step === 'yield' ? step : 'update'
  const stale =
    current.version !== initial.version ||
    !current.actions.includes(requiredAction)
  // An ambiguous response permits only replaying the identical confirmed intent.
  const blocked = review || (!attempt && stale)
  const size = initial.partySize + delta
  const selected =
    step === 'space' ? space : initial.preferredSpaceId ?? 'fastest'
  const compatible = current.service.spaces.some(
    (s) =>
      (selected === 'fastest' || s.id === selected) &&
      s.maxPartySize >= (step === 'space' ? initial.partySize : size),
  )
  const reviewMessage = es
    ? 'Tu turno ha cambiado. Cierra esta ventana y revisa su estado antes de repetir.'
    : 'Your turn has changed. Close this window and review its status before retrying.'
  const warning = es
    ? 'Podría cambiar el tiempo de espera.'
    : 'Your waiting time could change.'
  const titles: Record<Step, string> = {
    menu: es ? '¿Qué quieres modificar?' : 'What would you like to change?',
    party:
      delta === 0
        ? es
          ? '¿Cambiar el número de comensales?'
          : 'Change the number of guests?'
        : delta > 0
        ? es
          ? 'Añade comensales'
          : 'Add guests'
        : es
        ? 'Reduce comensales'
        : 'Reduce guests',
    confirmParty:
      delta > 0
        ? es
          ? 'Vas a añadir comensales'
          : 'You are about to add guests'
        : es
        ? 'Vas a reducir comensales'
        : 'You are about to reduce guests',
    space: es ? 'Modificar sala' : 'Change seating area',
    cancel: es
      ? '¿Confirmas que quieres abandonar la lista de espera?'
      : 'Are you sure you want to leave the waiting list?',
    yield: es ? 'Vas a pasar un turno' : 'You are about to yield your turn',
  }
  const description =
    step === 'menu'
      ? es
        ? 'Dependiendo de lo que quieras modificar, podría cambiar el tiempo de espera.'
        : 'Depending on what you change, your waiting time could change.'
      : step === 'cancel'
      ? es
        ? 'Si sales ahora perderás el turno. ¿Quieres continuar?'
        : 'If you leave now, you will lose your turn. Do you want to continue?'
      : step === 'yield'
      ? es
        ? initial.service.type === 'restaurant'
          ? 'Cederás tu posición al siguiente grupo compatible. El tiempo de espera puede aumentar. ¿Quieres continuar?'
          : 'Cederás tu posición al siguiente turno compatible. El tiempo de espera puede aumentar. ¿Quieres continuar?'
        : initial.service.type === 'restaurant'
        ? 'You will exchange places with the next compatible group. Your wait may increase. Continue?'
        : 'You will exchange places with the next compatible turn. Your wait may increase. Continue?'
      : step === 'party' && delta === 0
      ? es
        ? 'Dependiendo del número de comensales que cambies, podría cambiar el tiempo de espera.'
        : 'Depending on how many guests you change, your waiting time could change.'
      : warning

  async function confirm() {
    if (lock.current || blocked) return
    let confirmed = attempt
    if (!confirmed) {
      if ((step === 'space' || step === 'confirmParty') && !compatible) return
      const input: CustomerCommand =
        step === 'cancel' || step === 'yield'
          ? { action: step, version: initial.version }
          : {
              action: 'update',
              version: initial.version,
              displayName: initial.displayName ?? '',
              partySize: step === 'confirmParty' ? size : initial.partySize,
              preferredSpaceId:
                step === 'space'
                  ? space
                  : initial.preferredSpaceId ?? 'fastest',
              locale: initial.locale,
            }
      confirmed = { input, key: crypto.randomUUID() }
      setAttempt(confirmed)
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await onCommand(confirmed.input, confirmed.key)
      onClose()
    } catch (error) {
      if (error instanceof CustomerCommandError && error.requiresReview)
        setReview(true)
      setError(
        error instanceof CustomerCommandError
          ? error.message
          : es
          ? 'No se pudo confirmar la acción. Puedes reintentar sin duplicarla.'
          : 'Could not confirm the action. You can retry safely.',
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const dismiss =
    step === 'menu'
      ? es
        ? 'No modificar nada'
        : 'Do not change anything'
      : step === 'cancel'
      ? es
        ? 'Continuar en la lista de espera'
        : 'Stay on the waiting list'
      : step === 'yield'
      ? es
        ? 'No pasar turno'
        : 'Keep my place'
      : es
      ? 'Anular'
      : 'Cancel'
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        finalFocus={() => (returnFocus?.isConnected ? returnFocus : false)}
        className={`mx-auto max-h-[95dvh] max-w-lg overflow-y-auto font-sans rounded-t-2xl border-0 bg-white px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-gray-900 ${
          step === 'cancel'
            ? 'min-h-[389px]'
            : step === 'yield'
            ? 'min-h-[388px]'
            : 'min-h-[423px]'
        } [&_button]:text-sm! [&_button]:font-medium!`}
      >
        <SheetHeader
          className={`p-0 ${
            step === 'cancel' || step === 'yield' ? 'gap-6' : 'gap-2'
          }`}
        >
          <div className="relative">
            <SheetTitle
              className={`pr-6 text-2xl font-medium ${
                step === 'yield'
                  ? 'leading-none text-gray-700'
                  : 'leading-8 text-black'
              }`}
            >
              {titles[step]}
            </SheetTitle>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute -right-2 top-1/2 size-11 -translate-y-1/2"
                  disabled={busy}
                  aria-label={es ? 'Cerrar' : 'Close'}
                />
              }
            >
              <X className="size-6!" />
            </SheetClose>
          </div>
          <SheetDescription className="text-base leading-6 text-gray-500">
            {step === 'cancel' ? (
              <>
                {es
                  ? 'Si sales ahora perderás el turno.'
                  : 'If you leave now, you will lose your turn.'}
                <br />
                {es ? '¿Quieres continuar?' : 'Do you want to continue?'}
              </>
            ) : (
              description
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="my-auto py-4">
          {step === 'menu' && (
            <div className="grid gap-2">
              <Button
                variant="outline"
                className="h-12"
                disabled={blocked}
                onClick={() => setStep('party')}
              >
                {es
                  ? 'Modificar número de comensales'
                  : 'Change number of guests'}
              </Button>
              <Button
                variant="outline"
                className="h-12"
                disabled={blocked}
                onClick={() => setStep('space')}
              >
                {es ? 'Modificar sala' : 'Change seating area'}
              </Button>
              {current.actions.includes('yield') && (
                <Button
                  variant="outline"
                  className="h-12"
                  disabled={blocked}
                  onClick={() => setStep('yield')}
                >
                  {es ? 'Pasar turno' : 'Yield turn'}
                </Button>
              )}
            </div>
          )}
          {step === 'party' && (
            <div className="space-y-2 font-medium">
              <p className="flex items-center gap-2">
                {es ? 'Número de comensales:' : 'Number of guests:'}
                <Users aria-hidden="true" className="size-4 text-gray-500" />
                <span className="text-xs text-gray-500">
                  {initial.partySize}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <span>
                  {delta < 0
                    ? es
                      ? 'Reducir:'
                      : 'Reduce:'
                    : es
                    ? 'Añadir:'
                    : 'Add:'}
                </span>
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    className="size-11 rounded-xl"
                    aria-label={es ? 'Menos comensales' : 'Fewer guests'}
                    disabled={blocked || size <= 1}
                    onClick={() => setDelta(delta - 1)}
                  >
                    <Minus />
                  </Button>
                  <output
                    aria-label={es ? 'Variación de comensales' : 'Guest change'}
                    className="min-w-3 text-center text-base text-gray-700"
                  >
                    {delta}
                  </output>
                  <Button
                    variant="outline"
                    className="size-11 rounded-xl"
                    aria-label={es ? 'Más comensales' : 'More guests'}
                    disabled={blocked || size >= 20}
                    onClick={() => setDelta(delta + 1)}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
            </div>
          )}
          {step === 'confirmParty' && (
            <div className="mx-auto flex w-fit max-w-full items-center justify-center gap-2 rounded-xl bg-secondary p-3.5 font-medium">
              <span>
                {es ? 'Nuevo número de comensales' : 'New number of guests'}
              </span>
              <Users
                aria-hidden="true"
                className="size-4 shrink-0 text-gray-500"
              />
              <output
                aria-label={
                  es ? 'Nuevo número de comensales' : 'New number of guests'
                }
                className="text-base text-gray-500"
              >
                {size}
              </output>
            </div>
          )}
          {step === 'space' && (
            <SpaceSelector
              service={current.service}
              locale={locale}
              size={initial.partySize}
              value={space}
              disabled={busy || blocked || !!attempt}
              onChange={setSpace}
            />
          )}
          {(step === 'party' || step === 'confirmParty' || step === 'space') &&
            !compatible && (
              <p role="status" className="mt-3 text-destructive">
                {es
                  ? 'La sala elegida no admite este grupo. Usa «Modificar sala» antes de continuar.'
                  : 'The selected area cannot accommodate this group. Use “Change seating area” before continuing.'}
              </p>
            )}
          {blocked && !error && (
            <p role="status" className="mt-3 text-destructive">
              {reviewMessage}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="grid gap-4">
          {step !== 'menu' && (
            <Button
              variant={
                step === 'cancel' || step === 'yield' ? 'outline' : 'default'
              }
              className={`h-12 ${
                step === 'yield'
                  ? 'border-red-700 text-red-700'
                  : step === 'cancel'
                  ? 'border-red-600 text-red-600'
                  : ''
              }`}
              disabled={
                busy ||
                blocked ||
                (!attempt &&
                  ((step === 'party' && (delta === 0 || !compatible)) ||
                    (step === 'space' &&
                      (space === (initial.preferredSpaceId ?? 'fastest') ||
                        !compatible)) ||
                    (step === 'confirmParty' && !compatible)))
              }
              onClick={() => {
                if (step === 'party') setStep('confirmParty')
                else void confirm()
              }}
            >
              {busy
                ? es
                  ? 'Guardando…'
                  : 'Saving…'
                : step === 'party'
                ? es
                  ? 'Continuar'
                  : 'Continue'
                : step === 'space'
                ? es
                  ? 'Guardar cambios'
                  : 'Save changes'
                : step === 'cancel'
                ? es
                  ? 'Sí, abandonar la lista de espera'
                  : 'Yes, leave the waiting list'
                : step === 'yield'
                ? es
                  ? 'Sí, pasar turno'
                  : 'Yes, yield turn'
                : es
                ? 'Confirmar'
                : 'Confirm'}
            </Button>
          )}
          <SheetClose
            render={
              <Button
                variant={step === 'menu' ? 'ghost' : 'outline'}
                className="h-12"
                disabled={busy}
              />
            }
          >
            {dismiss}
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  )
}
