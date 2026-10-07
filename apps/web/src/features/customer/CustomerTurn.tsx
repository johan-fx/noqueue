import { useLocale, usePublicResource } from './public-resource'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { entrySchema, type CustomerCommand } from '@noqueue/contracts/queue'
import { DemoEntry } from '@/features/join-queue/web/DemoQueue'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet'
import { RestaurantForm } from './RestaurantForm'
import { TurnView } from './TurnView'
import { CustomerShell, LoadError } from './shared'
const parse = (value: unknown) => entrySchema.parse(value)
export function CustomerTurn() {
  const { recoveryToken } = useParams()
  return (
    <CustomerTurnContent key={recoveryToken} recoveryToken={recoveryToken} />
  )
}
function CustomerTurnContent({
  recoveryToken,
}: {
  recoveryToken: string | undefined
}) {
  const location = useLocation()
  const [locale, setLocale] = useLocale(),
    es = locale === 'es'
  const {
    data: entry,
    updatedAt,
    error,
    refresh,
  } = usePublicResource(`/api/v1/public/entries/${recoveryToken}`, parse, true)
  const [pending, setPending] = useState<{
    action: 'cancel' | 'yield'
    version: number
    key: string
  } | null>(null)
  const [editVersion, setEditVersion] = useState<number | null>(null)
  const [busy, setBusy] = useState(false),
    lock = useRef(false)
  const [commandError, setCommandError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  async function command(input: CustomerCommand, key: string) {
    const response = await fetch(
      `/api/v1/public/entries/${recoveryToken}/commands`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(input),
      },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (response.status === 409) await refresh()
      throw new Error(
        body.error === 'no_compatible_successor'
          ? es
            ? 'No hay otro grupo compatible al que ceder el turno.'
            : 'There is no compatible group to yield to.'
          : body.error === 'version_conflict' ||
            body.error === 'invalid_transition'
          ? es
            ? 'Tu turno ha cambiado. Cierra esta ventana y revisa su estado antes de repetir.'
            : 'Your turn has changed. Close this window and review its status before retrying.'
          : es
          ? 'No se pudo confirmar la acción. Puedes reintentar sin duplicarla.'
          : 'Could not confirm the action. You can retry safely.',
      )
    }
  }
  const c = entry?.customer
  if (entry && !c)
    return (
      <div className="mx-auto max-w-3xl p-4">
        <DemoEntry />
      </div>
    )
  return (
    <CustomerShell
      title={c?.service.name ?? (es ? 'Tu turno' : 'Your turn')}
      back={
        c?.service.venueId
          ? `/v/${c.service.venueId}?lang=${locale}`
          : undefined
      }
      locale={locale}
      setLocale={setLocale}
    >
      {error && <LoadError locale={locale} retry={() => void refresh()} />}
      {!entry && !error && (
        <p className="p-4" role="status">
          {es ? 'Cargando…' : 'Loading…'}
        </p>
      )}
      {entry &&
        c &&
        (editVersion != null ? (
          <RestaurantForm
            service={c.service}
            locale={locale}
            initial={{
              displayName: c.displayName ?? '',
              partySize: c.partySize,
              preferredSpaceId: c.preferredSpaceId ?? 'fastest',
              locale,
            }}
            disabled={!c.actions.includes('update')}
            onCancel={() => setEditVersion(null)}
            onSubmit={async (input, key) => {
              await command(
                {
                  action: 'update',
                  version: editVersion,
                  displayName: input.displayName!,
                  partySize: input.partySize,
                  preferredSpaceId: input.preferredSpaceId!,
                  locale,
                },
                key,
              )
              setEditVersion(null)
              await refresh()
            }}
          />
        ) : (
          <TurnView
            entry={entry}
            locale={locale}
            updatedAt={updatedAt!}
            now={c.serverNow + Math.max(0, now - updatedAt!)}
            joined={!!location.state?.joined}
            onAction={(action) => {
              setCommandError('')
              if (action === 'update') setEditVersion(c.version)
              else
                setPending({
                  action,
                  version: c.version,
                  key: crypto.randomUUID(),
                })
            }}
          />
        ))}
      <Sheet
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPending(null)
            setCommandError('')
          }
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="mx-auto min-h-96 max-w-lg gap-6 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          {!busy && (
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-3 right-3"
                  aria-label={es ? 'Cerrar' : 'Close'}
                />
              }
            >
              <X />
            </SheetClose>
          )}
          <SheetHeader className="gap-5 p-0 pr-8">
            <SheetTitle className="text-2xl font-medium">
              {pending?.action === 'yield'
                ? es
                  ? 'Vas a pasar un turno'
                  : 'You are about to yield your turn'
                : es
                ? '¿Quieres abandonar la lista?'
                : 'Leave the waiting list?'}
            </SheetTitle>
            <SheetDescription className="text-base leading-6">
              {pending?.action === 'yield'
                ? es
                  ? 'Cederás tu posición al siguiente grupo compatible. El tiempo de espera puede aumentar. ¿Quieres continuar?'
                  : 'You will exchange places with the next compatible group. Your wait may increase. Continue?'
                : es
                ? 'Perderás tu posición. Si vuelves a apuntarte, tendrás un turno nuevo.'
                : 'You will lose your place. Joining again creates a new turn.'}
            </SheetDescription>
          </SheetHeader>
          {commandError && (
            <p role="alert" className="text-destructive">
              {commandError}
            </p>
          )}
          <div className="mt-auto grid gap-4">
            <Button
              variant="outline"
              className="h-12 border-red-700 text-red-700"
              disabled={busy}
              onClick={async () => {
                if (!pending || lock.current) return
                lock.current = true
                setBusy(true)
                setCommandError('')
                try {
                  await command(
                    { action: pending.action, version: pending.version },
                    pending.key,
                  )
                  setPending(null)
                  await refresh()
                } catch (error) {
                  setCommandError(
                    error instanceof Error ? error.message : 'Error',
                  )
                } finally {
                  lock.current = false
                  setBusy(false)
                }
              }}
            >
              {busy
                ? es
                  ? 'Guardando…'
                  : 'Saving…'
                : pending?.action === 'yield'
                ? es
                  ? 'Sí, pasar turno'
                  : 'Yes, yield turn'
                : es
                ? 'Sí, abandonar'
                : 'Yes, leave'}
            </Button>
            <SheetClose
              render={
                <Button variant="outline" className="h-12" disabled={busy} />
              }
            >
              {pending?.action === 'yield'
                ? es
                  ? 'No pasar turno'
                  : 'Keep my place'
                : es
                ? 'Seguir en la lista'
                : 'Stay on the list'}
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </CustomerShell>
  )
}
