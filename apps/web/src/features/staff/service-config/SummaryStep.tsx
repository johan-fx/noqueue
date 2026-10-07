import type { ServiceInput } from '@noqueue/contracts/staff'
import { formatDays, formatRanges, readHours } from './hours'
import { seatLabel } from './model'

export function SummaryStep({ values }: { values: ServiceInput }) {
  const hours = readHours(values.schedules)
  const seats = seatLabel(values.type)
  const preference =
    values.assignmentPreference === 'fastest' || !values.assignmentPreference
      ? 'Menor tiempo posible'
      : values.spaces.find((space) => space.id === values.assignmentPreference)
          ?.name ?? values.assignmentPreference
  return (
    <section className="space-y-3 rounded-lg bg-muted p-4">
      <h3 className="font-semibold">{values.name || 'Sin nombre'}</h3>
      <p>
        {values.twentyFourHours
          ? '24 horas, todos los días'
          : formatDays(hours.days)}
      </p>
      {!values.twentyFourHours && <p>{formatRanges(hours.ranges)}</p>}
      <p>Tiempo medio: {values.averageMinutes} min</p>
      <p>
        Nº máximo de {values.type === 'reception' ? 'personas' : seats} en
        lista: {values.capacity}
      </p>
      {values.spaces.flatMap((space) =>
        (space.tableTypes ?? []).map((group) => (
          <p key={`${space.id ?? space.name}-${group.seats}`}>
            {space.name} · {group.seats} plazas:{' '}
            {group.averageMinutes ??
              values.queueBySeat?.find((row) => row.seats === group.seats)
                ?.averageMinutes ??
              values.averageMinutes}{' '}
            min
          </p>
        )),
      )}
      {values.queueBySeat?.map((item) => (
        <p key={item.seats}>
          {values.type === 'pool' ? 'Plazas' : 'Mesas'} de {item.seats}:{' '}
          {item.averageMinutes} min, máx. {item.capacity}
        </p>
      ))}
      {values.type === 'reception' ? (
        <p>Servicios: {values.receptionServices.join(', ') || 'Ninguno'}</p>
      ) : (
        <p>Preferencia: {preference}</p>
      )}
    </section>
  )
}
