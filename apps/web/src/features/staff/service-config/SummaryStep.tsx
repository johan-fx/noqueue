import { readScheduleGroups, type ServiceInput } from '@noqueue/contracts/staff'
import { formatDays, formatRanges } from './hours'
import { seatLabel } from './model'

export function SummaryStep({ values }: { values: ServiceInput }) {
  const groups = readScheduleGroups(values)
  const seats = seatLabel(values.type)
  const preference =
    values.assignmentPreference === 'fastest' || !values.assignmentPreference
      ? 'Menor tiempo posible'
      : values.spaces.find((space) => space.id === values.assignmentPreference)
          ?.name ?? values.assignmentPreference
  return (
    <section className="space-y-3 rounded-lg bg-muted p-4">
      <h3 className="font-semibold">{values.name || 'Sin nombre'}</h3>
      {groups.map((group, index) => (
        <div key={index}>
          <p>{formatDays(group.days)}</p>
          <p>
            {group.twentyFourHours
              ? 'Abierto 24 horas'
              : formatRanges(group.ranges)}
          </p>
        </div>
      ))}
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
