import type { ServiceInput } from '@noqueue/contracts/staff'
import { formatDays, formatRanges, readHours } from './hours'
import { seatLabel } from './model'

export function SummaryStep({ values }: { values: ServiceInput }) {
  const hours = readHours(values.schedules)
  const seats = seatLabel(values.type)
  const preference =
    values.assignmentPreference === 'fastest' || !values.assignmentPreference
      ? 'Menor tiempo posible'
      : values.assignmentPreference
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
        Nº máximo de {values.type === 'reception' ? 'personas' : seats} en cola:{' '}
        {values.capacity}
      </p>
      {values.type === 'reception' ? (
        <p>Servicios: {values.receptionServices.join(', ') || 'Ninguno'}</p>
      ) : (
        <p>Preferencia: {preference}</p>
      )}
    </section>
  )
}
