import { useLocale, usePublicResource } from './public-resource'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { entrySchema, type CustomerCommand } from '@noqueue/contracts/queue'
import { DemoEntry } from '@/features/join-queue/web/DemoQueue'
import { TurnSheet } from './TurnSheet'
import { CustomerCommandError } from './customer-command-error'
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
  const recordedNotice = useRef('')
  const {
    data: entry,
    updatedAt,
    error,
    refresh,
  } = usePublicResource(`/api/v1/public/entries/${recoveryToken}`, parse, true)
  const [sheet, setSheet] = useState<{
    action: 'update' | 'cancel' | 'yield'
    returnFocus: HTMLElement | null
    initial: NonNullable<ReturnType<typeof parse>['customer']>
  } | null>(null)
  const [yieldConfirmation, setYieldConfirmation] = useState<{
    version: number
    phase: NonNullable<ReturnType<typeof parse>['customer']>['phase'] | null
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!recoveryToken || !/^[a-f0-9]{64}$/.test(recoveryToken)) return
    const params = new URLSearchParams(location.search)
    const noticeId = params.get('notice')
    if (
      params.get('source') !== 'whatsapp' ||
      params.getAll('source').length !== 1 ||
      !noticeId ||
      params.getAll('notice').length !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        noticeId,
      )
    )
      return
    const key = `${recoveryToken}:${noticeId}`
    if (recordedNotice.current === key) return
    recordedNotice.current = key
    void fetch(
      `/api/v1/public/entries/${recoveryToken}/notices/${noticeId}/opened`,
      { method: 'POST', keepalive: true },
    ).catch(() => undefined)
  }, [location.search, recoveryToken])
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
      throw new CustomerCommandError(
        body.error === 'no_compatible_successor'
          ? es
            ? entry?.customer?.service.type === 'restaurant'
              ? 'No hay otro grupo compatible al que ceder el turno.'
              : 'No hay otro turno compatible al que ceder el turno.'
            : entry?.customer?.service.type === 'restaurant'
            ? 'There is no compatible group to yield to.'
            : 'There is no compatible turn to yield to.'
          : body.error === 'version_conflict' ||
            body.error === 'invalid_transition'
          ? es
            ? 'Tu turno ha cambiado. Cierra esta ventana y revisa su estado antes de repetir.'
            : 'Your turn has changed. Close this window and review its status before retrying.'
          : es
          ? 'No se pudo confirmar la acción. Puedes reintentar sin duplicarla.'
          : 'Could not confirm the action. You can retry safely.',
        response.status === 409 && body.error !== 'no_compatible_successor',
      )
    }
  }
  const c = entry?.customer
  // Bind feedback to the confirmed mutation, then retire it when the live turn moves on.
  // A failed refresh cannot label an older snapshot as the updated turn.
  if (yieldConfirmation && c) {
    if (
      c.version > yieldConfirmation.version ||
      (c.version === yieldConfirmation.version &&
        !['waiting', 'approaching'].includes(c.phase)) ||
      (yieldConfirmation.phase !== null && yieldConfirmation.phase !== c.phase)
    ) {
      setYieldConfirmation(null)
    } else if (
      c.version === yieldConfirmation.version &&
      yieldConfirmation.phase === null
    ) {
      setYieldConfirmation({ ...yieldConfirmation, phase: c.phase })
    }
  }
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
      {entry && c && (
        <TurnView
          entry={entry}
          locale={locale}
          updatedAt={updatedAt!}
          now={c.serverNow + Math.max(0, now - updatedAt!)}
          joined={!!location.state?.joined}
          yielded={
            yieldConfirmation?.version === c.version &&
            yieldConfirmation.phase === c.phase
          }
          onAction={(action) => {
            setYieldConfirmation(null)
            setSheet({
              action,
              initial: structuredClone(c),
              returnFocus:
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null,
            })
          }}
        />
      )}
      {sheet && c && (
        <TurnSheet
          initial={sheet.initial}
          current={c}
          action={sheet.action}
          locale={locale}
          returnFocus={sheet.returnFocus}
          onClose={() => setSheet(null)}
          onCommand={async (input, key) => {
            await command(input, key)
            if (input.action === 'yield')
              setYieldConfirmation({ version: input.version + 1, phase: null })
            await refresh()
          }}
        />
      )}
    </CustomerShell>
  )
}
