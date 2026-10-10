import { Link } from 'react-router'
import { CheckCheck, CircleCheck, Timer } from 'lucide-react'
import type { Entry } from '@noqueue/contracts/queue'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import {
  Stepper,
  StepperItem,
  StepperIndicator,
} from '@/components/reui/stepper'
import { CustomerFooter, type Locale } from './shared'
import { remainingWaitMs, turnProgress } from './turn-progress'

export function TurnView({
  entry,
  locale,
  now,
  updatedAt,
  joined = false,
  yielded = false,
  onAction,
}: {
  entry: Entry
  locale: Locale
  now: number
  updatedAt: number
  joined?: boolean
  yielded?: boolean
  onAction: (action: 'update' | 'cancel' | 'yield') => void
}) {
  const c = entry.customer!,
    es = locale === 'es',
    phase = c.phase,
    restaurant = c.service.type === 'restaurant'
  const arrived = phase === 'arrived',
    expired = phase === 'expired',
    cancelled = phase === 'cancelled',
    serviceEnded = cancelled && c.cancellationReason === 'service_ended',
    approaching = phase === 'approaching',
    called = phase === 'called'
  const active = !arrived && !expired && !cancelled
  const step = arrived || called ? 3 : approaching ? 2 : 1
  const primaryAction = approaching || called || !restaurant ? 'yield' : 'update'
  const titles = {
    waiting: es
      ? `Estás en la lista de espera de ${c.service.venueName}`
      : `You are on the waiting list at ${c.service.venueName}`,
    approaching: es ? 'Ya casi es tu turno' : 'It is almost your turn',
    called: es ? '¡Es tu turno!' : 'It is your turn!',
    arrived: es ? 'Se ha confirmado tu llegada' : 'Your arrival is confirmed',
    expired: es
      ? `Lo sentimos, tu turno en ${c.service.venueName} ha expirado`
      : `Sorry, your turn at ${c.service.venueName} has expired`,
    cancelled: serviceEnded
      ? es ? 'El servicio ha finalizado' : 'Service has ended'
      : es ? 'Has abandonado la lista' : 'You have left the waiting list',
  }
  const descriptions = {
    waiting: es
      ? 'Te avisaremos aquí cuando sea el momento de acercarte.'
      : 'This page will let you know when it is time to approach.',
    approaching: es
      ? `Es un buen momento para ir acercándote con calma a ${c.service.venueName}.`
      : `Now is a good time to make your way to ${c.service.venueName}.`,
    called: es
      ? `Acércate ${
          restaurant ? 'al restaurante' : `a ${c.service.name}`
        }. El personal confirmará tu llegada.`
      : `Please come to ${
          restaurant ? 'the restaurant' : c.service.name
        }. Staff will confirm your arrival.`,
    arrived: es
      ? 'Esperamos que disfrutes de tu experiencia con nosotros.'
      : 'We hope you enjoy your experience with us.',
    expired: es
      ? 'No hemos confirmado tu llegada a tiempo, por lo que tu turno ya no está activo. Si aún quieres venir, puedes volver a unirte a la lista de espera.'
      : 'Your arrival was not confirmed in time, so your turn is no longer active. You can join the waiting list again.',
    cancelled: serviceEnded
      ? es ? 'El servicio ha cerrado y tu turno pendiente se ha cancelado. Puedes apuntarte de nuevo en la próxima apertura.' : 'The service has closed and your pending turn was cancelled. You can join again when service reopens.'
      : es ? 'Tu turno ya no está activo. Puedes volver a apuntarte cuando quieras.' : 'Your turn is no longer active. You can join again whenever you like.',
  }
  const waitMs = remainingWaitMs(entry, now)
  const remaining = called
    ? c.arrivalDeadlineAt == null
      ? null
      : Math.max(0, c.arrivalDeadlineAt - now)
    : waitMs
  const countdown =
    remaining == null
      ? '—'
      : `${Math.floor(remaining / 60000)}:${String(
          Math.floor(remaining / 1000) % 60,
        ).padStart(2, '0')}`
  const known =
    ['estimated', 'provisional'].includes(entry.estimateQuality ?? '') &&
    Number.isFinite(entry.etaMinutes) &&
    entry.etaMinutes >= 0
  const units = es ? 'minutos:segundos' : 'minutes:seconds'
  const waitLabel = waitMs == null
    ? `${entry.etaMinutes} min`
    : `${countdown} (${units})`
  const estimatedWaitLabel = es
    ? `Espera aproximada: ${waitLabel}`
    : `Estimated wait: ${waitLabel}`
  const value = expired
    ? '0'
    : called
    ? countdown
    : known
    ? waitMs == null ? String(entry.etaMinutes) : countdown
    : '—'
  const counterSize = value.length > 6
    ? 'text-2xl'
    : value.length > 5 ? 'text-3xl' : 'text-4xl'
  const color = arrived
    ? 'text-green-600'
    : expired || called
    ? 'text-red-700'
    : approaching
    ? 'text-orange-500'
    : 'text-black'
  const progress = turnProgress(entry, now)
  const percentage = progress == null ? undefined : Math.round(progress * 100)
  const circumference = 2 * Math.PI * 80
  const labels = es
    ? [
        'Lista virtual',
        arrived
          ? restaurant
            ? 'Mesa asignada'
            : 'Llegada confirmada'
          : 'En marcha',
        '¡Es tu turno!',
      ]
    : [
        'Waiting list',
        arrived
          ? restaurant
            ? 'Table assigned'
            : 'Arrival confirmed'
          : 'On your way',
        'Your turn!',
      ]
  if (cancelled && !serviceEnded) {
    return (
      <>
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center font-sans">
          <CheckCheck aria-hidden="true" className="mb-6 size-8 text-black" />
          <h1 className="max-w-64 text-2xl leading-8 font-semibold">
            {es ? 'Ya no estás en la lista de espera' : 'You are no longer on the waiting list'}
          </h1>
          <p className="mt-8 text-base leading-6 text-gray-500">
            {es ? 'Si aún quieres venir, puedes volver a unirte.' : 'If you still want to visit, you can join again.'}
          </p>
        </div>
        <CustomerFooter>
          <Button render={<Link to={`/v/${c.service.venueId}?lang=${locale}`} />}>
            {es ? 'Seleccionar lista de espera' : 'Choose a waiting list'}
          </Button>
        </CustomerFooter>
      </>
    )
  }
  return (
    <>
      <div className="flex flex-1 flex-col gap-6 px-4 pt-2 pb-6">
        <div className="space-y-2">
          <h1 className="text-2xl leading-8 font-medium text-gray-950">
            {titles[phase]}
          </h1>
          <p className="text-base leading-6 text-gray-500">
            {descriptions[phase]}
          </p>
        </div>
        {!expired && !cancelled && (
          <Stepper
            value={step}
            role="list"
            aria-label={es ? 'Progreso del turno' : 'Queue progress'}
            className="relative flex justify-between pt-1"
          >
            <div
              aria-hidden="true"
              className="absolute top-2.5 right-4 left-0 h-0.5 bg-muted"
            />
            <div
              aria-hidden="true"
              className={`absolute top-2.5 left-0 h-0.5 bg-gray-700 ${
                step === 3 ? 'right-4' : step === 2 ? 'w-1/2' : 'w-0'
              }`}
            />
            {labels.map((label, index) => (
              <StepperItem
                key={index}
                step={index + 1}
                role="listitem"
                aria-current={step === index + 1 ? 'step' : undefined}
                className="relative !flex-none !flex-col !items-start gap-2"
              >
                <StepperIndicator
                  className={`size-[13px] bg-transparent data-[state=active]:bg-gray-700 data-[state=completed]:bg-transparent ${
                    index === 1
                      ? 'self-center'
                      : index === 2
                      ? 'self-end mr-4'
                      : ''
                  }`}
                />
                <span
                  className={`text-base ${
                    index + 1 > step ? 'text-gray-400' : ''
                  }`}
                >
                  {label}
                </span>
              </StepperItem>
            ))}
          </Stepper>
        )}
        {!cancelled && (
          <div
            role="progressbar"
            aria-label={
              active && !called && known
                ? estimatedWaitLabel
                : es
                ? 'Progreso de la espera'
                : 'Waiting progress'
            }
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            aria-valuetext={
              active && !called && known
                ? percentage == null
                  ? estimatedWaitLabel
                  : `${estimatedWaitLabel}. ${es ? 'Progreso de la espera' : 'Waiting progress'}: ${percentage}%`
                : percentage == null
                ? es
                  ? 'Sin estimación disponible'
                  : 'No estimate available'
                : es
                ? `Progreso de la espera: ${percentage}%`
                : `Waiting progress: ${percentage}%`
            }
            className={`relative mx-auto grid size-43 shrink-0 place-items-center ${color}`}
          >
            <svg
              className="absolute inset-0 size-full -rotate-90"
              viewBox="0 0 172 172"
              aria-hidden="true"
            >
              <circle
                cx="86"
                cy="86"
                r="80"
                fill="none"
                stroke="var(--secondary)"
                strokeWidth="12"
              />
              {progress != null && progress > 0 && (
                <circle
                  cx="86"
                  cy="86"
                  r="80"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={
                    progress === 1
                      ? undefined
                      : `${progress * circumference} ${circumference}`
                  }
                />
              )}
            </svg>
            {arrived ? (
              <div className="relative grid justify-items-center gap-3 text-xs">
                <CheckCheck className="size-6" />
                <p>{es ? 'Llegada confirmada' : 'Arrival confirmed'}</p>
              </div>
            ) : (
              <div className="relative text-center">
                <p
                  className={`tabular-nums whitespace-nowrap leading-10 ${counterSize} ${
                    active && !called ? 'text-black' : ''
                  }`}
                  style={
                    value.length > 8
                      ? { fontSize: `${128 / (value.length * 0.65)}px` }
                      : undefined
                  }
                >
                  {value}
                </p>
                <p
                  className={`mt-1 max-w-28 text-xs leading-4 ${
                    !expired && !called ? 'text-muted-foreground' : ''
                  }`}
                >
                  {expired || called ? (
                    es ? (
                      'minutos para llegar'
                    ) : (
                      'minutes to arrive'
                    )
                  ) : known ? (
                    <>
                      {waitMs == null ? es ? 'minutos' : 'minutes' : units}
                      <br />
                      {es ? 'aprox.' : 'approx.'}
                    </>
                  ) : es ? (
                    'Sin estimación'
                  ) : (
                    'No estimate'
                  )}
                </p>
              </div>
            )}
          </div>
        )}
        {arrived ? (
          <p className="mx-auto flex items-center gap-3 rounded-lg bg-gray-50 p-4">
            <Timer className="size-5" />
            <span>
              {es ? 'Hora de llegada' : 'Arrival time'}:{' '}
              <strong>
                {c.arrivedAt == null
                  ? '—'
                  : new Intl.DateTimeFormat(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(c.arrivedAt)}
              </strong>
            </span>
          </p>
        ) : (
          <div className="space-y-2 text-center">
            <div
              className={`mx-auto w-fit rounded-xl p-4 ${
                expired ? 'bg-red-50 text-red-700' : 'bg-secondary'
              }`}
            >
              <p>
                {es ? 'Tu turno:' : 'Your turn:'}{' '}
                <span className="ml-1 text-2xl">{entry.code}</span>
              </p>
              {active && !called && (
                <p>
                  {es ? 'Hay ' : ''}
                  <strong>
                    {Math.max(0, entry.position - 1)} {es ? 'turnos' : 'turns'}
                  </strong>{' '}
                  {es ? 'delante de ti' : 'ahead of you'}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {es ? 'Última actualización:' : 'Last update:'}{' '}
              {new Intl.DateTimeFormat(locale, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }).format(updatedAt)}
            </p>
          </div>
        )}
        {approaching && c.actions.includes('yield') && (
          <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-4">
            <Timer className="mt-1 size-6 shrink-0" />
            <div>
              <p className="font-semibold">
                {es
                  ? '¿Crees que vas a llegar tarde?'
                  : 'Think you might be late?'}
              </p>
              <p className="text-gray-500">
                {es
                  ? 'Puedes pasar turno o abandonar la lista.'
                  : 'You can yield your turn or leave the list.'}
              </p>
            </div>
          </div>
        )}
        {called && remaining === 0 && (
          <p role="status">
            {es
              ? 'Comprobando el estado del turno…'
              : 'Checking your turn status…'}
          </p>
        )}
        {yielded && (phase === 'waiting' || approaching) && (
          <Alert role="status" className="mt-auto gap-y-1 border-green-600 px-4 py-3 font-sans leading-5 has-[>svg]:gap-x-3">
            <CircleCheck aria-hidden="true" className="size-4 text-green-600!" />
            <AlertTitle>{es ? 'Has pasado turno' : 'You have yielded your turn'}</AlertTitle>
            <AlertDescription className="leading-5">{es ? 'Consulta tu posición y tiempo de espera actualizados.' : 'Check your updated position and waiting time.'}</AlertDescription>
          </Alert>
        )}
        {joined && !yielded && phase === 'waiting' && (
          <div
            role="status"
            className="mt-auto flex gap-3 rounded-lg border border-green-600 p-4 text-sm"
          >
            <CircleCheck className="size-4 shrink-0 text-green-600" />
            <div>
              <p className="font-medium text-foreground">
                {es
                  ? '¡Ya estás en lista de espera!'
                  : 'You are on the waiting list!'}
              </p>
              <p className="mt-1 text-muted-foreground">
                {es
                  ? 'Guarda este enlace privado para consultar tu turno.'
                  : 'Save this private link to check your turn.'}
              </p>
            </div>
          </div>
        )}
      </div>
      {active && c.actions.length > 0 && (
        <CustomerFooter>
          {c.actions.includes('cancel') && (
            <Button
              variant="outline"
              className="border-red-700 text-red-700"
              onClick={() => onAction('cancel')}
            >
              {es ? 'Abandonar la lista' : 'Leave the list'}
            </Button>
          )}
          {c.actions.includes(primaryAction) && (
            <Button
              variant="outline"
              className="border-gray-800"
              onClick={() => onAction(primaryAction)}
            >
              {primaryAction === 'yield'
                ? es
                  ? 'Pasar turno'
                  : 'Yield turn'
                : es
                ? 'Modificar'
                : 'Edit'}
            </Button>
          )}
        </CustomerFooter>
      )}
      {(expired || cancelled) && (
        <CustomerFooter>
          <Button
            render={<Link to={`/v/${c.service.venueId}?lang=${locale}`} />}
          >
            {es ? 'Seleccionar lista de espera' : 'Choose a waiting list'}
          </Button>
        </CustomerFooter>
      )}
    </>
  )
}
